package billing

import (
	"context"
	"errors"
	"fmt"
	"math/rand/v2"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"kapsflow/internal/authorization"
	db "kapsflow/internal/db"
	"kapsflow/internal/dbx"
	"kapsflow/internal/httpx"
	"kapsflow/internal/identity"
	"kapsflow/internal/rls"
	"log/slog"
)

const (
	GracePeriod   = 3 * 24 * time.Hour
	invoiceWindow = 24 * time.Hour
)

type SubscriptionStatus string

const (
	StatusNeverSubscribed SubscriptionStatus = "belum_berlangganan"
	StatusActive          SubscriptionStatus = "aktif"
	StatusGrace           SubscriptionStatus = "masa_tenggang"
	StatusReadOnly        SubscriptionStatus = "baca_saja"
)

type SubscriptionInfo struct {
	Status           SubscriptionStatus `json:"status"`
	PlanCode         string             `json:"plan_code,omitempty"`
	CurrentPeriodEnd *time.Time         `json:"current_period_end,omitempty"`
}

type Service struct {
	fallback *db.Queries
	pool     *pgxpool.Pool
	mailer   identity.Mailer
	log      *slog.Logger
}

func NewService(pool *pgxpool.Pool, mailer identity.Mailer, log *slog.Logger) *Service {
	return &Service{fallback: db.New(pool), pool: pool, mailer: mailer, log: log}
}

func (s *Service) queries(ctx context.Context) *db.Queries {
	if tx, ok := rls.TxFromContext(ctx); ok {
		return db.New(tx)
	}
	return s.fallback
}

// ListPlans publik (halaman harga), tidak lewat RLS karena tabel plans
// memang tidak dibatasi per tenant.
func (s *Service) ListPlans(ctx context.Context) ([]db.Plan, error) {
	plans, err := s.fallback.ListActivePlans(ctx)
	if err != nil {
		return nil, httpx.Internal(fmt.Errorf("ambil daftar plan: %w", err))
	}
	return httpx.NonNil(plans), nil
}

// Subscribe membuat/memperbarui baris subscription lalu invoice baru dengan
// nominal unik. Kalau nominal bentrok dengan invoice pending lain (jarang,
// tapi mungkin), coba lagi dengan kode acak lain sampai 10 kali.
func (s *Service) Subscribe(ctx context.Context, tenantID uuid.UUID, planCode string) (db.Invoice, error) {
	q := s.queries(ctx)
	user, ok := identity.UserFromContext(ctx)
	if !ok {
		return db.Invoice{}, httpx.Unauthorized("belum_masuk", "Silakan masuk terlebih dahulu", nil)
	}
	if err := authorization.RequireTenantRole(ctx, q, tenantID, user.ID, "owner"); err != nil {
		return db.Invoice{}, err
	}

	plan, err := q.GetPlanByCode(ctx, planCode)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return db.Invoice{}, httpx.BadRequest("paket_tidak_ditemukan", "Paket langganan tidak ditemukan", nil)
		}
		return db.Invoice{}, httpx.Internal(fmt.Errorf("ambil plan: %w", err))
	}

	if _, err := q.UpsertSubscription(ctx, db.UpsertSubscriptionParams{TenantID: tenantID, PlanID: plan.ID}); err != nil {
		return db.Invoice{}, httpx.Internal(fmt.Errorf("upsert subscription: %w", err))
	}

	const maxAttempts = 10
	for attempt := 0; attempt < maxAttempts; attempt++ {
		code := int16(1 + rand.IntN(998))
		amount := plan.PriceRupiah + int64(code)

		invoice, err := q.CreateInvoice(ctx, db.CreateInvoiceParams{
			TenantID:     tenantID,
			PlanID:       plan.ID,
			AmountRupiah: amount,
			UniqueCode:   code,
			ExpiresAt:    dbx.TS(time.Now().Add(invoiceWindow)),
		})
		if err == nil {
			return invoice, nil
		}
		if errors.Is(err, pgx.ErrNoRows) {
			continue // nominal bentrok; ON CONFLICT DO NOTHING tidak membatalkan transaksi
		}
		return db.Invoice{}, httpx.Internal(fmt.Errorf("membuat invoice: %w", err))
	}
	return db.Invoice{}, httpx.Internal(fmt.Errorf("gagal menemukan nominal unik setelah %d percobaan", maxAttempts))
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "23505"
	}
	return false
}

func computeStatus(currentPeriodEnd *time.Time) SubscriptionStatus {
	if currentPeriodEnd == nil {
		return StatusNeverSubscribed
	}
	now := time.Now()
	if !now.After(*currentPeriodEnd) {
		return StatusActive
	}
	if now.Before(currentPeriodEnd.Add(GracePeriod)) {
		return StatusGrace
	}
	return StatusReadOnly
}

