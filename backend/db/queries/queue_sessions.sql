-- name: CreateQueueSession :one
INSERT INTO queue_sessions (tenant_id, outlet_id, session_date, max_quota, created_by)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: ListQueueSessionsByOutlet :many
SELECT * FROM queue_sessions WHERE outlet_id = $1 ORDER BY session_date DESC;

-- name: IncreaseQueueQuota :one
UPDATE queue_sessions SET max_quota = max_quota + $2, updated_at = now() WHERE id = $1 RETURNING *;

-- name: ClaimNextTicketNumber :one
UPDATE queue_sessions
SET next_ticket_number = next_ticket_number + 1, updated_at = now()
WHERE id = $1 AND next_ticket_number <= max_quota
RETURNING (next_ticket_number - 1)::int AS ticket_number;