package notification

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	db "kapsflow/internal/db"
	"kapsflow/internal/httpx"
	"kapsflow/internal/rls"
	"kapsflow/internal/webpush"
)

type Service struct {
	fallback *db.Queries
	pool     *pgxpool.Pool
	client   *webpush.Client
	log      *slog.Logger
}

func NewService(pool *pgxpool.Pool, client *webpush.Client, log *slog.Logger) *Service {
	return &Service{fallback: db.New(pool), pool: pool, client: client, log: log}
}

func (s *Service) queries(ctx context.Context) *db.Queries {
	if tx, ok := rls.TxFromContext(ctx); ok {
		return db.New(tx)
	}
	return s.fallback
}

func (s *Service) PublicKey() string { return s.client.PublicKey() }

type SubscribeInput struct {
	Endpoint string
	P256dh   string
	Auth     string
}

func (s *Service) Subscribe(ctx context.Context, userID uuid.UUID, in SubscribeInput) error {
	if in.Endpoint == "" || in.P256dh == "" || in.Auth == "" {
		return httpx.BadRequest("subscription_tidak_lengkap", "Data subscription push tidak lengkap", nil)
	}
	err := s.queries(ctx).CreatePushSubscription(ctx, db.CreatePushSubscriptionParams{
		UserID: userID, Endpoint: in.Endpoint, P256dh: in.P256dh, Auth: in.Auth,
	})
	if err != nil {
		return httpx.Internal(fmt.Errorf("menyimpan push subscription: %w", err))
	}
	return nil
}

func (s *Service) Unsubscribe(ctx context.Context, userID uuid.UUID, endpoint string) error {
	if err := s.queries(ctx).DeletePushSubscription(ctx, db.DeletePushSubscriptionParams{Endpoint: endpoint, UserID: userID}); err != nil {
		return httpx.Internal(fmt.Errorf("menghapus push subscription: %w", err))
	}
	return nil
}

// NotifyUser mengirim push ke SEMUA perangkat pelanggan ini (bisa saja dia
// mendaftar dari HP dan laptop sekaligus). Dipanggil lewat rls.RunAsSystem
// oleh queue.Service — notifikasi dipicu oleh perubahan posisi antrian,
// bukan oleh aksi pengguna yang login saat itu.
func (s *Service) NotifyUser(ctx context.Context, userID uuid.UUID, title, body string) {
	var subs []db.PushSubscription
	err := rls.RunAsSystem(ctx, s.pool, func(sysCtx context.Context) error {
		result, qErr := s.queries(sysCtx).ListPushSubscriptionsForUser(sysCtx, userID)
		subs = result
		return qErr
	})
	if err != nil {
		s.log.Error("gagal ambil daftar push subscription", "err", err, "user_id", userID)
		return
	}

	s.log.Info("push subscription ditemukan", "user_id", userID, "jumlah", len(subs))

	for _, sub := range subs {
		gone, sendErr := s.client.Send(webpush.Subscription{Endpoint: sub.Endpoint, P256dh: sub.P256dh, Auth: sub.Auth}, webpush.Payload{Title: title, Body: body})
		if sendErr != nil {
			s.log.Error("gagal kirim web push", "err", sendErr, "user_id", userID)
			continue
		}
		if gone {
			s.log.Warn("push subscription dihapus karena server push membalas 404/410", "user_id", userID)
			_ = rls.RunAsSystem(ctx, s.pool, func(sysCtx context.Context) error {
				return s.queries(sysCtx).DeletePushSubscriptionByEndpoint(sysCtx, sub.Endpoint)
			})
		}
	}
}