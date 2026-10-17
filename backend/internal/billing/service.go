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
	GracePeriod = 3 * 24 * time.Hour
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
func (s *Service) Subscribe(ctx context.Context, tenantID uuid.UUID, planCode string) (OwnerInvoice, error) {
	q := s.queries(ctx)
	user, ok := identity.UserFromContext(ctx)
	if !ok {
		return OwnerInvoice{}, httpx.Unauthorized("belum_masuk", "Silakan masuk terlebih dahulu", nil)
	}
	if err := authorization.RequireTenantRole(ctx, q, tenantID, user.ID, "owner"); err != nil {
		return OwnerInvoice{}, err
	}

	plan, err := q.GetPlanByCode(ctx, planCode)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return OwnerInvoice{}, httpx.BadRequest("paket_tidak_ditemukan", "Paket langganan tidak ditemukan", nil)
		}
		return OwnerInvoice{}, httpx.Internal(fmt.Errorf("ambil plan: %w", err))
	}
	if _, err := q.ExpireTenantInvoices(ctx, tenantID); err != nil {
		return OwnerInvoice{}, httpx.Internal(fmt.Errorf("kedaluwarsakan invoice lama: %w", err))
	}
	if _, err := q.GetPendingInvoiceByTenant(ctx, tenantID); err == nil {
		return OwnerInvoice{}, httpx.Conflict("tagihan_masih_pending", "Masih ada tagihan yang belum diproses untuk bisnis ini", nil)
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return OwnerInvoice{}, httpx.Internal(fmt.Errorf("cek tagihan aktif: %w", err))
	}
	eligible, err := q.CanCreateRenewalInvoice(ctx, tenantID)
	if err == nil && eligible.Valid && !eligible.Bool {
		return OwnerInvoice{}, httpx.Conflict("langganan_masih_aktif", "Tagihan perpanjangan baru bisa dibuat dalam 7 hari sebelum periode berakhir", nil)
	} else if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return OwnerInvoice{}, httpx.Internal(fmt.Errorf("cek waktu perpanjangan: %w", err))
	}

	if _, err := q.UpsertSubscription(ctx, db.UpsertSubscriptionParams{TenantID: tenantID, PlanID: plan.ID}); err != nil {
		return OwnerInvoice{}, httpx.Internal(fmt.Errorf("upsert subscription: %w", err))
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
		})
		if err == nil {
			return ownerInvoiceFromDB(invoice), nil
		}
		if errors.Is(err, pgx.ErrNoRows) {
			if _, pendingErr := q.GetPendingInvoiceByTenant(ctx, tenantID); pendingErr == nil {
				return OwnerInvoice{}, httpx.Conflict("tagihan_masih_pending", "Masih ada tagihan yang belum diproses untuk bisnis ini", nil)
			} else if !errors.Is(pendingErr, pgx.ErrNoRows) {
				return OwnerInvoice{}, httpx.Internal(fmt.Errorf("cek tagihan aktif setelah konflik: %w", pendingErr))
			}
			continue // nominal bentrok; ON CONFLICT DO NOTHING tidak membatalkan transaksi
		}
		return OwnerInvoice{}, httpx.Internal(fmt.Errorf("membuat invoice: %w", err))
	}
	return OwnerInvoice{}, httpx.Internal(fmt.Errorf("gagal menemukan nominal unik setelah %d percobaan", maxAttempts))
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

func (s *Service) GetOwnerStatus(ctx context.Context, tenantID uuid.UUID) (SubscriptionInfo, error) {
	user, ok := identity.UserFromContext(ctx)
	if !ok {
		return SubscriptionInfo{}, httpx.Unauthorized("belum_masuk", "Silakan masuk terlebih dahulu", nil)
	}
	if err := authorization.RequireTenantRole(ctx, s.queries(ctx), tenantID, user.ID, "owner"); err != nil {
		return SubscriptionInfo{}, err
	}
	return s.GetStatus(ctx, tenantID)
}

type OwnerInvoice struct {
	ID           uuid.UUID  `json:"id"`
	AmountRupiah int64      `json:"amount_rupiah"`
	UniqueCode   int16      `json:"unique_code"`
	Status       string     `json:"status"`
	ExpiresAt    *time.Time `json:"expires_at"`
	PaidAt       *time.Time `json:"paid_at"`
	PeriodStart  *time.Time `json:"period_start"`
	PeriodEnd    *time.Time `json:"period_end"`
	CreatedAt    time.Time  `json:"created_at"`
}

func ownerInvoiceFromDB(invoice db.Invoice) OwnerInvoice {
	item := OwnerInvoice{
		ID: invoice.ID, AmountRupiah: invoice.AmountRupiah, UniqueCode: invoice.UniqueCode,
		Status: invoice.Status, CreatedAt: invoice.CreatedAt.Time,
	}
	if invoice.ExpiresAt.Valid {
		value := invoice.ExpiresAt.Time
		item.ExpiresAt = &value
	}
	if invoice.PaidAt.Valid {
		value := invoice.PaidAt.Time
		item.PaidAt = &value
	}
	if invoice.PeriodStart.Valid {
		value := invoice.PeriodStart.Time
		item.PeriodStart = &value
	}
	if invoice.PeriodEnd.Valid {
		value := invoice.PeriodEnd.Time
		item.PeriodEnd = &value
	}
	return item
}

func (s *Service) ListInvoices(ctx context.Context, tenantID uuid.UUID) ([]OwnerInvoice, error) {
	user, ok := identity.UserFromContext(ctx)
	if !ok {
		return nil, httpx.Unauthorized("belum_masuk", "Silakan masuk terlebih dahulu", nil)
	}
	if err := authorization.RequireTenantRole(ctx, s.queries(ctx), tenantID, user.ID, "owner"); err != nil {
		return nil, err
	}
	invoices, err := s.queries(ctx).ListInvoicesByTenant(ctx, tenantID)
	if err != nil {
		return nil, httpx.Internal(fmt.Errorf("ambil daftar invoice: %w", err))
	}
	result := make([]OwnerInvoice, 0, len(invoices))
	for _, invoice := range invoices {
		result = append(result, ownerInvoiceFromDB(invoice))
	}
	return result, nil
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
	paid, err := q.MarkInvoicePaid(ctx, db.MarkInvoicePaidParams{ID: invoiceID, ConfirmedBy: dbx.UUID(adminUserID)})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return httpx.Conflict("invoice_sudah_diproses", "Invoice ini sudah dibayar atau dibatalkan", nil)
		}
		return httpx.Internal(fmt.Errorf("menandai invoice lunas: %w", err))
	}
	period, err := q.ActivateSubscriptionPeriodFromPayment(ctx, db.ActivateSubscriptionPeriodFromPaymentParams{
		TenantID: paid.TenantID, PaidAt: paid.PaidAt, BillingInterval: plan.BillingInterval,
	})
	if err != nil {
		return httpx.Internal(fmt.Errorf("memperbarui periode langganan: %w", err))
	}
	updated, err := q.RecordInvoiceSubscriptionPeriod(ctx, db.RecordInvoiceSubscriptionPeriodParams{
		ID: invoiceID, PeriodStart: period.PeriodStart, PeriodEnd: period.PeriodEnd,
	})
	if err != nil {
		return httpx.Internal(fmt.Errorf("mencatat periode invoice: %w", err))
	}
	if updated != 1 {
		return httpx.Internal(fmt.Errorf("mencatat periode invoice: jumlah baris berubah %d", updated))
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