func (s *Service) GetStatus(ctx context.Context, tenantID uuid.UUID) (SubscriptionInfo, error) {
	q := s.queries(ctx)

	sub, err := q.GetSubscriptionByTenant(ctx, tenantID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return SubscriptionInfo{Status: StatusNeverSubscribed}, nil
		}
		return SubscriptionInfo{}, httpx.Internal(fmt.Errorf("ambil subscription: %w", err))
	}

	plan, err := q.GetPlanByID(ctx, sub.PlanID)
	if err != nil {
		return SubscriptionInfo{}, httpx.Internal(fmt.Errorf("ambil plan: %w", err))
	}

	var periodEnd *time.Time
	if sub.CurrentPeriodEnd.Valid {
		t := sub.CurrentPeriodEnd.Time
		periodEnd = &t
	}

	return SubscriptionInfo{
		Status:           computeStatus(periodEnd),
		PlanCode:         plan.Code,
		CurrentPeriodEnd: periodEnd,
	}, nil
}

func (s *Service) ListInvoices(ctx context.Context, tenantID uuid.UUID) ([]db.Invoice, error) {
	invoices, err := s.queries(ctx).ListInvoicesByTenant(ctx, tenantID)
	if err != nil {
		return nil, httpx.Internal(fmt.Errorf("ambil daftar invoice: %w", err))
	}
	return httpx.NonNil(invoices), nil
}

func (s *Service) ListPendingInvoices(ctx context.Context) ([]db.Invoice, error) {
	invoices, err := s.queries(ctx).ListPendingInvoices(ctx)
	if err != nil {
		return nil, httpx.Internal(fmt.Errorf("ambil daftar invoice pending: %w", err))
	}
	return httpx.NonNil(invoices), nil
}

func (s *Service) IsPlatformAdmin(ctx context.Context, userID uuid.UUID) (bool, error) {
	ok, err := s.queries(ctx).IsPlatformAdmin(ctx, userID)
	if err != nil {
		return false, httpx.Internal(fmt.Errorf("cek platform admin: %w", err))
	}
	return ok, nil
}

// ConfirmInvoicePayment menandai invoice lunas lalu memperpanjang subscription.
// Kalau langganan masih aktif (diperpanjang sebelum kedaluwarsa), periode
// baru dihitung dari current_period_end lama, bukan dari sekarang — supaya
// owner tidak "rugi" hari kalau bayar lebih awal.
func (s *Service) ConfirmInvoicePayment(ctx context.Context, invoiceID, adminUserID uuid.UUID) error {
	q := s.queries(ctx)

	inv, err := q.GetInvoiceByID(ctx, invoiceID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return httpx.NotFound("invoice_tidak_ditemukan", "Invoice tidak ditemukan", nil)
		}
		return httpx.Internal(fmt.Errorf("ambil invoice: %w", err))
	}

	if inv.Status != "pending" && inv.Status != "expired" {
		return httpx.Conflict("invoice_sudah_diproses", "Invoice ini sudah dibayar atau dibatalkan", nil)
	}

	plan, err := q.GetPlanByID(ctx, inv.PlanID)
	if err != nil {
		return httpx.Internal(fmt.Errorf("ambil plan: %w", err))
	}
	sub, err := q.GetSubscriptionByTenant(ctx, inv.TenantID)
	if err != nil {
		return httpx.Internal(fmt.Errorf("ambil subscription: %w", err))
	}

	base := time.Now()
	if sub.CurrentPeriodEnd.Valid && sub.CurrentPeriodEnd.Time.After(base) {
		base = sub.CurrentPeriodEnd.Time
	}
	var newPeriodEnd time.Time
	if plan.BillingInterval == "yearly" {
		newPeriodEnd = base.AddDate(1, 0, 0)
	} else {
		newPeriodEnd = base.AddDate(0, 1, 0)
	}

	if err := q.MarkInvoicePaid(ctx, db.MarkInvoicePaidParams{ID: invoiceID, ConfirmedBy: dbx.UUID(adminUserID)}); err != nil {
		return httpx.Internal(fmt.Errorf("menandai invoice lunas: %w", err))
	}
	if err := q.ActivateSubscriptionPeriod(ctx, db.ActivateSubscriptionPeriodParams{TenantID: inv.TenantID, CurrentPeriodEnd: dbx.TS(newPeriodEnd)}); err != nil {
		return httpx.Internal(fmt.Errorf("memperbarui periode langganan: %w", err))
	}
	return nil
}

// GetStatusAsSystem sama seperti GetStatus, tapi lewat rls.RunAsSystem —
// dipakai RequireActiveSubscription karena pemanggilnya bisa jadi BUKAN
// anggota tenant sama sekali (pelanggan yang memesan tiket online), yang
// berarti baris subscriptions akan disembunyikan RLS kalau dicek lewat
// GetStatus biasa.
func (s *Service) GetStatusAsSystem(ctx context.Context, tenantID uuid.UUID) (SubscriptionInfo, error) {
	var info SubscriptionInfo
	err := rls.RunAsSystem(ctx, s.pool, func(sysCtx context.Context) error {
		result, err := s.GetStatus(sysCtx, tenantID)
		info = result
		return err
	})
	return info, err
}
