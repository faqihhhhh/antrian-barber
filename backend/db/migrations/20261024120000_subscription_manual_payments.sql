-- +goose Up
CREATE TABLE platform_payment_settings (
    id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id = true),
    manual_qris_image BYTEA,
    manual_qris_content_type TEXT,
    manual_qris_updated_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE platform_payment_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_payment_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_payment_settings_admin_all ON platform_payment_settings FOR ALL
  USING (app_is_platform_admin())
  WITH CHECK (app_is_platform_admin());

ALTER TABLE invoices
  ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'manual'
  CHECK (payment_method IN ('manual', 'midtrans'));
UPDATE invoices SET payment_method = 'midtrans' WHERE midtrans_order_id IS NOT NULL;
CREATE UNIQUE INDEX idx_invoices_unique_pending_manual_amount
  ON invoices (amount_rupiah)
  WHERE status = 'pending' AND payment_method = 'manual';

-- +goose Down
DROP INDEX idx_invoices_unique_pending_manual_amount;
ALTER TABLE invoices DROP COLUMN payment_method;
DROP TABLE platform_payment_settings;
