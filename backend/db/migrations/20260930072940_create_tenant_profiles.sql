-- +goose Up
CREATE TABLE tenant_profiles (
    tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    midtrans_server_key_encrypted TEXT,
    midtrans_client_key_encrypted TEXT,
    midtrans_configured_at TIMESTAMPTZ,
    onboarding_completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE tenant_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_profiles_all ON tenant_profiles FOR ALL
  USING (app_has_tenant_access(tenant_id))
  WITH CHECK (app_has_tenant_access(tenant_id));

-- +goose Down
DROP TABLE IF EXISTS tenant_profiles;