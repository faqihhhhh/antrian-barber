-- name: CreateTicketEvent :exec
INSERT INTO ticket_events (tenant_id, ticket_id, event_type, actor_membership_id)
VALUES ($1, $2, $3, $4);