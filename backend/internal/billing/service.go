package billing

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"kapsflow/internal/authorization"
	db "kapsflow/internal/db"
	"kapsflow/internal/dbx"
	"kapsflow/internal/httpx"
	"kapsflow/internal/identity"
	"kapsflow/internal/midtrans"
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
	fallback           *db.Queries
	pool               *pgxpool.Pool
	mailer             identity.Mailer
	log                *slog.Logger
	midtrans           *midtrans.Client
	platformServerKey  string
	platformProduction bool
}

func NewService(pool *pgxpool.Pool, mailer identity.Mailer, log *slog.Logger, client *midtrans.Client, platformServerKey string, platformProduction bool) *Service {
	return &Service{fallback: db.New(pool), pool: pool, mailer: mailer, log: log, midtrans: client, platformServerKey: platformServerKey, platformProduction: platformProduction}
}

func (s *Service) queries(ctx context.Context) *db.Queries {
	if tx, ok := rls.TxFromContext(ctx); ok {
		return db.New(tx)
	}
	return s.fallback
}

type PublicPlan struct {
	Code            string `json:"code"`
	Name            string `json:"name"`
	PriceRupiah     int64  `json:"price_rupiah"`
	BillingInterval string `json:"billing_interval"`
}

// ListPlans publik (halaman harga), tidak lewat RLS karena tabel plans
// memang tidak dibatasi per tenant. Respons hanya memuat data untuk pelanggan.
func (s *Service) ListPlans(ctx context.Context) ([]PublicPlan, error) {
	plans, err := s.fallback.ListActivePlans(ctx)
	if err != nil {
		return nil, httpx.Internal(fmt.Errorf("ambil daftar plan: %w", err))
	}
	result := make([]PublicPlan, 0, len(plans))
	for _, plan := range plans {
		result = append(result, PublicPlan{Code: plan.Code, Name: plan.Name, PriceRupiah: plan.PriceRupiah, BillingInterval: plan.BillingInterval})
	}
	return result, nil
}

// UpdatePlanPrice hanya dipanggil dari rute admin yang sudah dilindungi
// RequirePlatformAdmin. Kode paket dan periode tetap; admin hanya mengubah harga.
func (s *Service) UpdatePlanPrice(ctx context.Context, code string, price int64) (PublicPlan, error) {
	if price < 1 {
		return PublicPlan{}, httpx.BadRequest("harga_tidak_valid", "Harga paket harus lebih dari Rp0", nil)
	}
	plan, err := s.fallback.UpdatePlanPrice(ctx, db.UpdatePlanPriceParams{Code: code, PriceRupiah: price})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return PublicPlan{}, httpx.NotFound("paket_tidak_ditemukan", "Paket langganan tidak ditemukan", nil)
		}
		return PublicPlan{}, httpx.Internal(fmt.Errorf("mengubah harga paket: %w", err))
	}
	return PublicPlan{Code: plan.Code, Name: plan.Name, PriceRupiah: plan.PriceRupiah, BillingInterval: plan.BillingInterval}, nil
}

