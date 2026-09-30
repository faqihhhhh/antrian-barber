-- name: UpsertSubscription :one
INSERT INTO subscriptions (tenant_id, plan_id)
VALUES ($1, $2)
ON CONFLICT (tenant_id) DO UPDATE SET plan_id = EXCLUDED.plan_id, updated_at = now()
RETURNING *;

-- name: GetSubscriptionByTenant :one
SELECT * FROM subscriptions WHERE tenant_id = $1;

-- name: ActivateSubscriptionPeriod :exec
UPDATE subscriptions SET current_period_end = $2, updated_at = now() WHERE tenant_id = $1;