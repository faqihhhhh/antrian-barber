-- name: CountWaitingInSession :one
SELECT COUNT(*) FROM tickets WHERE queue_session_id = $1 AND status = 'waiting';

-- name: CountWaitingAheadOf :one
SELECT COUNT(*) FROM tickets WHERE queue_session_id = $1 AND status = 'waiting' AND queue_position < $2;

-- name: CountActiveKapsters :one
SELECT COUNT(*) FROM kapster_session_state WHERE queue_session_id = $1 AND status IN ('ready','busy');

-- name: GetAverageServiceDurationMinutes :one
WITH per_ticket AS (
  SELECT te.ticket_id,
         MAX(te.occurred_at) FILTER (WHERE te.event_type = 'started') AS started_at,
         MAX(te.occurred_at) FILTER (WHERE te.event_type = 'completed') AS completed_at
  FROM ticket_events te
  JOIN tickets t ON t.id = te.ticket_id
  JOIN queue_sessions qs ON qs.id = t.queue_session_id
  WHERE qs.outlet_id = $1 AND t.status = 'completed'
  GROUP BY te.ticket_id
)
SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) / 60), -1)::float8 AS avg_minutes
FROM per_ticket
WHERE started_at IS NOT NULL AND completed_at >= started_at;
