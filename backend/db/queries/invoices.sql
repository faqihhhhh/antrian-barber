-- name: CreateInvoice :one
INSERT INTO invoices (tenant_id, plan_id, amount_rupiah, unique_code, expires_at)
VALUES ($1, $2, $3, $4, now() + interval '30 minutes')
ON CONFLICT DO NOTHING
RETURNING *;

-- name: ExpireTenantInvoices :execrows
UPDATE invoices SET status = 'expired', updated_at = now()
WHERE tenant_id = $1 AND status = 'pending' AND expires_at < now();

-- name: GetPendingInvoiceByTenant :one
SELECT * FROM invoices WHERE tenant_id = $1 AND status = 'pending';

-- name: GetInvoiceByID :one
SELECT * FROM invoices WHERE id = $1;

-- name: GetInvoiceByMidtransOrderID :one
SELECT * FROM invoices WHERE midtrans_order_id = $1;

-- name: SetInvoiceMidtransPayment :execrows
UPDATE invoices SET midtrans_order_id = $2, qr_code_url = $3, updated_at = now()
WHERE id = $1 AND status = 'pending';

-- name: CancelInvoice :execrows
UPDATE invoices SET status = 'canceled', updated_at = now()
WHERE id = $1 AND status = 'pending';

-- name: MarkInvoiceMidtransPaid :one
UPDATE invoices SET status = 'paid', paid_at = now(), updated_at = now()
WHERE id = $1 AND status = 'pending' AND amount_rupiah = $2
RETURNING tenant_id, plan_id, paid_at;

-- name: ListInvoicesByTenant :many
SELECT * FROM invoices WHERE tenant_id = $1 ORDER BY created_at DESC;

-- name: ListPendingInvoices :many
SELECT * FROM invoices
WHERE status = 'pending' OR (status = 'expired' AND expires_at > now() - interval '14 days')
ORDER BY created_at;

-- name: ExpireStaleInvoices :execrows
UPDATE invoices SET status = 'expired', updated_at = now()
WHERE status = 'pending' AND expires_at < now();

-- name: MarkInvoicePaid :one
UPDATE invoices SET status = 'paid', paid_at = now(), confirmed_by = $2, updated_at = now()
WHERE id = $1 AND status IN ('pending', 'expired')
RETURNING tenant_id, plan_id, paid_at;

-- name: RecordInvoiceSubscriptionPeriod :execrows
UPDATE invoices SET period_start = $2, period_end = $3, updated_at = now()
WHERE id = $1 AND status = 'paid';
