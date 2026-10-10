-- name: StatsDailyByOutlet :many
SELECT
    qs.session_date,
    qs.outlet_id,
    o.name AS outlet_name,
    COUNT(t.id) FILTER (WHERE t.status NOT IN ('pending_payment', 'canceled'))::bigint AS tickets_total,
    COUNT(t.id) FILTER (WHERE t.status NOT IN ('pending_payment', 'canceled') AND t.channel = 'online')::bigint AS tickets_online,
    COUNT(t.id) FILTER (WHERE t.status NOT IN ('pending_payment', 'canceled') AND t.channel = 'offline')::bigint AS tickets_offline,
    COUNT(t.id) FILTER (WHERE t.status = 'completed')::bigint AS tickets_completed,
    COUNT(t.id) FILTER (WHERE t.status = 'canceled')::bigint AS tickets_canceled,
    COUNT(t.id) FILTER (WHERE t.final_payment_confirmed_at IS NOT NULL)::bigint AS tickets_settled,
    COALESCE(SUM(t.final_amount_rupiah) FILTER (WHERE t.final_payment_confirmed_at IS NOT NULL), 0)::bigint AS revenue_rupiah,
    COALESCE(SUM(p.amount_rupiah) FILTER (WHERE p.status = 'paid' AND t.final_payment_confirmed_at IS NULL), 0)::bigint AS dp_unsettled_rupiah
FROM queue_sessions qs
JOIN outlets o ON o.id = qs.outlet_id
LEFT JOIN tickets t ON t.queue_session_id = qs.id
LEFT JOIN ticket_payments p ON p.ticket_id = t.id
WHERE qs.tenant_id = sqlc.arg(tenant_id)::uuid
  AND qs.session_date BETWEEN sqlc.arg(from_date)::date AND sqlc.arg(to_date)::date
GROUP BY qs.session_date, qs.outlet_id, o.name
ORDER BY qs.session_date, o.name;

-- name: StatsTimingByOutlet :many
WITH per_ticket AS (
    SELECT
        qs.outlet_id,
        t.created_at,
        MIN(te.occurred_at) FILTER (WHERE te.event_type = 'called') AS first_called_at,
        MAX(te.occurred_at) FILTER (WHERE te.event_type = 'started') AS started_at,
        MAX(te.occurred_at) FILTER (WHERE te.event_type = 'completed') AS completed_at
    FROM tickets t
    JOIN queue_sessions qs ON qs.id = t.queue_session_id
    JOIN ticket_events te ON te.ticket_id = t.id
    WHERE qs.tenant_id = sqlc.arg(tenant_id)::uuid
      AND qs.session_date BETWEEN sqlc.arg(from_date)::date AND sqlc.arg(to_date)::date
      AND t.status = 'completed'
    GROUP BY t.id, qs.outlet_id, t.created_at
)
SELECT
    outlet_id,
    COALESCE(AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) / 60), 0)::float8 AS avg_service_minutes,
    COALESCE(AVG(EXTRACT(EPOCH FROM (first_called_at - created_at)) / 60), 0)::float8 AS avg_wait_minutes,
    COUNT(*)::bigint AS tickets_measured
FROM per_ticket
GROUP BY outlet_id;

-- name: StatsPeakHours :many
SELECT
    qs.outlet_id,
    EXTRACT(HOUR FROM (te.occurred_at AT TIME ZONE o.timezone))::int AS hour_of_day,
    COUNT(*)::bigint AS tickets_started
FROM ticket_events te
JOIN tickets t ON t.id = te.ticket_id
JOIN queue_sessions qs ON qs.id = t.queue_session_id
JOIN outlets o ON o.id = qs.outlet_id
WHERE qs.tenant_id = sqlc.arg(tenant_id)::uuid
  AND qs.session_date BETWEEN sqlc.arg(from_date)::date AND sqlc.arg(to_date)::date
  AND te.event_type = 'started'
GROUP BY 1, 2
ORDER BY 1, 2;

