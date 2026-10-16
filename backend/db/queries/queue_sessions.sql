-- name: CreateQueueSession :one
INSERT INTO queue_sessions (tenant_id, outlet_id, session_date, max_quota, created_by)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: ListQueueSessionsByOutlet :many
SELECT * FROM queue_sessions WHERE outlet_id = $1 ORDER BY session_date DESC;

-- name: IncreaseQueueQuota :one
UPDATE queue_sessions SET max_quota = max_quota + $2, updated_at = now()
WHERE id = $1 AND status = 'open'
RETURNING *;

-- name: ClaimNextTicketNumber :one
UPDATE queue_sessions
SET next_ticket_number = next_ticket_number + 1, used_quota = used_quota + 1, updated_at = now()
WHERE id = $1 AND used_quota < max_quota
  AND status = 'open'
RETURNING (next_ticket_number - 1)::int AS ticket_number;

-- name: GetQueueSessionByOutletAndDate :one
SELECT * FROM queue_sessions WHERE outlet_id = $1 AND session_date = $2;

-- name: GetQueueSessionByID :one
SELECT * FROM queue_sessions WHERE id = $1;

-- name: GetQueueSessionForUpdate :one
SELECT * FROM queue_sessions WHERE id = $1 FOR UPDATE;

-- name: CountActiveTicketsInQueueSession :one
SELECT count(*) FROM tickets
WHERE queue_session_id = $1
  AND status IN ('pending_payment', 'waiting', 'called', 'in_progress');

-- name: CloseQueueSession :one
UPDATE queue_sessions SET status = 'closed', updated_at = now()
WHERE id = $1 AND status = 'open'
RETURNING *;

-- name: ClosePastQueueSessions :many
UPDATE queue_sessions AS qs
SET status = 'closed', updated_at = now()
FROM outlets AS o
WHERE qs.outlet_id = o.id
  AND qs.status = 'open'
  AND qs.session_date < (now() AT TIME ZONE o.timezone)::date
RETURNING qs.id;

-- name: ListQueueSessionsInRange :many
SELECT * FROM queue_sessions
WHERE outlet_id = $1
  AND session_date BETWEEN sqlc.arg(from_date)::date AND sqlc.arg(to_date)::date
ORDER BY session_date;
