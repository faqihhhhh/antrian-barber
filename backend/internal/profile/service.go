package profile

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"slices"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"kapsflow/internal/cryptox"
	db "kapsflow/internal/db"
	"kapsflow/internal/httpx"
	"kapsflow/internal/rls"
)

// maxQRISBytes membatasi ukuran gambar QRIS statis yang disimpan di database.
const maxQRISBytes = 512 * 1024

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

// requireOwner: pengaturan pembayaran menentukan ke mana uang pelanggan masuk,
// jadi hanya owner yang boleh mengubahnya, bukan admin atau kapster.
func (s *Service) requireOwner(ctx context.Context, q *db.Queries, tenantID, userID uuid.UUID) error {
	m, err := q.GetMembershipForUserAndTenant(ctx, db.GetMembershipForUserAndTenantParams{TenantID: tenantID, UserID: userID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return httpx.Forbidden("bukan_anggota_tenant", "Anda bukan anggota bisnis ini", nil)
		}
		return httpx.Internal(fmt.Errorf("ambil membership: %w", err))
	}
	if !slices.Contains(m.Roles, "owner") {
		return httpx.Forbidden("bukan_owner", "Hanya owner yang bisa mengubah pengaturan pembayaran", nil)
	}
	return nil
}

type Info struct {
	MidtransConfigured   bool `json:"midtrans_configured"`
	ManualQRISConfigured bool `json:"manual_qris_configured"`
	OnboardingCompleted  bool `json:"onboarding_completed"`
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
		MidtransConfigured:   p.MidtransConfiguredAt.Valid,
		ManualQRISConfigured: p.ManualQrisUpdatedAt.Valid,
		OnboardingCompleted:  p.OnboardingCompletedAt.Valid,
	}, nil
}

// SetMidtransKeys mengenkripsi lalu menyimpan kunci Midtrans milik owner.
// Kunci mentahnya tidak pernah disimpan di log maupun dikembalikan lewat API.
func (s *Service) SetMidtransKeys(ctx context.Context, tenantID, userID uuid.UUID, serverKey, clientKey string, isProduction bool) error {
	q := s.queries(ctx)
	if err := s.requireOwner(ctx, q, tenantID, userID); err != nil {
		return err
	}
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

	err = q.UpsertTenantProfileMidtrans(ctx, db.UpsertTenantProfileMidtransParams{
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

func (s *Service) SkipMidtransForNow(ctx context.Context, tenantID, userID uuid.UUID) error {
	q := s.queries(ctx)
	if err := s.requireOwner(ctx, q, tenantID, userID); err != nil {
		return err
	}
	if err := q.MarkOnboardingSkippedMidtrans(ctx, tenantID); err != nil {
		return httpx.Internal(fmt.Errorf("menandai onboarding: %w", err))
	}
	return nil
}

// SetManualQRIS menyimpan gambar QRIS statis owner untuk mode DP manual. Jenis
// file ditentukan dari ISI file (bukan dari header Content-Type kiriman klien).
func (s *Service) SetManualQRIS(ctx context.Context, tenantID, userID uuid.UUID, data []byte) error {
	q := s.queries(ctx)
	if err := s.requireOwner(ctx, q, tenantID, userID); err != nil {
		return err
	}
	if len(data) == 0 {
		return httpx.BadRequest("gambar_kosong", "Gambar QRIS kosong", nil)
	}
	if len(data) > maxQRISBytes {
		return httpx.BadRequest("gambar_terlalu_besar", "Ukuran gambar QRIS maksimal 512 KB", nil)
	}
	contentType := http.DetectContentType(data)
	if contentType != "image/png" && contentType != "image/jpeg" && contentType != "image/webp" {
		return httpx.BadRequest("format_gambar_tidak_didukung", "Gunakan gambar PNG, JPG, atau WebP", nil)
	}
	err := q.SetManualQRIS(ctx, db.SetManualQRISParams{
		TenantID:              tenantID,
		ManualQrisImage:       data,
		ManualQrisContentType: pgtype.Text{String: contentType, Valid: true},
	})
	if err != nil {
		return httpx.Internal(fmt.Errorf("menyimpan gambar qris: %w", err))
	}
	return nil
}

// GetManualQRIS dipakai internal oleh modul lain. TIDAK memeriksa siapa
// pemanggilnya: pemanggil wajib sudah memastikan haknya (misalnya pemilik
// tiket yang pembayarannya masih menunggu).
func (s *Service) GetManualQRIS(ctx context.Context, tenantID uuid.UUID) (data []byte, contentType string, ok bool, err error) {
	runErr := rls.RunAsSystem(ctx, s.pool, func(sysCtx context.Context) error {
		row, qErr := s.queries(sysCtx).GetManualQRIS(sysCtx, tenantID)
		if qErr != nil {
			if errors.Is(qErr, pgx.ErrNoRows) {
				return nil
			}
			return httpx.Internal(fmt.Errorf("ambil gambar qris: %w", qErr))
		}
		if len(row.ManualQrisImage) == 0 || !row.ManualQrisContentType.Valid {
			return nil
		}
		data, contentType, ok = row.ManualQrisImage, row.ManualQrisContentType.String, true
		return nil
	})
	if runErr != nil {
		return nil, "", false, runErr
	}
	return data, contentType, ok, nil
}

// PaymentMode: "midtrans" kalau kunci Midtrans terisi (didahulukan), "manual"
// kalau hanya QRIS statis yang terisi, selain itu "none". Lewat jalur sistem
// karena pembacanya sering pelanggan, yang tidak boleh membaca profil bisnis.
func (s *Service) PaymentMode(ctx context.Context, tenantID uuid.UUID) (string, error) {
	mode := "none"
	err := rls.RunAsSystem(ctx, s.pool, func(sysCtx context.Context) error {
		p, qErr := s.queries(sysCtx).GetTenantProfile(sysCtx, tenantID)
		if qErr != nil {
			if errors.Is(qErr, pgx.ErrNoRows) {
				return nil
			}
			return httpx.Internal(fmt.Errorf("ambil profil tenant: %w", qErr))
		}
		switch {
		case p.MidtransConfiguredAt.Valid && p.MidtransServerKeyEncrypted.Valid:
			mode = "midtrans"
		case p.ManualQrisUpdatedAt.Valid:
			mode = "manual"
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	return mode, nil
}

// GetDecryptedMidtransKeys mendekripsi kunci Midtrans tenant untuk dipakai
// internal (memanggil API Midtrans). TIDAK PERNAH diekspos lewat handler HTTP.
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