-- name: StatsKapsterPerformance :many
WITH completed AS (
    SELECT t.assigned_membership_id AS membership_id,
           COUNT(*)::bigint AS tickets_completed,
           COALESCE(SUM(t.final_amount_rupiah) FILTER (WHERE t.final_payment_confirmed_at IS NOT NULL), 0)::bigint AS revenue_rupiah
    FROM tickets t
    JOIN queue_sessions qs ON qs.id = t.queue_session_id
    WHERE qs.tenant_id = sqlc.arg(tenant_id)::uuid
      AND qs.session_date BETWEEN sqlc.arg(from_date)::date AND sqlc.arg(to_date)::date
      AND t.status = 'completed'
      AND t.assigned_membership_id IS NOT NULL
    GROUP BY t.assigned_membership_id
),
durations AS (
    SELECT x.membership_id, AVG(x.minutes)::float8 AS avg_minutes
    FROM (
        SELECT t.assigned_membership_id AS membership_id,
               EXTRACT(EPOCH FROM (
                   MAX(te.occurred_at) FILTER (WHERE te.event_type = 'completed')
                   - MAX(te.occurred_at) FILTER (WHERE te.event_type = 'started')
               )) / 60 AS minutes
        FROM tickets t
        JOIN queue_sessions qs ON qs.id = t.queue_session_id
        JOIN ticket_events te ON te.ticket_id = t.id
        WHERE qs.tenant_id = sqlc.arg(tenant_id)::uuid
          AND qs.session_date BETWEEN sqlc.arg(from_date)::date AND sqlc.arg(to_date)::date
          AND t.status = 'completed'
          AND t.assigned_membership_id IS NOT NULL
        GROUP BY t.id, t.assigned_membership_id
    ) x
    GROUP BY x.membership_id
),
skips AS (
    SELECT te.actor_membership_id AS membership_id, COUNT(*)::bigint AS skip_count
    FROM ticket_events te
    JOIN tickets t ON t.id = te.ticket_id
    JOIN queue_sessions qs ON qs.id = t.queue_session_id
    WHERE qs.tenant_id = sqlc.arg(tenant_id)::uuid
      AND qs.session_date BETWEEN sqlc.arg(from_date)::date AND sqlc.arg(to_date)::date
      AND te.event_type = 'skipped'
      AND te.actor_membership_id IS NOT NULL
    GROUP BY te.actor_membership_id
),
ratings AS (
    SELECT r.kapster_membership_id AS membership_id,
           COUNT(*)::bigint AS review_count,
           AVG(r.rating)::float8 AS avg_rating
    FROM reviews r
    JOIN tickets t ON t.id = r.ticket_id
    JOIN queue_sessions qs ON qs.id = t.queue_session_id
    WHERE r.tenant_id = sqlc.arg(tenant_id)::uuid
      AND qs.session_date BETWEEN sqlc.arg(from_date)::date AND sqlc.arg(to_date)::date
    GROUP BY r.kapster_membership_id
)
SELECT
    m.id AS membership_id,
    u.email AS kapster_email,
    COALESCE(c.tickets_completed, 0)::bigint AS tickets_completed,
    COALESCE(c.revenue_rupiah, 0)::bigint AS revenue_rupiah,
    COALESCE(d.avg_minutes, 0)::float8 AS avg_service_minutes,
    COALESCE(s.skip_count, 0)::bigint AS skip_count,
    COALESCE(rt.review_count, 0)::bigint AS review_count,
    COALESCE(rt.avg_rating, 0)::float8 AS avg_rating
FROM memberships m
JOIN users u ON u.id = m.user_id
LEFT JOIN completed c ON c.membership_id = m.id
LEFT JOIN durations d ON d.membership_id = m.id
LEFT JOIN skips s ON s.membership_id = m.id
LEFT JOIN ratings rt ON rt.membership_id = m.id
WHERE m.tenant_id = sqlc.arg(tenant_id)::uuid AND 'kapster' = ANY(m.roles)
ORDER BY 3 DESC, 2;

