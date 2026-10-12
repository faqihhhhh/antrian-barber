package publicpage

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"kapsflow/internal/billing"
	db "kapsflow/internal/db"
	"kapsflow/internal/httpx"
	"kapsflow/internal/profile"
	"kapsflow/internal/queue"
	"kapsflow/internal/rls"
)

const daysAhead = 14

var errOutletNotFound = errors.New("outlet tidak ditemukan")

type Service struct {
	pool       *pgxpool.Pool
	profileSvc *profile.Service
	billingSvc *billing.Service
	queueSvc   *queue.Service
}

func NewService(pool *pgxpool.Pool, profileSvc *profile.Service, billingSvc *billing.Service, queueSvc *queue.Service) *Service {
	return &Service{pool: pool, profileSvc: profileSvc, billingSvc: billingSvc, queueSvc: queueSvc}
}

type DayInfo struct {
	Date      string     `json:"date"`
	SessionID *uuid.UUID `json:"session_id"`
	Open      bool       `json:"open"`
	MaxQuota  int32      `json:"max_quota"`
	Remaining int32      `json:"remaining"`
}

type OutletPage struct {
	OutletID               uuid.UUID              `json:"outlet_id"`
	TenantID               uuid.UUID              `json:"tenant_id"`
	Slug                   string                 `json:"slug"`
	BusinessName           string                 `json:"business_name"`
	OutletName             string                 `json:"outlet_name"`
	Address                *string                `json:"address"`
	Timezone               string                 `json:"timezone"`
	LocalToday             string                 `json:"local_today"`
	DPPriceRupiah          int64                  `json:"dp_price_rupiah"`
	DefaultDurationMinutes int32                  `json:"default_duration_minutes"`
	PaymentMode            string                 `json:"payment_mode"`
	AcceptingBookings      bool                   `json:"accepting_bookings"`
	UnavailableReason      *string                `json:"unavailable_reason"`
	Days                   []DayInfo              `json:"days"`
	Today                  *queue.SessionSnapshot `json:"today"`
}

// GetOutletPage melayani halaman yang dibuka pelanggan dari tautan atau QR
// outlet, tanpa login. Seluruh pembacaan lewat jalur sistem karena pengunjung
// bukan anggota bisnis; yang dikembalikan hanya informasi yang memang untuk umum.
func (s *Service) GetOutletPage(ctx context.Context, slug string) (OutletPage, error) {
	var (
		outlet   db.Outlet
		tenant   db.Tenant
		sessions []db.QueueSession
		localNow time.Time
		from     time.Time
	)

	err := rls.RunAsSystem(ctx, s.pool, func(c context.Context) error {
		tx, ok := rls.TxFromContext(c)
		if !ok {
			return errors.New("transaksi sistem tidak tersedia")
		}
		q := db.New(tx)

		o, err := q.GetOutletBySlug(c, slug)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return errOutletNotFound
			}
			return err
		}
		outlet = o

		t, err := q.GetTenantByID(c, o.TenantID)
		if err != nil {
			return err
		}
		tenant = t

		loc, err := time.LoadLocation(o.Timezone)
		if err != nil {
			return fmt.Errorf("zona waktu outlet tidak valid: %w", err)
		}
		localNow = time.Now().In(loc)
		from = time.Date(localNow.Year(), localNow.Month(), localNow.Day(), 0, 0, 0, 0, time.UTC)

		rows, err := q.ListQueueSessionsInRange(c, db.ListQueueSessionsInRangeParams{
			OutletID: o.ID,
			FromDate: pgtype.Date{Time: from, Valid: true},
			ToDate:   pgtype.Date{Time: from.AddDate(0, 0, daysAhead-1), Valid: true},
		})
		if err != nil {
			return err
		}
		sessions = rows
		return nil
	})
	if err != nil {
		if errors.Is(err, errOutletNotFound) {
			return OutletPage{}, httpx.NotFound("outlet_tidak_ditemukan", "Outlet tidak ditemukan", nil)
		}
		return OutletPage{}, httpx.Internal(fmt.Errorf("halaman publik outlet: %w", err))
	}

	mode, err := s.profileSvc.PaymentMode(ctx, tenant.ID)
	if err != nil {
		return OutletPage{}, err
	}
	sub, err := s.billingSvc.GetStatusAsSystem(ctx, tenant.ID)
	if err != nil {
		return OutletPage{}, err
	}

	var reason *string
	setReason := func(v string) { reason = &v }
	switch {
	case sub.Status != billing.StatusActive && sub.Status != billing.StatusGrace:
		setReason("langganan_tidak_aktif")
	case outlet.DpPriceRupiah <= 0:
		setReason("harga_dp_belum_diatur")
	case mode == "none":
		setReason("pembayaran_belum_diatur")
	}

	byDate := make(map[string]db.QueueSession, len(sessions))
	for _, sess := range sessions {
		byDate[sess.SessionDate.Time.Format("2006-01-02")] = sess
	}
	days := make([]DayInfo, 0, daysAhead)
	var today *queue.SessionSnapshot
	for i := 0; i < daysAhead; i++ {
		key := from.AddDate(0, 0, i).Format("2006-01-02")
		day := DayInfo{Date: key}
		if sess, ok := byDate[key]; ok {
			id := sess.ID
			day.SessionID = &id
			day.MaxQuota = sess.MaxQuota
			day.Remaining = max(0, sess.MaxQuota-sess.UsedQuota)
			day.Open = sess.Status == "open" && day.Remaining > 0
			if i == 0 {
				if snap, err := s.queueSvc.GetPublicSnapshot(ctx, sess.ID); err == nil {
					today = &snap
				}
			}
		}
		days = append(days, day)
	}

	var address *string
	if outlet.Address.Valid {
		v := outlet.Address.String
		address = &v
	}

	return OutletPage{
		OutletID: outlet.ID, TenantID: tenant.ID, Slug: outlet.Slug,
		BusinessName: tenant.Name, OutletName: outlet.Name, Address: address,
		Timezone: outlet.Timezone, LocalToday: localNow.Format("2006-01-02"),
		DPPriceRupiah: outlet.DpPriceRupiah, DefaultDurationMinutes: outlet.DefaultDurationMinutes,
		PaymentMode: mode, AcceptingBookings: reason == nil, UnavailableReason: reason,
		Days: days, Today: today,
	}, nil
}