-- name: CreateMembership :one
INSERT INTO memberships (tenant_id, user_id, roles)
VALUES ($1, $2, $3)
RETURNING *;

-- name: ListMembershipsForUser :many
SELECT * FROM memberships WHERE user_id = $1;

-- name: AddMembershipOutlet :exec
INSERT INTO membership_outlets (membership_id, outlet_id) VALUES ($1, $2);

-- name: ListStaffByTenant :many
SELECT
    m.id AS membership_id,
    m.roles,
    m.created_at,
    u.id AS user_id,
    u.email,
    u.display_name,
    u.email_verified_at
FROM memberships m
JOIN users u ON u.id = m.user_id
WHERE m.tenant_id = $1
  AND m.roles && ARRAY['admin','kapster']::text[]
  AND NOT ('owner' = ANY(m.roles))
ORDER BY m.created_at;

-- name: GetMembershipForUserAndTenant :one
SELECT * FROM memberships WHERE tenant_id = $1 AND user_id = $2;

-- name: ListMembershipOutletIDs :many
SELECT outlet_id FROM membership_outlets WHERE membership_id = $1;

