-- name: CountWaitingInSession :one
SELECT COUNT(*) FROM tickets WHERE queue_session_id = $1 AND status = 'waiting';

-- name: CountWaitingAheadOf :one
SELECT COUNT(*) FROM tickets WHERE queue_session_id = $1 AND status = 'waiting' AND queue_position < $2;

-- name: CountActiveKapsters :one
SELECT COUNT(*) FROM kapster_session_state WHERE queue_session_id = $1 AND status IN ('ready','busy');

-- name: GetAverageCallIntervalMinutes :one
WITH relevant_events AS (
  SELECT te.actor_membership_id, te.occurred_at
  FROM ticket_events te
  JOIN tickets t ON t.id = te.ticket_id
  JOIN queue_sessions qs ON qs.id = t.queue_session_id
  WHERE te.event_type = 'called' AND qs.outlet_id = $1
), with_lag AS (
  SELECT occurred_at,
         LAG(occurred_at) OVER (PARTITION BY actor_membership_id ORDER BY occurred_at) AS prev_at
  FROM relevant_events
)
SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (occurred_at - prev_at)) / 60), -1)::float8 AS avg_minutes
FROM with_lag
WHERE prev_at IS NOT NULL;