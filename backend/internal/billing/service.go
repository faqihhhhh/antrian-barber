package billing

import (
	"context"
	"errors"
	"fmt"
	"math/rand/v2"
	"net/http"
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
	GracePeriod          = 3 * 24 * time.Hour
	maxPlatformQRISBytes = 512 * 1024
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

func publicPlan(plan db.Plan) PublicPlan {
	return PublicPlan{Code: plan.Code, Name: plan.Name, PriceRupiah: plan.PriceRupiah, BillingInterval: plan.BillingInterval}
}

type PaymentOptions struct {
	ManualQRISConfigured               bool  `json:"manual_qris_configured"`
	ManualTransferConfigured           bool  `json:"manual_transfer_configured"`
	MidtransConfigured                 bool  `json:"midtrans_configured"`
	AdditionalOutletMonthlyPriceRupiah int64 `json:"additional_outlet_monthly_price_rupiah"`
	AdditionalOutletYearlyPriceRupiah  int64 `json:"additional_outlet_yearly_price_rupiah"`
	TransferDetails
}

type AdminInvoice struct {
	ID            uuid.UUID  `json:"id"`
	TenantID      uuid.UUID  `json:"tenant_id"`
	TenantName    string     `json:"tenant_name"`
	PlanName      string     `json:"plan_name"`
	AmountRupiah  int64      `json:"amount_rupiah"`
	UniqueCode    int16      `json:"unique_code"`
	PaymentMethod string     `json:"payment_method"`
	InvoiceKind   string     `json:"invoice_kind"`
	OutletName    string     `json:"outlet_name"`
	Status        string     `json:"status"`
	ExpiresAt     *time.Time `json:"expires_at"`
	CreatedAt     time.Time  `json:"created_at"`
}

type PlatformPaymentInfo struct {
	ManualQRISConfigured               bool  `json:"manual_qris_configured"`
	ManualTransferConfigured           bool  `json:"manual_transfer_configured"`
	MidtransConfigured                 bool  `json:"midtrans_configured"`
	AdditionalOutletMonthlyPriceRupiah int64 `json:"additional_outlet_monthly_price_rupiah"`
	AdditionalOutletYearlyPriceRupiah  int64 `json:"additional_outlet_yearly_price_rupiah"`
	TransferDetails
}

type TransferDetails struct {
	RecipientName string `json:"recipient_name"`
	BankName      string `json:"bank_name"`
	BankAccount   string `json:"bank_account"`
	DanaNumber    string `json:"dana_number"`
	GopayNumber   string `json:"gopay_number"`
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
		result = append(result, publicPlan(plan))
	}
	return result, nil
}

// UpdatePlanPrice hanya dipanggil dari rute admin yang sudah dilindungi
// RequirePlatformAdmin. Kode paket dan periode tetap; admin hanya mengubah harga.
func (s *Service) UpdatePlanPrice(ctx context.Context, code string, price int64) (PublicPlan, error) {
	if err := s.platformAdmin(ctx); err != nil {
		return PublicPlan{}, err
	}
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
	return publicPlan(plan), nil
}

func (s *Service) platformAdmin(ctx context.Context) error {
	user, ok := identity.UserFromContext(ctx)
	if !ok {
		return httpx.Unauthorized("belum_masuk", "Silakan masuk terlebih dahulu", nil)
	}
	admin, err := s.IsPlatformAdmin(ctx, user.ID)
	if err != nil {
		return err
	}
	if !admin {
		return httpx.Forbidden("bukan_admin", "Hanya pemilik SaaS yang bisa mengakses ini", nil)
	}
	return nil
}

func (s *Service) PlatformPaymentInfo(ctx context.Context) (PlatformPaymentInfo, error) {
	if err := s.platformAdmin(ctx); err != nil {
		return PlatformPaymentInfo{}, err
	}
	return s.getPlatformPaymentInfo(ctx)
}

func (s *Service) SetPlatformOutletAddonPrices(ctx context.Context, monthly, yearly int64) error {
	if err := s.platformAdmin(ctx); err != nil {
		return err
	}
	if monthly < 0 || yearly < 0 {
		return httpx.BadRequest("harga_tidak_valid", "Harga outlet tambahan tidak boleh negatif", nil)
	}
	if err := s.queries(ctx).SetPlatformOutletAddonPrices(ctx, db.SetPlatformOutletAddonPricesParams{
		AdditionalOutletMonthlyPriceRupiah: monthly,
		AdditionalOutletYearlyPriceRupiah:  yearly,
	}); err != nil {
		return httpx.Internal(fmt.Errorf("simpan harga outlet tambahan: %w", err))
	}
	return nil
}

