-- name: CreateMembership :one
INSERT INTO memberships (tenant_id, user_id, roles)
VALUES ($1, $2, $3)
RETURNING *;

-- name: ListMembershipsForUser :many
SELECT * FROM memberships WHERE user_id = $1;