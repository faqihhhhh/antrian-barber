package tenant

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"kapsflow/internal/authorization"
	db "kapsflow/internal/db"
	"kapsflow/internal/httpx"
	"kapsflow/internal/identity"
	"kapsflow/internal/pgerr"
	"kapsflow/internal/rls"
)

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
func (s *Service) CreateTenant(ctx context.Context, userID uuid.UUID, name string) (db.Tenant, error) {
	q := s.queries(ctx)

	tenantID := uuid.New()
	if err := q.CreateTenant(ctx, db.CreateTenantParams{ID: tenantID, Name: name}); err != nil {
		return db.Tenant{}, httpx.Internal(fmt.Errorf("membuat tenant: %w", err))
	}

	_, err := q.CreateMembership(ctx, db.CreateMembershipParams{
		TenantID: tenantID,
		UserID:   userID,
		Roles:    []string{"owner"},
	})
	if err != nil {
		return db.Tenant{}, httpx.Internal(fmt.Errorf("membuat membership owner: %w", err))
	}

	t, err := q.GetTenantByID(ctx, tenantID)
	if err != nil {
		return db.Tenant{}, httpx.Internal(fmt.Errorf("ambil tenant setelah dibuat: %w", err))
	}
	return t, nil
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

func (s *Service) CreateOutlet(ctx context.Context, tenantID uuid.UUID, name, timezone, address string) (db.Outlet, error) {
	user, ok := identity.UserFromContext(ctx)
	if !ok {
		return db.Outlet{}, httpx.Unauthorized("belum_masuk", "Silakan masuk terlebih dahulu", nil)
	}
	q := s.queries(ctx)
	if err := authorization.RequireTenantRole(ctx, q, tenantID, user.ID, "owner"); err != nil {
		return db.Outlet{}, err
	}

	slug, err := s.uniqueSlug(ctx, q, name)
	if err != nil {
		return db.Outlet{}, err
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
			return db.Outlet{}, httpx.Conflict("slug_bentrok", "Alamat outlet bentrok, coba lagi", nil)
		}
		return db.Outlet{}, httpx.Internal(fmt.Errorf("membuat outlet: %w", err))
	}
	return outlet, nil
}

func (s *Service) ListOutlets(ctx context.Context, tenantID uuid.UUID) ([]db.Outlet, error) {
	outlets, err := s.queries(ctx).ListOutletsByTenant(ctx, tenantID)
	if err != nil {
		return nil, httpx.Internal(fmt.Errorf("ambil daftar outlet: %w", err))
	}
	return httpx.NonNil(outlets), nil
}

func (s *Service) UpdateOutletSettings(ctx context.Context, tenantID, outletID uuid.UUID, dpPriceRupiah int64, defaultDurationMinutes int32) (db.Outlet, error) {
	user, ok := identity.UserFromContext(ctx)
	if !ok {
		return db.Outlet{}, httpx.Unauthorized("belum_masuk", "Silakan masuk terlebih dahulu", nil)
	}
	if err := authorization.RequireTenantRole(ctx, s.queries(ctx), tenantID, user.ID, "owner"); err != nil {
		return db.Outlet{}, err
	}
	outlet, err := s.queries(ctx).UpdateOutletSettings(ctx, db.UpdateOutletSettingsParams{
		ID: outletID, DpPriceRupiah: dpPriceRupiah, DefaultDurationMinutes: defaultDurationMinutes,
	})
	if err != nil {
		return db.Outlet{}, httpx.Internal(fmt.Errorf("memperbarui pengaturan outlet: %w", err))
	}
	return outlet, nil
}
