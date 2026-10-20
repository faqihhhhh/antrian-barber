-- name: CreateOutlet :one
INSERT INTO outlets (tenant_id, name, timezone, address, slug)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetOutletBySlug :one
SELECT * FROM outlets WHERE slug = $1;

-- name: SlugExists :one
SELECT EXISTS(SELECT 1 FROM outlets WHERE slug = $1);

-- name: ListOutletsByTenant :many
SELECT * FROM outlets WHERE tenant_id = $1 ORDER BY created_at;

-- name: UpdateOutletSettings :one
UPDATE outlets SET dp_price_rupiah = $3, default_duration_minutes = $4, updated_at = now()
WHERE id = $1 AND tenant_id = $2 RETURNING *;

-- name: GetOutletByID :one
SELECT * FROM outlets WHERE id = $1;

-- name: ListPublicOutletDirectory :many
SELECT t.name AS business_name, o.name AS outlet_name, o.slug
FROM outlets o
JOIN tenants t ON t.id = o.tenant_id
ORDER BY t.name, o.name;
