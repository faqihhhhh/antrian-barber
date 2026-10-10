-- name: ListSubscriptionsEndingSoon :many
SELECT
    s.tenant_id,
    s.current_period_end,
    t.name AS tenant_name,
    p.name AS plan_name,
    p.price_rupiah,
    EXISTS (SELECT 1 FROM subscription_reminders r
            WHERE r.tenant_id = s.tenant_id AND r.period_end = s.current_period_end AND r.kind = 'h7') AS h7_sent,
    EXISTS (SELECT 1 FROM subscription_reminders r
            WHERE r.tenant_id = s.tenant_id AND r.period_end = s.current_period_end AND r.kind = 'h3') AS h3_sent
FROM subscriptions s
JOIN tenants t ON t.id = s.tenant_id
JOIN plans p ON p.id = s.plan_id
WHERE s.current_period_end IS NOT NULL
  AND s.current_period_end > now()
  AND s.current_period_end <= now() + interval '7 days';

-- name: RecordSubscriptionReminder :exec
INSERT INTO subscription_reminders (tenant_id, period_end, kind)
VALUES ($1, $2, $3)
ON CONFLICT DO NOTHING;

-- name: ListOwnerEmailsByTenant :many
SELECT u.email FROM memberships m
JOIN users u ON u.id = m.user_id
WHERE m.tenant_id = $1 AND 'owner' = ANY(m.roles);