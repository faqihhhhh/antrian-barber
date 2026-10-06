-- name: ClaimTicketNumberForBooking :one
SELECT claim_ticket_number_for_booking($1) AS ticket_number;