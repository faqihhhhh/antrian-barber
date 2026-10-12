-- name: CreateTicketPayment :one
INSERT INTO ticket_payments (id, tenant_id, ticket_id, customer_user_id, method, amount_rupiah, unique_code, midtrans_order_id, expires_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
ON CONFLICT DO NOTHING
RETURNING *;

-- name: GetTicketPaymentByID :one
SELECT * FROM ticket_payments WHERE id = $1;

-- name: GetTicketPaymentByTicketID :one
SELECT * FROM ticket_payments WHERE ticket_id = $1;



-- name: MarkTicketPaymentPaid :execrows
UPDATE ticket_payments SET status = 'paid', paid_at = now(), confirmed_by = $2, updated_at = now()
WHERE id = $1 AND status = 'pending';

-- name: MarkTicketPaymentFailed :execrows
UPDATE ticket_payments SET status = 'failed', updated_at = now()
WHERE id = $1 AND status = 'pending';

-- name: ListExpiredPendingPayments :many
SELECT * FROM ticket_payments
WHERE status = 'pending' AND expires_at < now() - interval '2 minutes'
ORDER BY expires_at
LIMIT 100;