func platformQRISContentType(data []byte) string {
	contentType := http.DetectContentType(data)
	if contentType == "image/png" || contentType == "image/jpeg" || contentType == "image/webp" {
		return contentType
	}
	return ""
}

func (s *Service) getPlatformPaymentInfo(ctx context.Context) (PlatformPaymentInfo, error) {
	info := PlatformPaymentInfo{MidtransConfigured: s.platformServerKey != ""}
	row, err := s.queries(ctx).GetPlatformPaymentSettings(ctx)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return PlatformPaymentInfo{}, httpx.Internal(fmt.Errorf("ambil pengaturan pembayaran platform: %w", err))
	}
	info.ManualQRISConfigured = err == nil && len(row.ManualQrisImage) > 0 && row.ManualQrisContentType.Valid
	if err == nil {
		info.AdditionalOutletMonthlyPriceRupiah = row.AdditionalOutletMonthlyPriceRupiah
		info.AdditionalOutletYearlyPriceRupiah = row.AdditionalOutletYearlyPriceRupiah
		info.TransferDetails = TransferDetails{
			RecipientName: nullableText(row.TransferRecipientName),
			BankName:      nullableText(row.TransferBankName),
			BankAccount:   nullableText(row.TransferBankAccount),
			DanaNumber:    nullableText(row.TransferDanaNumber),
			GopayNumber:   nullableText(row.TransferGopayNumber),
		}
		info.ManualTransferConfigured = hasTransferDetails(info.TransferDetails)
	}
	return info, nil
}

func nullableText(value pgtype.Text) string {
	if !value.Valid {
		return ""
	}
	return value.String
}

func hasTransferDetails(details TransferDetails) bool {
	return details.BankAccount != "" || details.DanaNumber != "" || details.GopayNumber != ""
}

func normalizeTransferDetails(details TransferDetails) (TransferDetails, string) {
	details.RecipientName = strings.TrimSpace(details.RecipientName)
	details.BankName = strings.TrimSpace(details.BankName)
	details.BankAccount = strings.TrimSpace(details.BankAccount)
	details.DanaNumber = strings.TrimSpace(details.DanaNumber)
	details.GopayNumber = strings.TrimSpace(details.GopayNumber)
	if len(details.RecipientName) > 100 || len(details.BankName) > 80 || len(details.BankAccount) > 40 || len(details.DanaNumber) > 24 || len(details.GopayNumber) > 24 {
		return TransferDetails{}, "data_transfer_tidak_valid"
	}
	if (details.BankName == "") != (details.BankAccount == "") {
		return TransferDetails{}, "rekening_tidak_lengkap"
	}
	if hasTransferDetails(details) && details.RecipientName == "" {
		return TransferDetails{}, "nama_penerima_wajib"
	}
	if !hasTransferDetails(details) {
		return TransferDetails{}, ""
	}
	return details, ""
}

func (s *Service) SetPlatformTransferDetails(ctx context.Context, details TransferDetails) error {
	if err := s.platformAdmin(ctx); err != nil {
		return err
	}
	var validationMessage string
	details, validationMessage = normalizeTransferDetails(details)
	switch validationMessage {
	case "data_transfer_tidak_valid":
		return httpx.BadRequest(validationMessage, "Ada informasi transfer yang terlalu panjang", nil)
	case "rekening_tidak_lengkap":
		return httpx.BadRequest(validationMessage, "Isi nama bank dan nomor rekening, atau kosongkan keduanya", nil)
	case "nama_penerima_wajib":
		return httpx.BadRequest(validationMessage, "Isi nama pemilik rekening atau dompet digital", nil)
	}
	q := s.queries(ctx)
	pending, err := q.CountPendingManualInvoices(ctx)
	if err != nil {
		return httpx.Internal(fmt.Errorf("cek tagihan manual tertunda: %w", err))
	}
	if pending > 0 {
		return httpx.Conflict("tagihan_manual_masih_pending", "Informasi transfer tidak dapat diubah selama ada tagihan manual yang menunggu pembayaran", nil)
	}
	toText := func(value string) pgtype.Text {
		if value == "" {
			return pgtype.Text{}
		}
		return pgtype.Text{String: value, Valid: true}
	}
	if err := q.SetPlatformTransferDetails(ctx, db.SetPlatformTransferDetailsParams{
		TransferRecipientName: toText(details.RecipientName), TransferBankName: toText(details.BankName),
		TransferBankAccount: toText(details.BankAccount), TransferDanaNumber: toText(details.DanaNumber),
		TransferGopayNumber: toText(details.GopayNumber),
	}); err != nil {
		return httpx.Internal(fmt.Errorf("simpan detail transfer platform: %w", err))
	}
	return nil
}

