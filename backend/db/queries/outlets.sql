-- name: CreateOutlet :one
INSERT INTO outlets (tenant_id, name, timezone, address)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: ListOutletsByTenant :many
SELECT * FROM outlets WHERE tenant_id = $1 ORDER BY created_at;