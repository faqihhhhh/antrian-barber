package staff

import (
	"context"
	"errors"
	"fmt"
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
	"kapsflow/internal/pgerr"
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
	Username  string
	Roles     []string
	OutletIDs []uuid.UUID
}

// InviteStaff membuat akun baru untuk karyawan (email + password ditentukan
// owner), menautkannya ke tenant dengan peran dan outlet yang dipilih, lalu
// mengirim email verifikasi bermasa berlaku 7 hari. Semua langkah ini satu
// transaksi RLS yang sama — kalau salah satu gagal, semuanya batal,
// termasuk baris user yang baru dibuat.
func (s *Service) InviteStaff(ctx context.Context, tenantID uuid.UUID, in InviteInput) (Member, error) {
	caller, ok := identity.UserFromContext(ctx)
	if !ok {
		return Member{}, httpx.Unauthorized("belum_masuk", "Silakan masuk terlebih dahulu", nil)
	}
	q := s.queries(ctx)
	if err := authorization.RequireTenantRole(ctx, q, tenantID, caller.ID, "owner"); err != nil {
		return Member{}, err
	}
	if len(in.Roles) == 0 {
		return Member{}, httpx.BadRequest("peran_wajib_diisi", "Pilih minimal satu peran: admin dan/atau kapster", nil)
	}
	for _, role := range in.Roles {
		if !validRoles[role] {
			return Member{}, httpx.BadRequest("peran_tidak_valid", "Peran hanya boleh admin atau kapster", nil)
		}
	}
	if len(in.OutletIDs) == 0 {
		return Member{}, httpx.BadRequest("outlet_wajib_diisi", "Pilih minimal satu outlet tempat staf bertugas", nil)
	}
	outlets, err := q.ListOutletsByTenant(ctx, tenantID)
	if err != nil {
		return Member{}, httpx.Internal(fmt.Errorf("memeriksa outlet staf: %w", err))
	}
	allowedOutlets := make(map[uuid.UUID]struct{}, len(outlets))
	for _, outlet := range outlets {
		allowedOutlets[outlet.ID] = struct{}{}
	}
	for _, outletID := range in.OutletIDs {
		if _, ok := allowedOutlets[outletID]; !ok {
			return Member{}, httpx.BadRequest("outlet_tidak_valid", "Pilih outlet yang dimiliki bisnis ini", nil)
		}
	}
	if len(in.Password) < 8 {
		return Member{}, httpx.BadRequest("password_terlalu_pendek", "Password minimal 8 karakter", nil)
	}
	username, err := identity.NormalizeUsername(in.Username)
	if err != nil {
		return Member{}, err
	}

	if _, err := q.GetUserByEmail(ctx, in.Email); err == nil {
		return Member{}, httpx.Conflict("email_sudah_terdaftar", "Email ini sudah dipakai akun Trimwait lain", nil)
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return Member{}, httpx.Internal(fmt.Errorf("cek email staf: %w", err))
	}
	if _, err := q.GetUserByUsername(ctx, dbx.Text(username)); err == nil {
		return Member{}, httpx.Conflict("username_sudah_dipakai", "Username ini sudah digunakan. Pilih username lain.", nil)
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return Member{}, httpx.Internal(fmt.Errorf("cek username staf: %w", err))
	}

	hash, err := identity.HashPassword(in.Password)
	if err != nil {
		return Member{}, httpx.Internal(err)
	}
	user, err := q.CreateUser(ctx, db.CreateUserParams{Email: in.Email, PasswordHash: hash, Username: dbx.Text(username)})
	if err != nil {
		if pgerr.IsUniqueViolationOn(err, "users_username_key") {
			return Member{}, httpx.Conflict("username_sudah_dipakai", "Username ini sudah digunakan. Pilih username lain.", nil)
		}
		return Member{}, httpx.Internal(fmt.Errorf("membuat user staf: %w", err))
	}

	membership, err := q.CreateMembership(ctx, db.CreateMembershipParams{TenantID: tenantID, UserID: user.ID, Roles: in.Roles})
	if err != nil {
		return Member{}, httpx.Internal(fmt.Errorf("membuat membership staf: %w", err))
	}

	for _, outletID := range in.OutletIDs {
		if err := q.AddMembershipOutlet(ctx, db.AddMembershipOutletParams{MembershipID: membership.ID, OutletID: outletID}); err != nil {
			return Member{}, httpx.Internal(fmt.Errorf("menautkan outlet staf: %w", err))
		}
	}

	if err := s.identitySvc.SendVerificationEmailUsing(ctx, q, user.ID, user.Email, staffVerificationTTL); err != nil {
		return Member{}, err
	}

	return Member{
		MembershipID:  membership.ID,
		Email:         user.Email,
		Username:      &username,
		Roles:         membership.Roles,
		EmailVerified: false,
		OutletIDs:     in.OutletIDs,
	}, nil
}

type Member struct {
	MembershipID  uuid.UUID   `json:"membership_id"`
	Email         string      `json:"email"`
	Username      *string     `json:"username"`
	Roles         []string    `json:"roles"`
	EmailVerified bool        `json:"email_verified"`
	OutletIDs     []uuid.UUID `json:"outlet_ids"`
}

func textPointer(value pgtype.Text) *string {
	if !value.Valid {
		return nil
	}
	return &value.String
}

func (s *Service) ListStaff(ctx context.Context, tenantID uuid.UUID) ([]Member, error) {
	caller, ok := identity.UserFromContext(ctx)
	if !ok {
		return nil, httpx.Unauthorized("belum_masuk", "Silakan masuk terlebih dahulu", nil)
	}
	q := s.queries(ctx)
	if err := authorization.RequireTenantRole(ctx, q, tenantID, caller.ID, "owner"); err != nil {
		return nil, err
	}
	rows, err := q.ListStaffByTenant(ctx, tenantID)
	if err != nil {
		return nil, httpx.Internal(fmt.Errorf("ambil daftar staf: %w", err))
	}
	result := make([]Member, 0, len(rows))
	for _, row := range rows {
		outletIDs, err := q.ListMembershipOutletIDs(ctx, row.MembershipID)
		if err != nil {
			return nil, httpx.Internal(fmt.Errorf("ambil penugasan outlet staf: %w", err))
		}
		result = append(result, Member{
			MembershipID:  row.MembershipID,
			Email:         row.Email,
			Username:      textPointer(row.Username),
			Roles:         row.Roles,
			EmailVerified: row.EmailVerifiedAt.Valid,
			OutletIDs:     outletIDs,
		})
	}
	return result, nil
}