func (s *Service) SetPlatformManualQRIS(ctx context.Context, data []byte) error {
	if err := s.platformAdmin(ctx); err != nil {
		return err
	}
	if len(data) == 0 {
		return httpx.BadRequest("gambar_kosong", "Gambar QRIS kosong", nil)
	}
	if len(data) > maxPlatformQRISBytes {
		return httpx.BadRequest("gambar_terlalu_besar", "Ukuran gambar QRIS maksimal 512 KB", nil)
	}
	contentType := platformQRISContentType(data)
	if contentType == "" {
		return httpx.BadRequest("format_gambar_tidak_didukung", "Gunakan gambar PNG, JPG, atau WebP", nil)
	}
	q := s.queries(ctx)
	current, currentErr := q.GetPlatformPaymentSettings(ctx)
	if currentErr != nil && !errors.Is(currentErr, pgx.ErrNoRows) {
		return httpx.Internal(fmt.Errorf("cek QRIS manual platform: %w", currentErr))
	}
	if currentErr == nil && len(current.ManualQrisImage) > 0 {
		pending, err := q.CountPendingManualInvoices(ctx)
		if err != nil {
			return httpx.Internal(fmt.Errorf("cek tagihan manual tertunda: %w", err))
		}
		if pending > 0 {
			return httpx.Conflict("tagihan_manual_masih_pending", "QRIS tidak dapat diganti selama masih ada tagihan manual yang menunggu pembayaran", nil)
		}
	}
	err := q.SetPlatformManualQRIS(ctx, db.SetPlatformManualQRISParams{
		ManualQrisImage: data, ManualQrisContentType: pgtype.Text{String: contentType, Valid: true},
	})
	if err != nil {
		return httpx.Internal(fmt.Errorf("simpan QRIS manual platform: %w", err))
	}
	return nil
}

func (s *Service) ClearPlatformManualQRIS(ctx context.Context) error {
	if err := s.platformAdmin(ctx); err != nil {
		return err
	}
	q := s.queries(ctx)
	pending, err := q.CountPendingManualInvoices(ctx)
	if err != nil {
		return httpx.Internal(fmt.Errorf("cek tagihan manual tertunda: %w", err))
	}
	if pending > 0 {
		return httpx.Conflict("tagihan_manual_masih_pending", "QRIS tidak dapat dihapus selama masih ada tagihan manual yang menunggu pembayaran", nil)
	}
	if err := q.ClearPlatformManualQRIS(ctx); err != nil {
		return httpx.Internal(fmt.Errorf("hapus QRIS manual platform: %w", err))
	}
	return nil
}

func (s *Service) GetPlatformManualQRIS(ctx context.Context) ([]byte, string, error) {
	if err := s.platformAdmin(ctx); err != nil {
		return nil, "", err
	}
	return s.getManualQRISImage(ctx)
}

func (s *Service) getManualQRISImage(ctx context.Context) ([]byte, string, error) {
	row, err := s.queries(ctx).GetPlatformPaymentSettings(ctx)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, "", httpx.NotFound("qris_tidak_tersedia", "QRIS manual platform belum dipasang", nil)
		}
		return nil, "", httpx.Internal(fmt.Errorf("ambil QRIS manual platform: %w", err))
	}
	if len(row.ManualQrisImage) == 0 || !row.ManualQrisContentType.Valid {
		return nil, "", httpx.NotFound("qris_tidak_tersedia", "QRIS manual platform belum dipasang", nil)
	}
	return row.ManualQrisImage, row.ManualQrisContentType.String, nil
}

