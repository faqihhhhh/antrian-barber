package account

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"kapsflow/internal/billing"
	db "kapsflow/internal/db"
	"kapsflow/internal/dbx"
	"kapsflow/internal/httpx"
	"kapsflow/internal/identity"
	"kapsflow/internal/rls"
)

type Service struct {
	fallback   *db.Queries
	billingSvc *billing.Service
}

func NewService(pool *pgxpool.Pool, billingSvc *billing.Service) *Service {
	return &Service{fallback: db.New(pool), billingSvc: billingSvc}
}

func (s *Service) queries(ctx context.Context) *db.Queries {
	if tx, ok := rls.TxFromContext(ctx); ok {
		return db.New(tx)
	}
	return s.fallback
}

type UserInfo struct {
	ID          uuid.UUID `json:"id"`
	Email       string    `json:"email"`
	DisplayName *string   `json:"display_name"`
}

func (s *Service) SetDisplayName(ctx context.Context, userID uuid.UUID, rawDisplayName string) (string, error) {
	displayName, err := identity.NormalizeDisplayName(rawDisplayName)
	if err != nil {
		return "", err
	}
	q := s.queries(ctx)
	if err := q.UpdateUserDisplayName(ctx, db.UpdateUserDisplayNameParams{ID: userID, DisplayName: dbx.Text(displayName)}); err != nil {
		return "", httpx.Internal(fmt.Errorf("menyimpan display_name: %w", err))
	}
	return displayName, nil
}

func (s *Service) ChangePassword(ctx context.Context, userID uuid.UUID, currentPassword, newPassword string) error {
	if len(newPassword) < 8 {
		return httpx.BadRequest("password_terlalu_pendek", "Password baru minimal 8 karakter", nil)
	}
	q := s.queries(ctx)
	user, err := q.GetUserByID(ctx, userID)
	if err != nil {
		return httpx.Internal(fmt.Errorf("ambil akun untuk ganti password: %w", err))
	}
	if err := identity.VerifyPassword(currentPassword, user.PasswordHash); err != nil {
		if errors.Is(err, identity.ErrPasswordMismatch) {
			return httpx.BadRequest("password_saat_ini_salah", "Password saat ini tidak cocok", nil)
		}
		return httpx.Internal(fmt.Errorf("memeriksa password saat ini: %w", err))
	}
	hash, err := identity.HashPassword(newPassword)
	if err != nil {
		return httpx.Internal(fmt.Errorf("membuat hash password baru: %w", err))
	}
	if err := q.UpdateUserPassword(ctx, db.UpdateUserPasswordParams{ID: userID, PasswordHash: hash}); err != nil {
		return httpx.Internal(fmt.Errorf("menyimpan password baru: %w", err))
	}
	return nil
}

type OutletInfo struct {
	ID       uuid.UUID `json:"id"`
	Name     string    `json:"name"`
	Timezone string    `json:"timezone"`
}

type MembershipInfo struct {
	MembershipID       uuid.UUID    `json:"membership_id"`
	TenantID           uuid.UUID    `json:"tenant_id"`
	TenantName         string       `json:"tenant_name"`
	Roles              []string     `json:"roles"`
	Outlets            []OutletInfo `json:"outlets"`
	SubscriptionStatus string       `json:"subscription_status"`
	CurrentPeriodEnd   *time.Time   `json:"current_period_end"`
}

type Context struct {
	User            UserInfo         `json:"user"`
	IsPlatformAdmin bool             `json:"is_platform_admin"`
	Memberships     []MembershipInfo `json:"memberships"`
}

// GetContext menjawab "siapa saya dan apa yang boleh saya lakukan" untuk
// frontend. Owner melihat semua outlet bisnisnya; admin dan kapster hanya
// outlet yang ditugaskan. Tanggal berakhir langganan hanya untuk owner.
func (s *Service) GetContext(ctx context.Context, user db.User) (Context, error) {
	q := s.queries(ctx)

	isAdmin, err := q.IsPlatformAdmin(ctx, user.ID)
	if err != nil {
		return Context{}, httpx.Internal(fmt.Errorf("cek platform admin: %w", err))
	}
	rows, err := q.ListMembershipContextForUser(ctx, user.ID)
	if err != nil {
		return Context{}, httpx.Internal(fmt.Errorf("ambil keanggotaan: %w", err))
	}

	memberships := make([]MembershipInfo, 0, len(rows))
	for _, row := range rows {
		isOwner := slices.Contains(row.Roles, "owner")

		outlets, err := q.ListOutletsForMembership(ctx, db.ListOutletsForMembershipParams{
			TenantID: row.TenantID, AllOutlets: isOwner, MembershipID: row.MembershipID,
		})
		if err != nil {
			return Context{}, httpx.Internal(fmt.Errorf("ambil outlet: %w", err))
		}
		sub, err := s.billingSvc.GetStatus(ctx, row.TenantID)
		if err != nil {
			return Context{}, err
		}

		info := MembershipInfo{
			MembershipID:       row.MembershipID,
			TenantID:           row.TenantID,
			TenantName:         row.TenantName,
			Roles:              row.Roles,
			Outlets:            make([]OutletInfo, 0, len(outlets)),
			SubscriptionStatus: string(sub.Status),
		}
		if isOwner {
			info.CurrentPeriodEnd = sub.CurrentPeriodEnd
		}
		for _, o := range outlets {
			info.Outlets = append(info.Outlets, OutletInfo{ID: o.ID, Name: o.Name, Timezone: o.Timezone})
		}
		memberships = append(memberships, info)
	}

	userInfo := UserInfo{ID: user.ID, Email: user.Email}
	if user.DisplayName.Valid {
		userInfo.DisplayName = &user.DisplayName.String
	}
	return Context{
		User:            userInfo,
		IsPlatformAdmin: isAdmin,
		Memberships:     memberships,
	}, nil
}
