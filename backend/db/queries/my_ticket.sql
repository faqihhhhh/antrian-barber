-- name: ListMyTickets :many
SELECT
    t.id AS ticket_id,
    t.tenant_id,
    t.status,
    t.ticket_number,
    t.queue_position,
    t.match_code,
    t.customer_name,
    qs.id AS session_id,
    qs.session_date,
    qs.outlet_id,
    o.name AS outlet_name,
    o.slug AS outlet_slug,
    o.timezone AS outlet_timezone,
    p.method AS payment_method,
    p.status AS payment_status,
    p.amount_rupiah,
    p.expires_at AS payment_expires_at,
    p.qr_code_url,
    (r.id IS NOT NULL)::boolean AS reviewed
FROM tickets t
JOIN queue_sessions qs ON qs.id = t.queue_session_id
JOIN outlets o ON o.id = qs.outlet_id
LEFT JOIN ticket_payments p ON p.ticket_id = t.id
LEFT JOIN reviews r ON r.ticket_id = t.id
WHERE t.customer_user_id = sqlc.arg(user_id)::uuid
  AND (
    t.status IN ('pending_payment', 'waiting', 'called', 'in_progress')
    OR (t.status = 'completed' AND t.updated_at > now() - interval '7 days')
  )
ORDER BY qs.session_date DESC, t.ticket_number DESC
LIMIT 50;