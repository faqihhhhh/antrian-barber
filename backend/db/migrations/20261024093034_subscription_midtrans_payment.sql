-- +goose Up
ALTER TABLE invoices ADD COLUMN midtrans_order_id TEXT UNIQUE;
ALTER TABLE invoices ADD COLUMN qr_code_url TEXT;
DROP INDEX idx_invoices_unique_pending_amount;

-- +goose Down
ALTER TABLE invoices DROP COLUMN qr_code_url;
ALTER TABLE invoices DROP COLUMN midtrans_order_id;
CREATE UNIQUE INDEX idx_invoices_unique_pending_amount ON invoices(amount_rupiah) WHERE status = 'pending';
