-- name: CreateTicketReport :one
INSERT INTO ticket_reports (tenant_id, ticket_id, customer_user_id, comment)
VALUES ($1, $2, $3, $4)
RETURNING id, tenant_id, ticket_id, comment, refund_sent_at, created_at;

-- name: IsTicketEligibleForReport :one
SELECT EXISTS (
  SELECT 1
  FROM tickets t
  JOIN queue_sessions qs ON qs.id = t.queue_session_id
  JOIN outlets o ON o.id = qs.outlet_id
  JOIN ticket_payments p ON p.ticket_id = t.id
  WHERE t.id = $1 AND t.customer_user_id = $2
    AND t.channel = 'online'
    AND t.status IN ('waiting', 'called')
    AND p.status = 'paid'
    AND qs.session_date < (now() AT TIME ZONE o.timezone)::date
);

-- name: ListTicketReportsByTenant :many
SELECT r.id, r.ticket_id, t.ticket_number, t.queue_position, t.customer_name, u.display_name AS customer_display_name,
       u.email AS customer_email, o.name AS outlet_name, o.address AS outlet_address, qs.session_date,
       t.status AS ticket_status, t.created_at AS ticket_created_at, e.call_count, e.first_called_at, e.last_called_at,
       p.method AS payment_method, p.amount_rupiah, p.paid_at,
       r.comment, r.created_at AS report_created_at, r.refund_sent_at
FROM ticket_reports r
JOIN tickets t ON t.id = r.ticket_id
JOIN users u ON u.id = r.customer_user_id
JOIN queue_sessions qs ON qs.id = t.queue_session_id
JOIN outlets o ON o.id = qs.outlet_id
JOIN ticket_payments p ON p.ticket_id = t.id
LEFT JOIN LATERAL (
  SELECT count(*) FILTER (WHERE event_type = 'called')::int AS call_count,
         (min(occurred_at) FILTER (WHERE event_type = 'called'))::timestamptz AS first_called_at,
         (max(occurred_at) FILTER (WHERE event_type = 'called'))::timestamptz AS last_called_at
  FROM ticket_events WHERE ticket_id = t.id
) e ON true
WHERE r.tenant_id = $1
ORDER BY r.refund_sent_at NULLS FIRST, r.created_at DESC;

-- name: MarkTicketReportRefundSent :one
UPDATE ticket_reports
SET refund_sent_at = COALESCE(refund_sent_at, now()), refund_confirmed_by = COALESCE(refund_confirmed_by, $2), updated_at = now()
WHERE id = $1
RETURNING id, tenant_id, ticket_id, refund_sent_at;
