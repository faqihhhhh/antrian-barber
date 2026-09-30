-- +goose Up
CREATE TABLE plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    price_rupiah BIGINT NOT NULL,
    billing_interval TEXT NOT NULL CHECK (billing_interval IN ('monthly','yearly')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO plans (code, name, price_rupiah, billing_interval) VALUES
    ('starter_monthly', 'Starter Bulanan', 99000, 'monthly'),
    ('starter_yearly', 'Starter Tahunan', 999000, 'yearly');

CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
    plan_id UUID NOT NULL REFERENCES plans(id),
    current_period_end TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    plan_id UUID NOT NULL REFERENCES plans(id),
    amount_rupiah BIGINT NOT NULL,
    unique_code SMALLINT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','expired','canceled')),
    expires_at TIMESTAMPTZ NOT NULL,
    paid_at TIMESTAMPTZ,
    confirmed_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_invoices_tenant_id ON invoices(tenant_id);
CREATE INDEX idx_invoices_status ON invoices(status);
-- Mencegah dua invoice pending dengan nominal total persis sama di seluruh
-- platform, supaya Anda tidak salah cocokkan mutasi bank ke tenant yang keliru.
CREATE UNIQUE INDEX idx_invoices_unique_pending_amount ON invoices(amount_rupiah) WHERE status = 'pending';

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY subscriptions_all ON subscriptions FOR ALL
  USING (app_has_tenant_access(tenant_id))
  WITH CHECK (app_has_tenant_access(tenant_id));

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;
CREATE POLICY invoices_all ON invoices FOR ALL
  USING (app_has_tenant_access(tenant_id))
  WITH CHECK (app_has_tenant_access(tenant_id));

-- +goose Down
DROP TABLE IF EXISTS invoices;
DROP TABLE IF EXISTS subscriptions;
DROP TABLE IF EXISTS plans;