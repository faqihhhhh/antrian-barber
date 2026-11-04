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
WHERE NOT o.is_additional OR o.additional_period_end > now()
ORDER BY t.name, o.name;

-- name: CreatePaidAdditionalOutlet :one
INSERT INTO outlets (tenant_id, name, timezone, address, slug, is_additional, additional_period_end, additional_billing_interval)
VALUES ($1, $2, $3, $4, $5, true,
        sqlc.arg(paid_at)::timestamptz + CASE WHEN sqlc.arg(billing_interval)::text = 'yearly' THEN interval '1 year' ELSE interval '1 month' END,
        sqlc.arg(billing_interval)::text)
RETURNING *;

-- name: RenewAdditionalOutlet :one
WITH basis AS (
    SELECT id, GREATEST(COALESCE(additional_period_end, sqlc.arg(paid_at)::timestamptz), sqlc.arg(paid_at)::timestamptz) AS period_start
    FROM outlets WHERE id = sqlc.arg(id)::uuid AND tenant_id = sqlc.arg(tenant_id)::uuid AND is_additional
    FOR UPDATE
)
UPDATE outlets o
SET additional_period_end = basis.period_start + CASE WHEN sqlc.arg(billing_interval)::text = 'yearly' THEN interval '1 year' ELSE interval '1 month' END,
    additional_billing_interval = sqlc.arg(billing_interval)::text,
    updated_at = now()
FROM basis WHERE o.id = basis.id
RETURNING basis.period_start::timestamptz AS period_start, o.additional_period_end;

-- name: CountOutletsByTenant :one
SELECT count(*)::bigint FROM outlets WHERE tenant_id = $1;
