-- name: CreateOutlet :one
INSERT INTO outlets (tenant_id, name, timezone, address)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: ListOutletsByTenant :many
SELECT * FROM outlets WHERE tenant_id = $1 ORDER BY created_at;

-- name: UpdateOutletSettings :one
UPDATE outlets SET dp_price_rupiah = $2, default_duration_minutes = $3, updated_at = now() WHERE id = $1 RETURNING *;