func (s *Service) OwnerPaymentOptions(ctx context.Context, tenantID uuid.UUID) (PaymentOptions, error) {
	user, ok := identity.UserFromContext(ctx)
	if !ok {
		return PaymentOptions{}, httpx.Unauthorized("belum_masuk", "Silakan masuk terlebih dahulu", nil)
	}
	if err := authorization.RequireTenantRole(ctx, s.queries(ctx), tenantID, user.ID, "owner"); err != nil {
		return PaymentOptions{}, err
	}
	var info PaymentOptions
	err := rls.RunAsSystem(ctx, s.pool, func(sysCtx context.Context) error {
		platformInfo, err := s.getPlatformPaymentInfo(sysCtx)
		info = PaymentOptions(platformInfo)
		return err
	})
	return info, err
}

func (s *Service) GetOwnerPlatformManualQRIS(ctx context.Context, tenantID uuid.UUID) ([]byte, string, error) {
	user, ok := identity.UserFromContext(ctx)
	if !ok {
		return nil, "", httpx.Unauthorized("belum_masuk", "Silakan masuk terlebih dahulu", nil)
	}
	if err := authorization.RequireTenantRole(ctx, s.queries(ctx), tenantID, user.ID, "owner"); err != nil {
		return nil, "", err
	}
	var data []byte
	var contentType string
	err := rls.RunAsSystem(ctx, s.pool, func(sysCtx context.Context) error {
		var err error
		data, contentType, err = s.getManualQRISImage(sysCtx)
		return err
	})
	return data, contentType, err
}

