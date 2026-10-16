package authorization

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	db "kapsflow/internal/db"
	"kapsflow/internal/httpx"
)

// RequireTenantRole checks the caller's explicit business role. RLS only
// proves tenant membership and must not be used as a role check.
func RequireTenantRole(ctx context.Context, q *db.Queries, tenantID, userID uuid.UUID, role string) error {
	membership, err := q.GetMembershipForUserAndTenant(ctx, db.GetMembershipForUserAndTenantParams{
		TenantID: tenantID,
		UserID:   userID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return httpx.Forbidden("bukan_owner", "Hanya pemilik bisnis yang boleh melakukan tindakan ini", nil)
	}
	if err != nil {
		return httpx.Internal(err)
	}
	if HasRole(membership.Roles, role) {
		return nil
	}
	return httpx.Forbidden("bukan_owner", "Hanya pemilik bisnis yang boleh melakukan tindakan ini", nil)
}

func HasRole(roles []string, required string) bool {
	for _, role := range roles {
		if role == required {
			return true
		}
	}
	return false
}
