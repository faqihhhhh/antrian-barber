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

-- name: ListKapsterNamesForTickets :many
SELECT t.id AS ticket_id, u.display_name AS kapster_name
FROM tickets t
JOIN memberships m ON m.id = t.assigned_membership_id
JOIN users u ON u.id = m.user_id
WHERE t.id = ANY(sqlc.arg(ticket_ids)::uuid[]);
