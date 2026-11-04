-- name: ListActivePlans :many
SELECT * FROM plans WHERE is_active = true ORDER BY price_rupiah;

-- name: GetPlanByCode :one
SELECT * FROM plans WHERE code = $1;

-- name: GetActivePlanByInterval :one
SELECT * FROM plans WHERE billing_interval = $1 AND is_active = true ORDER BY price_rupiah LIMIT 1;

-- name: GetPlanByID :one
SELECT * FROM plans WHERE id = $1;

-- name: UpdatePlanPrice :one
UPDATE plans SET price_rupiah = $2, updated_at = now()
WHERE code = $1 AND is_active = true
RETURNING *;