// Subscribe membuat invoice QR dengan harga paket persis, lalu meminta Midtrans
// membuat QR dinamis atas nama platform.
func (s *Service) Subscribe(ctx context.Context, tenantID uuid.UUID, planCode string) (OwnerInvoice, error) {
	if s.platformServerKey == "" {
		return OwnerInvoice{}, httpx.Conflict("pembayaran_platform_belum_diatur", "Pembayaran langganan belum tersedia. Pemilik Trimwait perlu mengatur akun pembayaran platform.", nil)
	}
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

	invoice, err := q.CreateInvoice(ctx, db.CreateInvoiceParams{
		TenantID: tenantID, PlanID: plan.ID, AmountRupiah: plan.PriceRupiah, UniqueCode: 0,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return OwnerInvoice{}, httpx.Conflict("tagihan_masih_pending", "Masih ada tagihan yang belum diproses untuk bisnis ini", nil)
		}
		return OwnerInvoice{}, httpx.Internal(fmt.Errorf("membuat invoice: %w", err))
	}
	orderID := "tw-sub-" + invoice.ID.String()
	charge, chargeErr := s.midtrans.ChargeQRIS(ctx, s.platformServerKey, s.platformProduction, orderID, plan.PriceRupiah)
	if chargeErr != nil {
		_, _ = q.CancelInvoice(ctx, invoice.ID)
		return OwnerInvoice{}, httpx.Internal(fmt.Errorf("membuat pembayaran QR langganan: %w", chargeErr))
	}
	if charge.QRCodeURL == "" {
		_, _ = q.CancelInvoice(ctx, invoice.ID)
		return OwnerInvoice{}, httpx.Internal(fmt.Errorf("midtrans tidak mengembalikan QR untuk invoice %s", invoice.ID))
	}
	rows, saveErr := q.SetInvoiceMidtransPayment(ctx, db.SetInvoiceMidtransPaymentParams{ID: invoice.ID, MidtransOrderID: pgtype.Text{String: orderID, Valid: true}, QrCodeUrl: pgtype.Text{String: charge.QRCodeURL, Valid: true}})
	if saveErr != nil || rows != 1 {
		_, _ = q.CancelInvoice(ctx, invoice.ID)
		return OwnerInvoice{}, httpx.Internal(fmt.Errorf("menyimpan pembayaran QR langganan: rows=%d err=%w", rows, saveErr))
	}
	invoice.MidtransOrderID = pgtype.Text{String: orderID, Valid: true}
	invoice.QrCodeUrl = pgtype.Text{String: charge.QRCodeURL, Valid: true}
	return ownerInvoiceFromDB(invoice), nil
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
	QRCodeURL    *string    `json:"qr_code_url"`
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
	if invoice.QrCodeUrl.Valid {
		value := invoice.QrCodeUrl.String
		item.QRCodeURL = &value
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
	if _, err := q.SetSubscriptionPlan(ctx, db.SetSubscriptionPlanParams{TenantID: inv.TenantID, PlanID: plan.ID}); err != nil {
		return httpx.Internal(fmt.Errorf("memperbarui paket langganan: %w", err))
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

// ProcessMidtransWebhook mengaktifkan langganan hanya setelah tanda tangan
// Midtrans valid dan nominal notifikasi sama persis dengan invoice.
func (s *Service) ProcessMidtransWebhook(ctx context.Context, orderID, statusCode, grossAmount, signature, txStatus, fraudStatus string) error {
	if !strings.HasPrefix(orderID, "tw-sub-") || s.platformServerKey == "" {
		return httpx.NotFound("tagihan_tidak_ditemukan", "Tagihan langganan tidak ditemukan", nil)
	}
	if !midtrans.VerifySignature(orderID, statusCode, grossAmount, s.platformServerKey, signature) {
		return httpx.Unauthorized("tanda_tangan_tidak_valid", "Tanda tangan notifikasi tidak valid", nil)
	}
	invoice, err := s.queries(ctx).GetInvoiceByMidtransOrderID(ctx, pgtype.Text{String: orderID, Valid: true})
	if err != nil {
		return httpx.NotFound("tagihan_tidak_ditemukan", "Tagihan langganan tidak ditemukan", nil)
	}
	if invoice.Status == "paid" {
		return nil
	}
	if !midtrans.IsPaid(txStatus, fraudStatus) {
		return nil
	}
	amountText := strings.TrimSuffix(grossAmount, ".00")
	amount, parseErr := strconv.ParseInt(amountText, 10, 64)
	if parseErr != nil || amount != invoice.AmountRupiah {
		return httpx.BadRequest("nominal_pembayaran_tidak_cocok", "Nominal pembayaran tidak cocok dengan tagihan", parseErr)
	}
	q := s.queries(ctx)
	paid, err := q.MarkInvoiceMidtransPaid(ctx, db.MarkInvoiceMidtransPaidParams{ID: invoice.ID, AmountRupiah: amount})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil // webhook duplikat atau status invoice sudah berubah
		}
		return httpx.Internal(fmt.Errorf("menandai tagihan QR lunas: %w", err))
	}
	plan, err := q.GetPlanByID(ctx, paid.PlanID)
	if err != nil {
		return httpx.Internal(fmt.Errorf("ambil paket langganan: %w", err))
	}
	if _, err := q.SetSubscriptionPlan(ctx, db.SetSubscriptionPlanParams{TenantID: paid.TenantID, PlanID: plan.ID}); err != nil {
		return httpx.Internal(fmt.Errorf("memperbarui paket langganan: %w", err))
	}
	period, err := q.ActivateSubscriptionPeriodFromPayment(ctx, db.ActivateSubscriptionPeriodFromPaymentParams{TenantID: paid.TenantID, PaidAt: paid.PaidAt, BillingInterval: plan.BillingInterval})
	if err != nil {
		return httpx.Internal(fmt.Errorf("mengaktifkan periode langganan: %w", err))
	}
	updated, err := q.RecordInvoiceSubscriptionPeriod(ctx, db.RecordInvoiceSubscriptionPeriodParams{ID: invoice.ID, PeriodStart: period.PeriodStart, PeriodEnd: period.PeriodEnd})
	if err != nil || updated != 1 {
		return httpx.Internal(fmt.Errorf("mencatat periode tagihan QR: rows=%d err=%w", updated, err))
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