// Subscribe membuat invoice dengan metode QRIS manual atau Midtrans.
func (s *Service) Subscribe(ctx context.Context, tenantID uuid.UUID, planCode, paymentMethod string) (OwnerInvoice, error) {
	if paymentMethod == "" {
		paymentMethod = "midtrans"
	}
	if paymentMethod != "manual" && paymentMethod != "midtrans" {
		return OwnerInvoice{}, httpx.BadRequest("metode_pembayaran_tidak_valid", "Pilih pembayaran QRIS manual atau QRIS otomatis", nil)
	}
	q := s.queries(ctx)
	user, ok := identity.UserFromContext(ctx)
	if !ok {
		return OwnerInvoice{}, httpx.Unauthorized("belum_masuk", "Silakan masuk terlebih dahulu", nil)
	}
	if err := authorization.RequireTenantRole(ctx, q, tenantID, user.ID, "owner"); err != nil {
		return OwnerInvoice{}, err
	}
	options, err := s.OwnerPaymentOptions(ctx, tenantID)
	if err != nil {
		return OwnerInvoice{}, err
	}
	if paymentMethod == "manual" && !options.ManualQRISConfigured && !options.ManualTransferConfigured {
		return OwnerInvoice{}, httpx.Conflict("pembayaran_manual_belum_diatur", "Pembayaran manual platform belum disiapkan. Pilih QRIS otomatis atau hubungi pemilik Trimwait.", nil)
	}
	if paymentMethod == "midtrans" && !options.MidtransConfigured {
		return OwnerInvoice{}, httpx.Conflict("midtrans_belum_diatur", "QRIS otomatis belum tersedia. Pilih QRIS manual atau hubungi pemilik Trimwait.", nil)
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

	var invoice db.Invoice
	const maxAttempts = 10
	for attempt := 0; attempt < maxAttempts; attempt++ {
		uniqueCode := int16(0)
		amount := plan.PriceRupiah
		if paymentMethod == "manual" {
			uniqueCode = int16(1 + rand.IntN(998))
			amount += int64(uniqueCode)
		}
		invoice, err = q.CreateInvoice(ctx, db.CreateInvoiceParams{
			TenantID: tenantID, PlanID: plan.ID, AmountRupiah: amount, UniqueCode: uniqueCode, PaymentMethod: paymentMethod,
		})
		if err == nil {
			break
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return OwnerInvoice{}, httpx.Internal(fmt.Errorf("membuat invoice: %w", err))
		}
		if _, pendingErr := q.GetPendingInvoiceByTenant(ctx, tenantID); pendingErr == nil {
			return OwnerInvoice{}, httpx.Conflict("tagihan_masih_pending", "Masih ada tagihan yang belum diproses untuk bisnis ini", nil)
		} else if !errors.Is(pendingErr, pgx.ErrNoRows) {
			return OwnerInvoice{}, httpx.Internal(fmt.Errorf("cek tagihan aktif setelah konflik: %w", pendingErr))
		}
		if paymentMethod != "manual" {
			return OwnerInvoice{}, httpx.Conflict("tagihan_masih_pending", "Masih ada tagihan yang belum diproses untuk bisnis ini", nil)
		}
	}
	if err != nil {
		return OwnerInvoice{}, httpx.Internal(fmt.Errorf("gagal menemukan nominal unik setelah %d percobaan", maxAttempts))
	}
	if paymentMethod == "manual" {
		return ownerInvoiceFromDB(invoice), nil
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

type OutletAddonRequest struct {
	OutletID        *uuid.UUID `json:"outlet_id"`
	Name            string     `json:"name"`
	Timezone        string     `json:"timezone"`
	Address         string     `json:"address"`
	BillingInterval string     `json:"billing_interval"`
	PaymentMethod   string     `json:"payment_method"`
}

func (s *Service) CreateOutletAddonInvoice(ctx context.Context, tenantID uuid.UUID, req OutletAddonRequest) (OwnerInvoice, error) {
	user, ok := identity.UserFromContext(ctx)
	if !ok {
		return OwnerInvoice{}, httpx.Unauthorized("belum_masuk", "Silakan masuk terlebih dahulu", nil)
	}
	q := s.queries(ctx)
	if err := authorization.RequireTenantRole(ctx, q, tenantID, user.ID, "owner"); err != nil {
		return OwnerInvoice{}, err
	}
	status, err := s.GetOwnerStatus(ctx, tenantID)
	if err != nil {
		return OwnerInvoice{}, err
	}
	if status.Status != StatusActive && status.Status != StatusGrace {
		return OwnerInvoice{}, httpx.PaymentRequired("berlangganan_diperlukan", "Aktifkan langganan bisnis sebelum membeli outlet tambahan", nil)
	}
	if req.BillingInterval != "monthly" && req.BillingInterval != "yearly" {
		return OwnerInvoice{}, httpx.BadRequest("periode_tidak_valid", "Pilih tagihan bulanan atau tahunan", nil)
	}
	if req.PaymentMethod == "" {
		req.PaymentMethod = "manual"
	}
	if req.PaymentMethod != "manual" && req.PaymentMethod != "midtrans" {
		return OwnerInvoice{}, httpx.BadRequest("metode_pembayaran_tidak_valid", "Pilih pembayaran manual atau QRIS otomatis", nil)
	}
	options, err := s.OwnerPaymentOptions(ctx, tenantID)
	if err != nil {
		return OwnerInvoice{}, err
	}
	if req.PaymentMethod == "manual" && !options.ManualQRISConfigured && !options.ManualTransferConfigured {
		return OwnerInvoice{}, httpx.Conflict("pembayaran_manual_belum_diatur", "Pembayaran manual platform belum disiapkan", nil)
	}
	if req.PaymentMethod == "midtrans" && !options.MidtransConfigured {
		return OwnerInvoice{}, httpx.Conflict("midtrans_belum_diatur", "QRIS otomatis belum tersedia", nil)
	}
	if req.OutletID == nil {
		count, err := q.CountOutletsByTenant(ctx, tenantID)
		if err != nil {
			return OwnerInvoice{}, httpx.Internal(fmt.Errorf("menghitung outlet bisnis: %w", err))
		}
		if count == 0 {
			return OwnerInvoice{}, httpx.BadRequest("outlet_pertama_tidak_valid", "Outlet pertama sudah termasuk paket bisnis dan dibuat dari halaman Atur outlet", nil)
		}
		req.Name = strings.TrimSpace(req.Name)
		if req.Name == "" || len([]rune(req.Name)) > 100 {
			return OwnerInvoice{}, httpx.BadRequest("nama_outlet_tidak_valid", "Nama outlet wajib diisi dan maksimal 100 karakter", nil)
		}
		if _, err := time.LoadLocation(req.Timezone); err != nil {
			return OwnerInvoice{}, httpx.BadRequest("zona_waktu_tidak_valid", "Pilih zona waktu outlet yang tersedia", err)
		}
		req.Address = strings.TrimSpace(req.Address)
		if len([]rune(req.Address)) > 300 {
			return OwnerInvoice{}, httpx.BadRequest("alamat_terlalu_panjang", "Alamat outlet maksimal 300 karakter", nil)
		}
	} else {
		outlet, err := q.GetOutletByID(ctx, *req.OutletID)
		if err != nil || outlet.TenantID != tenantID || !outlet.IsAdditional {
			return OwnerInvoice{}, httpx.NotFound("outlet_tidak_ditemukan", "Outlet tambahan tidak ditemukan", err)
		}
	}
	plan, err := q.GetActivePlanByInterval(ctx, req.BillingInterval)
	if err != nil {
		return OwnerInvoice{}, httpx.Internal(fmt.Errorf("ambil harga outlet tambahan: %w", err))
	}
	amount := options.AdditionalOutletMonthlyPriceRupiah
	if req.BillingInterval == "yearly" {
		amount = options.AdditionalOutletYearlyPriceRupiah
	}
	if amount <= 0 {
		return OwnerInvoice{}, httpx.Conflict("harga_outlet_belum_diatur", "Harga outlet tambahan untuk periode ini belum diatur", nil)
	}
	if _, err := q.ExpireTenantInvoices(ctx, tenantID); err != nil {
		return OwnerInvoice{}, httpx.Internal(fmt.Errorf("kedaluwarsakan invoice lama: %w", err))
	}
	if _, err := q.GetPendingInvoiceByTenant(ctx, tenantID); err == nil {
		return OwnerInvoice{}, httpx.Conflict("tagihan_masih_pending", "Selesaikan tagihan yang masih menunggu sebelum membuat tagihan lain", nil)
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return OwnerInvoice{}, httpx.Internal(fmt.Errorf("cek tagihan aktif: %w", err))
	}

	for attempt := 0; attempt < 10; attempt++ {
		uniqueCode := int16(0)
		invoiceAmount := amount
		if req.PaymentMethod == "manual" {
			uniqueCode = int16(1 + rand.IntN(998))
			invoiceAmount += int64(uniqueCode)
		}
		params := db.CreateOutletAddonInvoiceParams{
			TenantID: tenantID, PlanID: plan.ID, AmountRupiah: invoiceAmount, UniqueCode: uniqueCode,
			PaymentMethod: req.PaymentMethod, OutletBillingInterval: pgtype.Text{String: req.BillingInterval, Valid: true},
		}
		if req.OutletID != nil {
			params.OutletID = dbx.UUID(*req.OutletID)
		} else {
			params.RequestedOutletName = pgtype.Text{String: req.Name, Valid: true}
			params.RequestedOutletTimezone = pgtype.Text{String: req.Timezone, Valid: true}
			params.RequestedOutletAddress = pgtype.Text{String: req.Address, Valid: req.Address != ""}
		}
		invoice, err := q.CreateOutletAddonInvoice(ctx, params)
		if errors.Is(err, pgx.ErrNoRows) && req.PaymentMethod == "manual" {
			continue
		}
		if err != nil {
			return OwnerInvoice{}, httpx.Internal(fmt.Errorf("membuat tagihan outlet tambahan: %w", err))
		}
		if req.PaymentMethod == "manual" {
			return ownerInvoiceFromDB(invoice), nil
		}
		orderID := "tw-add-" + invoice.ID.String()
		charge, chargeErr := s.midtrans.ChargeQRIS(ctx, s.platformServerKey, s.platformProduction, orderID, amount)
		if chargeErr != nil {
			_, _ = q.CancelInvoice(ctx, invoice.ID)
			return OwnerInvoice{}, httpx.Internal(fmt.Errorf("membuat pembayaran outlet tambahan: %w", chargeErr))
		}
		if charge.QRCodeURL == "" {
			_, _ = q.CancelInvoice(ctx, invoice.ID)
			return OwnerInvoice{}, httpx.Internal(fmt.Errorf("Midtrans tidak mengembalikan QR untuk invoice outlet %s", invoice.ID))
		}
		rows, saveErr := q.SetInvoiceMidtransPayment(ctx, db.SetInvoiceMidtransPaymentParams{ID: invoice.ID, MidtransOrderID: pgtype.Text{String: orderID, Valid: true}, QrCodeUrl: pgtype.Text{String: charge.QRCodeURL, Valid: true}})
		if saveErr != nil || rows != 1 {
			_, _ = q.CancelInvoice(ctx, invoice.ID)
			return OwnerInvoice{}, httpx.Internal(fmt.Errorf("menyimpan pembayaran outlet: rows=%d err=%w", rows, saveErr))
		}
		invoice.MidtransOrderID = pgtype.Text{String: orderID, Valid: true}
		invoice.QrCodeUrl = pgtype.Text{String: charge.QRCodeURL, Valid: true}
		return ownerInvoiceFromDB(invoice), nil
	}
	return OwnerInvoice{}, httpx.Conflict("nominal_tagihan_bentrok", "Gagal membuat nominal unik, coba lagi", nil)
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
	ID              uuid.UUID  `json:"id"`
	AmountRupiah    int64      `json:"amount_rupiah"`
	UniqueCode      int16      `json:"unique_code"`
	PaymentMethod   string     `json:"payment_method"`
	InvoiceKind     string     `json:"invoice_kind"`
	OutletID        *uuid.UUID `json:"outlet_id"`
	OutletName      *string    `json:"outlet_name"`
	BillingInterval *string    `json:"billing_interval"`
	Status          string     `json:"status"`
	ExpiresAt       *time.Time `json:"expires_at"`
	PaidAt          *time.Time `json:"paid_at"`
	PeriodStart     *time.Time `json:"period_start"`
	PeriodEnd       *time.Time `json:"period_end"`
	QRCodeURL       *string    `json:"qr_code_url"`
	CreatedAt       time.Time  `json:"created_at"`
}

func ownerInvoiceFromDB(invoice db.Invoice) OwnerInvoice {
	item := OwnerInvoice{
		ID: invoice.ID, AmountRupiah: invoice.AmountRupiah, UniqueCode: invoice.UniqueCode,
		PaymentMethod: invoice.PaymentMethod, InvoiceKind: invoice.InvoiceKind, Status: invoice.Status, CreatedAt: invoice.CreatedAt.Time,
	}
	if invoice.OutletID.Valid {
		value := invoice.OutletID.Bytes
		id := uuid.UUID(value)
		item.OutletID = &id
	}
	if invoice.RequestedOutletName.Valid {
		value := invoice.RequestedOutletName.String
		item.OutletName = &value
	}
	if invoice.OutletBillingInterval.Valid {
		value := invoice.OutletBillingInterval.String
		item.BillingInterval = &value
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

func (s *Service) ListPendingInvoices(ctx context.Context) ([]AdminInvoice, error) {
	if err := s.platformAdmin(ctx); err != nil {
		return nil, err
	}
	invoices, err := s.queries(ctx).ListPendingInvoices(ctx)
	if err != nil {
		return nil, httpx.Internal(fmt.Errorf("ambil daftar invoice pending: %w", err))
	}
	result := make([]AdminInvoice, 0, len(invoices))
	for _, invoice := range invoices {
		item := AdminInvoice{
			ID: invoice.ID, TenantID: invoice.TenantID, TenantName: invoice.TenantName,
			PlanName: invoice.PlanName, AmountRupiah: invoice.AmountRupiah,
			UniqueCode: invoice.UniqueCode, PaymentMethod: invoice.PaymentMethod,
			InvoiceKind: invoice.InvoiceKind, OutletName: invoice.OutletName,
			Status: invoice.Status, CreatedAt: invoice.CreatedAt.Time,
		}
		if invoice.ExpiresAt.Valid {
			value := invoice.ExpiresAt.Time
			item.ExpiresAt = &value
		}
		result = append(result, item)
	}
	return httpx.NonNil(result), nil
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
	admin, err := s.IsPlatformAdmin(ctx, adminUserID)
	if err != nil {
		return err
	}
	if !admin {
		return httpx.Forbidden("bukan_admin", "Hanya pemilik SaaS yang bisa mengonfirmasi pembayaran", nil)
	}
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
	if inv.PaymentMethod != "manual" {
		return httpx.Conflict("konfirmasi_manual_tidak_berlaku", "Tagihan QRIS otomatis dikonfirmasi Midtrans", nil)
	}
	if inv.InvoiceKind == "outlet_addon" {
		paid, err := q.MarkInvoicePaid(ctx, db.MarkInvoicePaidParams{ID: invoiceID, ConfirmedBy: dbx.UUID(adminUserID)})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return httpx.Conflict("invoice_sudah_diproses", "Invoice ini sudah dibayar atau dibatalkan", nil)
			}
			return httpx.Internal(fmt.Errorf("menandai invoice outlet lunas: %w", err))
		}
		return activateOutletAddon(ctx, q, inv, paid.PaidAt)
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
	if (!strings.HasPrefix(orderID, "tw-sub-") && !strings.HasPrefix(orderID, "tw-add-")) || s.platformServerKey == "" {
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
	if invoice.InvoiceKind == "outlet_addon" {
		return activateOutletAddon(ctx, q, invoice, paid.PaidAt)
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

func addonSlug(name string) string {
	var b strings.Builder
	separator := false
	for _, r := range strings.ToLower(name) {
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' {
			if separator && b.Len() > 0 {
				b.WriteByte('-')
			}
			b.WriteRune(r)
			separator = false
		} else {
			separator = true
		}
		if b.Len() >= 36 {
			break
		}
	}
	base := strings.Trim(b.String(), "-")
	if base == "" {
		base = "outlet"
	}
	return base + "-" + strings.ReplaceAll(uuid.NewString()[:8], "-", "")
}

func activateOutletAddon(ctx context.Context, q *db.Queries, invoice db.Invoice, paidAt pgtype.Timestamptz) error {
	if !invoice.OutletBillingInterval.Valid {
		return httpx.Internal(fmt.Errorf("periode outlet tidak tercatat pada invoice %s", invoice.ID))
	}
	interval := invoice.OutletBillingInterval.String
	var periodStart, periodEnd pgtype.Timestamptz
	if invoice.OutletID.Valid {
		renewed, err := q.RenewAdditionalOutlet(ctx, db.RenewAdditionalOutletParams{
			ID: uuid.UUID(invoice.OutletID.Bytes), TenantID: invoice.TenantID, PaidAt: paidAt,
			BillingInterval: interval,
		})
		if err != nil {
			return httpx.Internal(fmt.Errorf("memperpanjang outlet tambahan: %w", err))
		}
		periodStart, periodEnd = renewed.PeriodStart, renewed.AdditionalPeriodEnd
	} else {
		if !invoice.RequestedOutletName.Valid || !invoice.RequestedOutletTimezone.Valid {
			return httpx.Internal(fmt.Errorf("detail outlet tidak lengkap pada invoice %s", invoice.ID))
		}
		outlet, err := q.CreatePaidAdditionalOutlet(ctx, db.CreatePaidAdditionalOutletParams{
			TenantID: invoice.TenantID, Name: invoice.RequestedOutletName.String,
			Timezone: invoice.RequestedOutletTimezone.String, Address: invoice.RequestedOutletAddress,
			Slug: addonSlug(invoice.RequestedOutletName.String), PaidAt: paidAt, BillingInterval: interval,
		})
		if err != nil {
			return httpx.Internal(fmt.Errorf("membuat outlet setelah pembayaran: %w", err))
		}
		periodStart, periodEnd = paidAt, outlet.AdditionalPeriodEnd
	}
	updated, err := q.RecordInvoiceSubscriptionPeriod(ctx, db.RecordInvoiceSubscriptionPeriodParams{ID: invoice.ID, PeriodStart: periodStart, PeriodEnd: periodEnd})
	if err != nil {
		return httpx.Internal(fmt.Errorf("mencatat periode outlet invoice: %w", err))
	}
	if updated != 1 {
		return httpx.Internal(fmt.Errorf("mencatat periode outlet invoice: jumlah baris berubah %d", updated))
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

func (s *Service) IsAdditionalOutletActiveAsSystem(ctx context.Context, outletID uuid.UUID) (bool, error) {
	active := false
	err := rls.RunAsSystem(ctx, s.pool, func(sysCtx context.Context) error {
		outlet, err := s.queries(sysCtx).GetOutletByID(sysCtx, outletID)
		if err != nil {
			return err
		}
		active = !outlet.IsAdditional || outlet.AdditionalPeriodEnd.Valid && outlet.AdditionalPeriodEnd.Time.After(time.Now())
		return nil
	})
	return active, err
}

func (s *Service) IsQueueSessionOutletActiveAsSystem(ctx context.Context, sessionID uuid.UUID) (bool, error) {
	active := false
	err := rls.RunAsSystem(ctx, s.pool, func(sysCtx context.Context) error {
		session, err := s.queries(sysCtx).GetQueueSessionByID(sysCtx, sessionID)
		if err != nil {
			return err
		}
		outlet, err := s.queries(sysCtx).GetOutletByID(sysCtx, session.OutletID)
		if err != nil {
			return err
		}
		active = !outlet.IsAdditional || outlet.AdditionalPeriodEnd.Valid && outlet.AdditionalPeriodEnd.Time.After(time.Now())
		return nil
	})
	return active, err
}
