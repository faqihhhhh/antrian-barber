package staff

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"kapsflow/internal/authorization"
	db "kapsflow/internal/db"
	"kapsflow/internal/httpx"
	"kapsflow/internal/identity"
	"kapsflow/internal/rls"
)

const staffVerificationTTL = 7 * 24 * time.Hour

var validRoles = map[string]bool{"admin": true, "kapster": true}

type Service struct {
	fallback    *db.Queries
	identitySvc *identity.Service
}

func NewService(pool *pgxpool.Pool, identitySvc *identity.Service) *Service {
	return &Service{fallback: db.New(pool), identitySvc: identitySvc}
}

func (s *Service) queries(ctx context.Context) *db.Queries {
	if tx, ok := rls.TxFromContext(ctx); ok {
		return db.New(tx)
	}
	return s.fallback
}

type InviteInput struct {
	Email     string
	Password  string
	Roles     []string
	OutletIDs []uuid.UUID
}

// InviteStaff membuat akun baru untuk karyawan (email + password ditentukan
// owner), menautkannya ke tenant dengan peran dan outlet yang dipilih, lalu
// mengirim email verifikasi bermasa berlaku 7 hari. Semua langkah ini satu
// transaksi RLS yang sama — kalau salah satu gagal, semuanya batal,
// termasuk baris user yang baru dibuat.
func (s *Service) InviteStaff(ctx context.Context, tenantID uuid.UUID, in InviteInput) (db.Membership, error) {
	caller, ok := identity.UserFromContext(ctx)
	if !ok {
		return db.Membership{}, httpx.Unauthorized("belum_masuk", "Silakan masuk terlebih dahulu", nil)
	}
	q := s.queries(ctx)
	if err := authorization.RequireTenantRole(ctx, q, tenantID, caller.ID, "owner"); err != nil {
		return db.Membership{}, err
	}
	if len(in.Roles) == 0 {
		return db.Membership{}, httpx.BadRequest("peran_wajib_diisi", "Pilih minimal satu peran: admin dan/atau kapster", nil)
	}
	for _, role := range in.Roles {
		if !validRoles[role] {
			return db.Membership{}, httpx.BadRequest("peran_tidak_valid", "Peran hanya boleh admin atau kapster", nil)
		}
	}
	if len(in.OutletIDs) == 0 {
		return db.Membership{}, httpx.BadRequest("outlet_wajib_diisi", "Pilih minimal satu outlet tempat staf bertugas", nil)
	}
	if len(in.Password) < 8 {
		return db.Membership{}, httpx.BadRequest("password_terlalu_pendek", "Password minimal 8 karakter", nil)
	}

	if _, err := q.GetUserByEmail(ctx, in.Email); err == nil {
		return db.Membership{}, httpx.Conflict("email_sudah_terdaftar", "Email ini sudah dipakai akun Kapsflow lain", nil)
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return db.Membership{}, httpx.Internal(fmt.Errorf("cek email staf: %w", err))
	}

	hash, err := identity.HashPassword(in.Password)
	if err != nil {
		return db.Membership{}, httpx.Internal(err)
	}
	user, err := q.CreateUser(ctx, db.CreateUserParams{Email: in.Email, PasswordHash: hash})
	if err != nil {
		return db.Membership{}, httpx.Internal(fmt.Errorf("membuat user staf: %w", err))
	}

	membership, err := q.CreateMembership(ctx, db.CreateMembershipParams{TenantID: tenantID, UserID: user.ID, Roles: in.Roles})
	if err != nil {
		return db.Membership{}, httpx.Internal(fmt.Errorf("membuat membership staf: %w", err))
	}

	for _, outletID := range in.OutletIDs {
		if err := q.AddMembershipOutlet(ctx, db.AddMembershipOutletParams{MembershipID: membership.ID, OutletID: outletID}); err != nil {
			return db.Membership{}, httpx.Internal(fmt.Errorf("menautkan outlet staf: %w", err))
		}
	}

	if err := s.identitySvc.SendVerificationEmailUsing(ctx, q, user.ID, user.Email, staffVerificationTTL); err != nil {
		return db.Membership{}, err
	}

	return membership, nil
}

type Member struct {
	MembershipID  uuid.UUID `json:"membership_id"`
	UserID        uuid.UUID `json:"user_id"`
	Email         string    `json:"email"`
	Roles         []string  `json:"roles"`
	EmailVerified bool      `json:"email_verified"`
}

func (s *Service) ListStaff(ctx context.Context, tenantID uuid.UUID) ([]Member, error) {
	rows, err := s.queries(ctx).ListStaffByTenant(ctx, tenantID)
	if err != nil {
		return nil, httpx.Internal(fmt.Errorf("ambil daftar staf: %w", err))
	}
	result := make([]Member, 0, len(rows))
	for _, row := range rows {
		result = append(result, Member{
			MembershipID:  row.MembershipID,
			UserID:        row.UserID,
			Email:         row.Email,
			Roles:         row.Roles,
			EmailVerified: row.EmailVerifiedAt.Valid,
		})
	}
	return result, nil
}
