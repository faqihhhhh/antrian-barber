-- name: CreateInvoice :one
INSERT INTO invoices (tenant_id, plan_id, amount_rupiah, unique_code, expires_at, payment_method)
VALUES ($1, $2, $3, $4, now() + interval '30 minutes', $5)
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
WHERE id = $1 AND status = 'pending' AND payment_method = 'midtrans' AND amount_rupiah = $2
RETURNING tenant_id, plan_id, paid_at;

-- name: ListInvoicesByTenant :many
SELECT * FROM invoices WHERE tenant_id = $1 ORDER BY created_at DESC;

-- name: ListPendingInvoices :many
SELECT i.id, i.tenant_id, t.name AS tenant_name, i.plan_id, p.name AS plan_name,
       i.amount_rupiah, i.unique_code, i.payment_method, i.status, i.expires_at, i.created_at
FROM invoices i
JOIN tenants t ON t.id = i.tenant_id
JOIN plans p ON p.id = i.plan_id
WHERE i.status = 'pending' OR (i.status = 'expired' AND i.expires_at > now() - interval '14 days')
ORDER BY i.created_at;

-- name: CountPendingManualInvoices :one
SELECT count(*)::bigint FROM invoices
WHERE status = 'pending' AND payment_method = 'manual';

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
