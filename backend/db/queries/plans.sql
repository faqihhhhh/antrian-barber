-- name: ListActivePlans :many
SELECT * FROM plans WHERE is_active = true ORDER BY price_rupiah;

-- name: GetPlanByCode :one
SELECT * FROM plans WHERE code = $1;

-- name: GetPlanByID :one
SELECT * FROM plans WHERE id = $1;