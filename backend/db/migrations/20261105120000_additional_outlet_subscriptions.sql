-- +goose Up
ALTER TABLE platform_payment_settings
    ADD COLUMN additional_outlet_monthly_price_rupiah BIGINT NOT NULL DEFAULT 0 CHECK (additional_outlet_monthly_price_rupiah >= 0),
    ADD COLUMN additional_outlet_yearly_price_rupiah BIGINT NOT NULL DEFAULT 0 CHECK (additional_outlet_yearly_price_rupiah >= 0);

ALTER TABLE outlets
    ADD COLUMN is_additional BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN additional_period_end TIMESTAMPTZ,
    ADD COLUMN additional_billing_interval TEXT CHECK (additional_billing_interval IN ('monthly', 'yearly'));

ALTER TABLE invoices
    ADD COLUMN invoice_kind TEXT NOT NULL DEFAULT 'subscription' CHECK (invoice_kind IN ('subscription', 'outlet_addon')),
    ADD COLUMN outlet_id UUID REFERENCES outlets(id) ON DELETE SET NULL,
    ADD COLUMN requested_outlet_name TEXT,
    ADD COLUMN requested_outlet_timezone TEXT,
    ADD COLUMN requested_outlet_address TEXT,
    ADD COLUMN outlet_billing_interval TEXT CHECK (outlet_billing_interval IN ('monthly', 'yearly'));

-- +goose Down
ALTER TABLE invoices
    DROP COLUMN outlet_billing_interval,
    DROP COLUMN requested_outlet_address,
    DROP COLUMN requested_outlet_timezone,
    DROP COLUMN requested_outlet_name,
    DROP COLUMN outlet_id,
    DROP COLUMN invoice_kind;

ALTER TABLE outlets
    DROP COLUMN additional_billing_interval,
    DROP COLUMN additional_period_end,
    DROP COLUMN is_additional;

ALTER TABLE platform_payment_settings
    DROP COLUMN additional_outlet_yearly_price_rupiah,
    DROP COLUMN additional_outlet_monthly_price_rupiah;
