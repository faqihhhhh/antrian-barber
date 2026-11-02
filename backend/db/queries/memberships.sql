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


-- name: CreateStaffInvitationLink :one
INSERT INTO staff_invitation_links (tenant_id, token_hash, created_by, expires_at)
VALUES ($1, $2, $3, $4)
RETURNING id, tenant_id, expires_at, created_at;

-- name: ListStaffInvitationLinks :many
SELECT id, tenant_id, expires_at, revoked_at, created_at
FROM staff_invitation_links
WHERE tenant_id = $1
ORDER BY created_at DESC;

-- name: RevokeStaffInvitationLink :execrows
UPDATE staff_invitation_links
SET revoked_at = now()
WHERE id = $1 AND tenant_id = $2 AND revoked_at IS NULL;

-- name: LookupStaffInvitation :one
SELECT x.tenant_id::uuid AS tenant_id, x.tenant_name::text AS tenant_name,
       x.expires_at::timestamptz AS expires_at
FROM lookup_staff_invitation($1::bytea) AS x(tenant_id, tenant_name, expires_at);

-- name: CreateStaffApplication :one
SELECT submit_staff_application(sqlc.arg(token_hash)::bytea, sqlc.arg(user_id)::uuid) AS created;

-- name: GetStaffApplicationForUser :one
SELECT id, tenant_id, user_id, status, created_at
FROM staff_applications
WHERE tenant_id = $1 AND user_id = $2;

-- name: ListPendingStaffApplications :many
SELECT a.id, a.user_id, a.status, a.created_at, u.email, u.display_name
FROM staff_applications a
JOIN users u ON u.id = a.user_id
WHERE a.tenant_id = $1 AND a.status = 'pending'
ORDER BY a.created_at;

-- name: ReviewStaffApplication :one
UPDATE staff_applications
SET status = $3, reviewed_by = $4, reviewed_at = now()
WHERE id = $1 AND tenant_id = $2 AND status = 'pending'
RETURNING id, tenant_id, user_id, status, created_at;
