package tenant

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"kapsflow/internal/authorization"
	db "kapsflow/internal/db"
	"kapsflow/internal/httpx"
	"kapsflow/internal/identity"
	"kapsflow/internal/pgerr"
	"kapsflow/internal/rls"
)

type OutletSettings struct {
	ID                     uuid.UUID `json:"id"`
	Name                   string    `json:"name"`
	Slug                   string    `json:"slug"`
	Timezone               string    `json:"timezone"`
	Address                string    `json:"address"`
	DPPriceRupiah          int64     `json:"dp_price_rupiah"`
	DefaultDurationMinutes int32     `json:"default_duration_minutes"`
}

// TenantInfo adalah respons aman untuk bisnis yang baru dibuat.
type TenantInfo struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
}

func outletSettings(outlet db.Outlet) OutletSettings {
	return OutletSettings{
		ID: outlet.ID, Name: outlet.Name, Slug: outlet.Slug, Timezone: outlet.Timezone,
		Address: outlet.Address.String, DPPriceRupiah: outlet.DpPriceRupiah,
		DefaultDurationMinutes: outlet.DefaultDurationMinutes,
	}
}

type Service struct {
	fallback *db.Queries // dipakai kalau tidak ada transaksi RLS (seharusnya tidak terjadi kalau middleware terpasang benar)
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{fallback: db.New(pool)}
}

func (s *Service) queries(ctx context.Context) *db.Queries {
	if tx, ok := rls.TxFromContext(ctx); ok {
		return db.New(tx)
	}
	return s.fallback
}

// CreateTenant membuat bisnis baru sekaligus menjadikan pemanggil sebagai
// owner-nya. Dua INSERT ini berjalan dalam satu transaksi RLS yang sama
// (dari rls.Middleware), jadi kalau salah satu gagal, keduanya batal.
func (s *Service) CreateTenant(ctx context.Context, userID uuid.UUID, name string) (TenantInfo, error) {
	q := s.queries(ctx)
	name = strings.TrimSpace(name)
	if name == "" || len([]rune(name)) > 100 {
		return TenantInfo{}, httpx.BadRequest("nama_bisnis_tidak_valid", "Nama bisnis wajib diisi dan maksimal 100 karakter", nil)
	}

	tenantID := uuid.New()
	if err := q.CreateTenant(ctx, db.CreateTenantParams{ID: tenantID, Name: name}); err != nil {
		return TenantInfo{}, httpx.Internal(fmt.Errorf("membuat tenant: %w", err))
	}

	_, err := q.CreateMembership(ctx, db.CreateMembershipParams{
		TenantID: tenantID,
		UserID:   userID,
		Roles:    []string{"owner"},
	})
	if err != nil {
		return TenantInfo{}, httpx.Internal(fmt.Errorf("membuat membership owner: %w", err))
	}

	return TenantInfo{ID: tenantID, Name: name}, nil
}

func (s *Service) ListTenants(ctx context.Context) ([]db.Tenant, error) {
	tenants, err := s.queries(ctx).ListTenants(ctx)
	if err != nil {
		return nil, httpx.Internal(fmt.Errorf("ambil daftar tenant: %w", err))
	}
	return httpx.NonNil(tenants), nil
}

func (s *Service) uniqueSlug(ctx context.Context, q *db.Queries, name string) (string, error) {
	base := slugify(name)
	candidate := base
	for attempt := 0; attempt < 6; attempt++ {
		taken, err := q.SlugExists(ctx, candidate)
		if err != nil {
			return "", httpx.Internal(fmt.Errorf("cek slug: %w", err))
		}
		if !taken {
			return candidate, nil
		}
		suffix, err := randomSuffix(4)
		if err != nil {
			return "", httpx.Internal(err)
		}
		candidate = base + "-" + suffix
	}
	return "", httpx.Conflict("slug_bentrok", "Gagal membuat alamat outlet, coba lagi", nil)
}

func (s *Service) CreateOutlet(ctx context.Context, tenantID uuid.UUID, name, timezone, address string) (OutletSettings, error) {
	user, ok := identity.UserFromContext(ctx)
	if !ok {
		return OutletSettings{}, httpx.Unauthorized("belum_masuk", "Silakan masuk terlebih dahulu", nil)
	}
	q := s.queries(ctx)
	if err := authorization.RequireTenantRole(ctx, q, tenantID, user.ID, "owner"); err != nil {
		return OutletSettings{}, err
	}

	slug, err := s.uniqueSlug(ctx, q, name)
	if err != nil {
		return OutletSettings{}, err
	}
	outlet, err := q.CreateOutlet(ctx, db.CreateOutletParams{
		TenantID: tenantID,
		Name:     name,
		Timezone: timezone,
		Address:  pgtype.Text{String: address, Valid: address != ""},
		Slug:     slug,
	})
	if err != nil {
		if pgerr.IsUniqueViolationOn(err, "idx_outlets_slug") {
			return OutletSettings{}, httpx.Conflict("slug_bentrok", "Alamat outlet bentrok, coba lagi", nil)
		}
		return OutletSettings{}, httpx.Internal(fmt.Errorf("membuat outlet: %w", err))
	}
	return outletSettings(outlet), nil
}

func (s *Service) ListOutlets(ctx context.Context, tenantID uuid.UUID) ([]OutletSettings, error) {
	user, ok := identity.UserFromContext(ctx)
	if !ok {
		return nil, httpx.Unauthorized("belum_masuk", "Silakan masuk terlebih dahulu", nil)
	}
	q := s.queries(ctx)
	if err := authorization.RequireTenantRole(ctx, q, tenantID, user.ID, "owner"); err != nil {
		return nil, err
	}
	outlets, err := q.ListOutletsByTenant(ctx, tenantID)
	if err != nil {
		return nil, httpx.Internal(fmt.Errorf("ambil daftar outlet: %w", err))
	}
	result := make([]OutletSettings, 0, len(outlets))
	for _, outlet := range outlets {
		result = append(result, outletSettings(outlet))
	}
	return result, nil
}

func (s *Service) UpdateOutletSettings(ctx context.Context, tenantID, outletID uuid.UUID, dpPriceRupiah int64, defaultDurationMinutes int32) (OutletSettings, error) {
	user, ok := identity.UserFromContext(ctx)
	if !ok {
		return OutletSettings{}, httpx.Unauthorized("belum_masuk", "Silakan masuk terlebih dahulu", nil)
	}
	q := s.queries(ctx)
	if err := authorization.RequireTenantRole(ctx, q, tenantID, user.ID, "owner"); err != nil {
		return OutletSettings{}, err
	}
	if dpPriceRupiah < 0 || defaultDurationMinutes < 1 {
		return OutletSettings{}, httpx.BadRequest("pengaturan_tidak_valid", "Harga DP tidak boleh negatif dan durasi harus lebih dari nol", nil)
	}
	outlet, err := q.UpdateOutletSettings(ctx, db.UpdateOutletSettingsParams{
		ID: outletID, TenantID: tenantID, DpPriceRupiah: dpPriceRupiah, DefaultDurationMinutes: defaultDurationMinutes,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return OutletSettings{}, httpx.NotFound("outlet_tidak_ditemukan", "Outlet tidak ditemukan di bisnis ini", err)
		}
		return OutletSettings{}, httpx.Internal(fmt.Errorf("memperbarui pengaturan outlet: %w", err))
	}
	return outletSettings(outlet), nil
}
