-- name: UpsertSubscription :one
INSERT INTO subscriptions (tenant_id, plan_id)
VALUES ($1, $2)
ON CONFLICT (tenant_id) DO UPDATE SET
    plan_id = CASE WHEN subscriptions.current_period_end IS NULL THEN EXCLUDED.plan_id ELSE subscriptions.plan_id END,
    updated_at = now()
RETURNING *;

-- name: SetSubscriptionPlan :execrows
UPDATE subscriptions SET plan_id = $2, updated_at = now() WHERE tenant_id = $1;

-- name: GetSubscriptionByTenant :one
SELECT * FROM subscriptions WHERE tenant_id = $1;

-- name: CanCreateRenewalInvoice :one
SELECT current_period_end IS NULL OR current_period_end <= now() + interval '7 days' AS eligible
FROM subscriptions WHERE tenant_id = $1;

-- name: ActivateSubscriptionPeriodFromPayment :one
WITH period AS (
    SELECT s.tenant_id,
           GREATEST(COALESCE(s.current_period_end, sqlc.arg(paid_at)::timestamptz), sqlc.arg(paid_at)::timestamptz)::timestamptz AS period_start,
           CASE WHEN sqlc.arg(billing_interval)::text = 'yearly' THEN interval '1 year' ELSE interval '1 month' END AS duration
    FROM subscriptions AS s
    WHERE s.tenant_id = sqlc.arg(tenant_id)
    FOR UPDATE
), updated AS (
    UPDATE subscriptions AS s
    SET current_period_end = period.period_start + period.duration,
        updated_at = now()
    FROM period
    WHERE s.tenant_id = period.tenant_id
    RETURNING period.period_start, s.current_period_end AS period_end
)
SELECT period_start, period_end FROM updated;
