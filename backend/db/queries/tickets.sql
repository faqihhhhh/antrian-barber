-- name: CreateTicket :one
INSERT INTO tickets (tenant_id, queue_session_id, ticket_number, queue_position, channel, customer_name, match_code)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: GetTicketForUpdate :one
SELECT * FROM tickets WHERE id = $1 FOR UPDATE;

-- name: ClaimNextWaitingTicket :one
SELECT * FROM tickets
WHERE queue_session_id = $1 AND status = 'waiting'
ORDER BY queue_position
LIMIT 1
FOR UPDATE SKIP LOCKED;

-- name: NextWaitingTicketExcluding :one
SELECT * FROM tickets
WHERE queue_session_id = $1 AND status = 'waiting' AND id != $2
ORDER BY queue_position
LIMIT 1
FOR UPDATE SKIP LOCKED;

-- name: MarkTicketCalled :exec
UPDATE tickets SET status = 'called', assigned_membership_id = $2, updated_at = now() WHERE id = $1;

-- name: MarkTicketInProgress :exec
UPDATE tickets SET status = 'in_progress', updated_at = now() WHERE id = $1 AND status = 'called';

-- name: MarkTicketCompleted :exec
UPDATE tickets SET status = 'completed', updated_at = now() WHERE id = $1 AND status = 'in_progress';

-- name: RequeueTicket :exec
UPDATE tickets SET status = 'waiting', assigned_membership_id = NULL, updated_at = now() WHERE id = $1;

-- name: SetTicketQueuePosition :exec
UPDATE tickets SET queue_position = $2, updated_at = now() WHERE id = $1;

-- name: ListTicketsBySession :many
SELECT * FROM tickets WHERE queue_session_id = $1 ORDER BY queue_position;