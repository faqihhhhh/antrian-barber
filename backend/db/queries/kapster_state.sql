-- name: UpsertKapsterSessionState :one
INSERT INTO kapster_session_state (tenant_id, queue_session_id, membership_id, status, current_ticket_id)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (queue_session_id, membership_id) DO UPDATE SET
  status = EXCLUDED.status, current_ticket_id = EXCLUDED.current_ticket_id, updated_at = now()
RETURNING *;

-- name: GetKapsterSessionState :one
SELECT * FROM kapster_session_state WHERE queue_session_id = $1 AND membership_id = $2 FOR UPDATE;

-- name: ListKapsterStatesBySession :many
SELECT * FROM kapster_session_state WHERE queue_session_id = $1;

-- name: SetReadyKapstersIdle :exec
UPDATE kapster_session_state
SET status = 'idle', updated_at = now()
WHERE queue_session_id = $1 AND status = 'ready';
