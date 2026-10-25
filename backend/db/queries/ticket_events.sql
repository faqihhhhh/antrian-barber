-- name: CreateTicketEvent :exec
INSERT INTO ticket_events (tenant_id, ticket_id, event_type, actor_membership_id)
VALUES ($1, $2, $3, $4);

-- name: ListCalledTicketIDsBySession :many
SELECT DISTINCT te.ticket_id
FROM ticket_events te
JOIN tickets t ON t.id = te.ticket_id
WHERE t.queue_session_id = $1 AND te.event_type = 'called';

-- name: ListCalledTicketIDsForTickets :many
SELECT DISTINCT ticket_id
FROM ticket_events
WHERE event_type = 'called' AND ticket_id = ANY(sqlc.arg(ticket_ids)::uuid[]);
