package staff

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
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
	"kapsflow/internal/rls"
)

const staffVerificationTTL = 7 * 24 * time.Hour
const staffInvitationTTL = 7 * 24 * time.Hour

var validRoles = map[string]bool{"admin": true, "kapster": true}

type Service struct {
	fallback    *db.Queries
	identitySvc *identity.Service
}

type InvitationLink struct {
	ID        uuid.UUID  `json:"id"`
	URLToken  string     `json:"url_token,omitempty"`
	ExpiresAt time.Time  `json:"expires_at"`
	RevokedAt *time.Time `json:"revoked_at,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
}

// CreateInvitationLink membuat tautan tujuh hari. Database hanya menerima hash token.
func (s *Service) CreateInvitationLink(ctx context.Context, tenantID uuid.UUID) (InvitationLink, error) {
	caller, ok := identity.UserFromContext(ctx)
	if !ok {
		return InvitationLink{}, httpx.Unauthorized("belum_masuk", "Silakan masuk terlebih dahulu", nil)
	}
	q := s.queries(ctx)
	if err := authorization.RequireTenantRole(ctx, q, tenantID, caller.ID, "owner"); err != nil {
		return InvitationLink{}, err
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return InvitationLink{}, httpx.Internal(err)
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	hash := sha256.Sum256([]byte(token))
	expires := time.Now().Add(staffInvitationTTL)
	row, err := q.CreateStaffInvitationLink(ctx, db.CreateStaffInvitationLinkParams{TenantID: tenantID, TokenHash: hash[:], CreatedBy: caller.ID, ExpiresAt: dbx.TS(expires)})
	if err != nil {
		return InvitationLink{}, httpx.Internal(fmt.Errorf("membuat link undangan staf: %w", err))
	}
	return InvitationLink{ID: row.ID, URLToken: token, ExpiresAt: expires, CreatedAt: row.CreatedAt.Time}, nil
}

type InvitationInfo struct {
	TenantID   uuid.UUID `json:"tenant_id"`
	TenantName string    `json:"tenant_name"`
	ExpiresAt  time.Time `json:"expires_at"`
}

func (s *Service) LookupInvitation(ctx context.Context, token string) (InvitationInfo, error) {
	if len(token) < 32 || len(token) > 128 {
		return InvitationInfo{}, httpx.NotFound("undangan_tidak_valid", "Link undangan tidak valid atau sudah kedaluwarsa", nil)
	}
	hash := sha256.Sum256([]byte(token))
	row, err := s.fallback.LookupStaffInvitation(ctx, hash[:])
	if errors.Is(err, pgx.ErrNoRows) {
		return InvitationInfo{}, httpx.NotFound("undangan_tidak_valid", "Link undangan tidak valid atau sudah kedaluwarsa", nil)
	}
	if err != nil {
		return InvitationInfo{}, httpx.Internal(fmt.Errorf("memeriksa link undangan: %w", err))
	}
	return InvitationInfo{TenantID: row.TenantID, TenantName: row.TenantName, ExpiresAt: row.ExpiresAt.Time}, nil
}

type StaffApplication struct {
	ID         uuid.UUID `json:"id"`
	TenantID   uuid.UUID `json:"tenant_id"`
	TenantName string    `json:"tenant_name"`
	Status     string    `json:"status"`
	CreatedAt  time.Time `json:"created_at"`
}

func (s *Service) ApplyForStaff(ctx context.Context, token string) (StaffApplication, error) {
	caller, ok := identity.UserFromContext(ctx)
	if !ok {
		return StaffApplication{}, httpx.Unauthorized("belum_masuk", "Silakan masuk terlebih dahulu", nil)
	}
	q := s.queries(ctx)
	user, err := q.GetUserByID(ctx, caller.ID)
	if err != nil {
		return StaffApplication{}, httpx.Internal(fmt.Errorf("memeriksa akun pendaftar: %w", err))
	}
	if !user.EmailVerifiedAt.Valid {
		return StaffApplication{}, httpx.Conflict("email_belum_terverifikasi", "Verifikasi email sebelum mengajukan diri sebagai staf", nil)
	}
	if len(token) < 32 || len(token) > 128 {
		return StaffApplication{}, httpx.NotFound("undangan_tidak_valid", "Link undangan tidak valid atau sudah kedaluwarsa", nil)
	}
	hash := sha256.Sum256([]byte(token))
	invitation, err := q.LookupStaffInvitation(ctx, hash[:])
	if errors.Is(err, pgx.ErrNoRows) {
		return StaffApplication{}, httpx.NotFound("undangan_tidak_valid", "Link undangan tidak valid atau sudah kedaluwarsa", nil)
	}
	if err != nil {
		return StaffApplication{}, httpx.Internal(fmt.Errorf("memeriksa link undangan: %w", err))
	}
	created, err := q.CreateStaffApplication(ctx, db.CreateStaffApplicationParams{TokenHash: hash[:], UserID: caller.ID})
	if err != nil {
		return StaffApplication{}, httpx.Internal(fmt.Errorf("membuat pengajuan staf: %w", err))
	}
	if !created {
		return StaffApplication{}, httpx.Conflict("pengajuan_sudah_ada", "Anda sudah pernah mengajukan diri untuk bisnis ini", nil)
	}
	row, err := q.GetStaffApplicationForUser(ctx, db.GetStaffApplicationForUserParams{TenantID: invitation.TenantID, UserID: caller.ID})
	if err != nil {
		return StaffApplication{}, httpx.Internal(fmt.Errorf("mengambil pengajuan staf: %w", err))
	}
	return StaffApplication{ID: row.ID, TenantID: row.TenantID, TenantName: invitation.TenantName, Status: row.Status, CreatedAt: row.CreatedAt.Time}, nil
}

func (s *Service) ListInvitationLinks(ctx context.Context, tenantID uuid.UUID) ([]InvitationLink, error) {
	caller, ok := identity.UserFromContext(ctx)
	if !ok {
		return nil, httpx.Unauthorized("belum_masuk", "Silakan masuk terlebih dahulu", nil)
	}
	q := s.queries(ctx)
	if err := authorization.RequireTenantRole(ctx, q, tenantID, caller.ID, "owner"); err != nil {
		return nil, err
	}
	rows, err := q.ListStaffInvitationLinks(ctx, tenantID)
	if err != nil {
		return nil, httpx.Internal(fmt.Errorf("mengambil link undangan: %w", err))
	}
	out := make([]InvitationLink, 0, len(rows))
	for _, row := range rows {
		item := InvitationLink{ID: row.ID, ExpiresAt: row.ExpiresAt.Time, CreatedAt: row.CreatedAt.Time}
		if row.RevokedAt.Valid {
			t := row.RevokedAt.Time
			item.RevokedAt = &t
		}
		out = append(out, item)
	}
	return out, nil
}

func (s *Service) RevokeInvitationLink(ctx context.Context, tenantID, invitationID uuid.UUID) error {
	caller, ok := identity.UserFromContext(ctx)
	if !ok {
		return httpx.Unauthorized("belum_masuk", "Silakan masuk terlebih dahulu", nil)
	}
	q := s.queries(ctx)
	if err := authorization.RequireTenantRole(ctx, q, tenantID, caller.ID, "owner"); err != nil {
		return err
	}
	n, err := q.RevokeStaffInvitationLink(ctx, db.RevokeStaffInvitationLinkParams{ID: invitationID, TenantID: tenantID})
	if err != nil {
		return httpx.Internal(fmt.Errorf("mencabut link undangan: %w", err))
	}
	if n == 0 {
		return httpx.NotFound("undangan_tidak_ditemukan", "Link undangan tidak ditemukan atau sudah dicabut", nil)
	}
	return nil
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
	Email       string
	Password    string
	DisplayName string
	Roles       []string
	OutletIDs   []uuid.UUID
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
	displayName, err := identity.NormalizeDisplayName(in.DisplayName)
	if err != nil {
		return Member{}, err
	}

	if _, err := q.GetUserByEmail(ctx, in.Email); err == nil {
		return Member{}, httpx.Conflict("email_sudah_terdaftar", "Email ini sudah dipakai akun Trimwait lain", nil)
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return Member{}, httpx.Internal(fmt.Errorf("cek email staf: %w", err))
	}
	hash, err := identity.HashPassword(in.Password)
	if err != nil {
		return Member{}, httpx.Internal(err)
	}
	user, err := q.CreateUser(ctx, db.CreateUserParams{Email: in.Email, PasswordHash: hash, DisplayName: dbx.Text(displayName)})
	if err != nil {
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
		DisplayName:   &displayName,
		Roles:         membership.Roles,
		EmailVerified: false,
		OutletIDs:     in.OutletIDs,
	}, nil
}

type Member struct {
	MembershipID  uuid.UUID   `json:"membership_id"`
	Email         string      `json:"email"`
	DisplayName   *string     `json:"display_name"`
	Roles         []string    `json:"roles"`
	EmailVerified bool        `json:"email_verified"`
	OutletIDs     []uuid.UUID `json:"outlet_ids"`
}

type Applicant struct {
	ApplicationID uuid.UUID `json:"application_id"`
	Email         string    `json:"email"`
	DisplayName   *string   `json:"display_name"`
	CreatedAt     time.Time `json:"created_at"`
}

func (s *Service) ListPendingApplications(ctx context.Context, tenantID uuid.UUID) ([]Applicant, error) {
	caller, ok := identity.UserFromContext(ctx)
	if !ok {
		return nil, httpx.Unauthorized("belum_masuk", "Silakan masuk terlebih dahulu", nil)
	}
	q := s.queries(ctx)
	if err := authorization.RequireTenantRole(ctx, q, tenantID, caller.ID, "owner"); err != nil {
		return nil, err
	}
	rows, err := q.ListPendingStaffApplications(ctx, tenantID)
	if err != nil {
		return nil, httpx.Internal(fmt.Errorf("mengambil pengajuan staf: %w", err))
	}
	result := make([]Applicant, 0, len(rows))
	for _, row := range rows {
		result = append(result, Applicant{ApplicationID: row.ID, Email: row.Email, DisplayName: textPointer(row.DisplayName), CreatedAt: row.CreatedAt.Time})
	}
	return result, nil
}

func (s *Service) ReviewApplication(ctx context.Context, tenantID, applicationID uuid.UUID, approve bool, roles []string, outletIDs []uuid.UUID) error {
	caller, ok := identity.UserFromContext(ctx)
	if !ok {
		return httpx.Unauthorized("belum_masuk", "Silakan masuk terlebih dahulu", nil)
	}
	q := s.queries(ctx)
	if err := authorization.RequireTenantRole(ctx, q, tenantID, caller.ID, "owner"); err != nil {
		return err
	}
	status := "rejected"
	if approve {
		status = "approved"
		if len(roles) == 0 {
			return httpx.BadRequest("peran_wajib_diisi", "Pilih minimal satu peran: admin dan/atau kapster", nil)
		}
		roleSet := make(map[string]struct{}, len(roles))
		for _, role := range roles {
			if !validRoles[role] {
				return httpx.BadRequest("peran_tidak_valid", "Peran hanya boleh admin atau kapster", nil)
			}
			roleSet[role] = struct{}{}
		}
		roles = make([]string, 0, len(roleSet))
		for role := range roleSet {
			roles = append(roles, role)
		}
		if len(outletIDs) == 0 {
			return httpx.BadRequest("outlet_wajib_diisi", "Pilih minimal satu outlet tempat staf bertugas", nil)
		}
		outlets, err := q.ListOutletsByTenant(ctx, tenantID)
		if err != nil {
			return httpx.Internal(fmt.Errorf("memeriksa outlet staf: %w", err))
		}
		allowed := make(map[uuid.UUID]struct{}, len(outlets))
		for _, outlet := range outlets {
			allowed[outlet.ID] = struct{}{}
		}
		seen := make(map[uuid.UUID]struct{}, len(outletIDs))
		for _, outletID := range outletIDs {
			if _, ok := allowed[outletID]; !ok {
				return httpx.BadRequest("outlet_tidak_valid", "Pilih outlet yang dimiliki bisnis ini", nil)
			}
			if _, duplicate := seen[outletID]; duplicate {
				return httpx.BadRequest("outlet_ganda", "Outlet yang sama tidak boleh dipilih dua kali", nil)
			}
			seen[outletID] = struct{}{}
		}
	}
	application, err := q.ReviewStaffApplication(ctx, db.ReviewStaffApplicationParams{ID: applicationID, TenantID: tenantID, Status: status, ReviewedBy: dbx.UUID(caller.ID)})
	if errors.Is(err, pgx.ErrNoRows) {
		return httpx.Conflict("pengajuan_sudah_ditinjau", "Pengajuan tidak ditemukan atau sudah ditinjau", nil)
	}
	if err != nil {
		return httpx.Internal(fmt.Errorf("meninjau pengajuan staf: %w", err))
	}
	if !approve {
		return nil
	}
	if _, err := q.GetMembershipForUserAndTenant(ctx, db.GetMembershipForUserAndTenantParams{TenantID: tenantID, UserID: application.UserID}); err == nil {
		return httpx.Conflict("sudah_menjadi_anggota", "Pengguna ini sudah menjadi anggota bisnis", nil)
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return httpx.Internal(fmt.Errorf("memeriksa keanggotaan pendaftar: %w", err))
	}
	membership, err := q.CreateMembership(ctx, db.CreateMembershipParams{TenantID: tenantID, UserID: application.UserID, Roles: roles})
	if err != nil {
		return httpx.Internal(fmt.Errorf("membuat membership staf: %w", err))
	}
	for _, outletID := range outletIDs {
		if err := q.AddMembershipOutlet(ctx, db.AddMembershipOutletParams{MembershipID: membership.ID, OutletID: outletID}); err != nil {
			return httpx.Internal(fmt.Errorf("menautkan outlet staf: %w", err))
		}
	}
	return nil
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
			DisplayName:   textPointer(row.DisplayName),
			Roles:         row.Roles,
			EmailVerified: row.EmailVerifiedAt.Valid,
			OutletIDs:     outletIDs,
		})
	}
	return result, nil
}