-- name: PlatformTenantStatusCounts :one
SELECT
    COUNT(*)::bigint AS total_tenants,
    COUNT(*) FILTER (WHERE s.current_period_end IS NULL)::bigint AS never_subscribed,
    COUNT(*) FILTER (WHERE s.current_period_end >= now())::bigint AS active,
    COUNT(*) FILTER (WHERE s.current_period_end < now() AND s.current_period_end + interval '3 days' >= now())::bigint AS grace,
    COUNT(*) FILTER (WHERE s.current_period_end + interval '3 days' < now())::bigint AS read_only,
    COUNT(*) FILTER (WHERE s.current_period_end + interval '3 days' < now()
                       AND s.current_period_end + interval '3 days' >= now() - interval '30 days')::bigint AS churned_30d
FROM tenants t
LEFT JOIN subscriptions s ON s.tenant_id = t.id;

-- name: PlatformTotals :one
SELECT
    (SELECT COUNT(*) FROM outlets)::bigint AS outlets_total,
    (SELECT COUNT(*) FROM memberships WHERE roles && ARRAY['admin','kapster']::text[])::bigint AS staff_total,
    (SELECT COUNT(*) FROM users WHERE id <> '00000000-0000-0000-0000-000000000001'::uuid)::bigint AS users_total,
    (SELECT COUNT(DISTINCT tenant_id) FROM invoices WHERE status = 'paid')::bigint AS ever_paid,
    (SELECT COUNT(*) FROM tenant_profiles WHERE midtrans_configured_at IS NOT NULL)::bigint AS midtrans_configured,
    (SELECT COUNT(*) FROM tenant_profiles WHERE onboarding_completed_at IS NOT NULL)::bigint AS onboarding_completed;

-- name: PlatformMRR :one
SELECT COALESCE(SUM(
    CASE WHEN p.billing_interval = 'yearly' THEN p.price_rupiah / 12.0 ELSE p.price_rupiah::numeric END
), 0)::float8 AS mrr_rupiah
FROM subscriptions s
JOIN plans p ON p.id = s.plan_id
WHERE s.current_period_end >= now();

-- name: PlatformBillingQueue :one
SELECT
    (SELECT COUNT(*) FROM invoices WHERE status = 'pending')::bigint AS pending_invoices,
    (SELECT COALESCE(SUM(amount_rupiah), 0) FROM invoices WHERE status = 'pending')::bigint AS pending_amount_rupiah,
    (SELECT COUNT(*) FROM subscriptions WHERE current_period_end BETWEEN now() AND now() + interval '7 days')::bigint AS expiring_7d,
    (SELECT COALESCE(SUM(p.price_rupiah), 0)
       FROM subscriptions s JOIN plans p ON p.id = s.plan_id
      WHERE s.current_period_end BETWEEN now() AND now() + interval '7 days')::bigint AS expiring_7d_rupiah;

-- name: PlatformRevenueByMonth :many
SELECT
    to_char(date_trunc('month', paid_at AT TIME ZONE 'Asia/Jakarta'), 'YYYY-MM')::text AS month,
    COUNT(*)::bigint AS invoices_paid,
    COALESCE(SUM(amount_rupiah), 0)::bigint AS revenue_rupiah
FROM invoices
WHERE status = 'paid' AND paid_at >= sqlc.arg(since)::timestamptz
GROUP BY 1
ORDER BY 1;

-- name: PlatformSignupsByMonth :many
SELECT
    to_char(date_trunc('month', created_at AT TIME ZONE 'Asia/Jakarta'), 'YYYY-MM')::text AS month,
    COUNT(*)::bigint AS tenants_created
FROM tenants
WHERE created_at >= sqlc.arg(since)::timestamptz
GROUP BY 1
ORDER BY 1;

-- name: PlatformActivity :one
SELECT
    COUNT(DISTINCT qs.outlet_id)::bigint AS active_outlets,
    COUNT(t.id) FILTER (WHERE t.status = 'completed')::bigint AS tickets_completed,
    COALESCE(SUM(t.final_amount_rupiah) FILTER (WHERE t.final_payment_confirmed_at IS NOT NULL), 0)::bigint AS gmv_rupiah
FROM queue_sessions qs
LEFT JOIN tickets t ON t.queue_session_id = qs.id
WHERE qs.session_date BETWEEN sqlc.arg(from_date)::date AND sqlc.arg(to_date)::date;