-- name: CreateInvoice :one
INSERT INTO invoices (tenant_id, plan_id, amount_rupiah, unique_code, expires_at)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetInvoiceByID :one
SELECT * FROM invoices WHERE id = $1;

-- name: ListInvoicesByTenant :many
SELECT * FROM invoices WHERE tenant_id = $1 ORDER BY created_at DESC;

-- name: ListPendingInvoices :many
SELECT * FROM invoices WHERE status = 'pending' ORDER BY created_at;

-- name: MarkInvoicePaid :exec
UPDATE invoices SET status = 'paid', paid_at = now(), confirmed_by = $2, updated_at = now() WHERE id = $1;