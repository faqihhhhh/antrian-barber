package profile

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	db "kapsflow/internal/db"
	"kapsflow/internal/cryptox"
	"kapsflow/internal/httpx"
	"kapsflow/internal/rls"
)

type Service struct {
	fallback *db.Queries
	pool     *pgxpool.Pool
	box      *cryptox.Box
}

func NewService(pool *pgxpool.Pool, box *cryptox.Box) *Service {
	return &Service{fallback: db.New(pool), pool: pool, box: box}
}

func (s *Service) queries(ctx context.Context) *db.Queries {
	if tx, ok := rls.TxFromContext(ctx); ok {
		return db.New(tx)
	}
	return s.fallback
}

type Info struct {
	MidtransConfigured  bool `json:"midtrans_configured"`
	OnboardingCompleted bool `json:"onboarding_completed"`
}

func (s *Service) GetProfile(ctx context.Context, tenantID uuid.UUID) (Info, error) {
	p, err := s.queries(ctx).GetTenantProfile(ctx, tenantID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Info{}, nil // belum pernah diisi sama sekali
		}
		return Info{}, httpx.Internal(fmt.Errorf("ambil profil tenant: %w", err))
	}
	return Info{
		MidtransConfigured:  p.MidtransConfiguredAt.Valid,
		OnboardingCompleted: p.OnboardingCompletedAt.Valid,
	}, nil
}

// SetMidtransKeys mengenkripsi lalu menyimpan kunci Midtrans milik owner.
// Kunci mentahnya tidak pernah disimpan di log maupun dikembalikan lewat API.
func (s *Service) SetMidtransKeys(ctx context.Context, tenantID uuid.UUID, serverKey, clientKey string, isProduction bool) error {
	if serverKey == "" || clientKey == "" {
		return httpx.BadRequest("kunci_midtrans_wajib_diisi", "Server key dan client key Midtrans wajib diisi", nil)
	}
	encServer, err := s.box.Encrypt(serverKey)
	if err != nil {
		return httpx.Internal(fmt.Errorf("mengenkripsi server key: %w", err))
	}
	encClient, err := s.box.Encrypt(clientKey)
	if err != nil {
		return httpx.Internal(fmt.Errorf("mengenkripsi client key: %w", err))
	}

	err = s.queries(ctx).UpsertTenantProfileMidtrans(ctx, db.UpsertTenantProfileMidtransParams{
		TenantID:                   tenantID,
		MidtransServerKeyEncrypted: pgtype.Text{String: encServer, Valid: true},
		MidtransClientKeyEncrypted: pgtype.Text{String: encClient, Valid: true},
		MidtransIsProduction:       isProduction,
	})
	if err != nil {
		return httpx.Internal(fmt.Errorf("menyimpan kunci midtrans: %w", err))
	}
	return nil
}

func (s *Service) SkipMidtransForNow(ctx context.Context, tenantID uuid.UUID) error {
	if err := s.queries(ctx).MarkOnboardingSkippedMidtrans(ctx, tenantID); err != nil {
		return httpx.Internal(fmt.Errorf("menandai onboarding: %w", err))
	}
	return nil
}

// GetDecryptedMidtransKeys mendekripsi kunci Midtrans tenant untuk dipakai
// internal (memanggil API Midtrans) — TIDAK PERNAH diekspos lewat handler HTTP.

func (s *Service) GetDecryptedMidtransKeys(ctx context.Context, tenantID uuid.UUID) (serverKey, clientKey string, isProduction, configured bool, err error) {
	runErr := rls.RunAsSystem(ctx, s.pool, func(sysCtx context.Context) error {
		p, qErr := s.queries(sysCtx).GetTenantProfile(sysCtx, tenantID)
		if qErr != nil {
			if errors.Is(qErr, pgx.ErrNoRows) {
				return nil
			}
			return httpx.Internal(fmt.Errorf("ambil profil tenant: %w", qErr))
		}
		if !p.MidtransServerKeyEncrypted.Valid || !p.MidtransClientKeyEncrypted.Valid {
			return nil
		}
		sk, dErr := s.box.Decrypt(p.MidtransServerKeyEncrypted.String)
		if dErr != nil {
			return httpx.Internal(fmt.Errorf("dekripsi server key: %w", dErr))
		}
		ck, dErr := s.box.Decrypt(p.MidtransClientKeyEncrypted.String)
		if dErr != nil {
			return httpx.Internal(fmt.Errorf("dekripsi client key: %w", dErr))
		}
		serverKey, clientKey, isProduction, configured = sk, ck, p.MidtransIsProduction, true
		return nil
	})
	if runErr != nil {
		return "", "", false, false, runErr
	}
	return serverKey, clientKey, isProduction, configured, nil
}