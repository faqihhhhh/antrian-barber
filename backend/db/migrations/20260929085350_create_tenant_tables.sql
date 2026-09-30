-- +goose Up
CREATE TABLE platform_admins (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE outlets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    timezone TEXT NOT NULL, -- nama zona IANA, misal 'Asia/Jakarta'
    address TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_outlets_tenant_id ON outlets(tenant_id);

CREATE TABLE memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    roles TEXT[] NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, user_id)
);
CREATE INDEX idx_memberships_user_id ON memberships(user_id);
CREATE INDEX idx_memberships_tenant_id ON memberships(tenant_id);

-- Menentukan outlet mana saja tempat seorang admin/kapster bertugas.
-- Owner tidak perlu baris di sini (aksesnya ke semua outlet lewat peran).
CREATE TABLE membership_outlets (
    membership_id UUID NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
    outlet_id UUID NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
    PRIMARY KEY (membership_id, outlet_id)
);

-- Fungsi bantu, dipakai berulang oleh kebijakan RLS tabel ini dan
-- tabel-tabel tenant lain di fase berikutnya.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS UUID AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION app_is_platform_admin() RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM platform_admins WHERE user_id = app_current_user_id());
$$ LANGUAGE sql STABLE;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION app_has_tenant_access(check_tenant_id UUID) RETURNS BOOLEAN AS $$
  SELECT app_is_platform_admin() OR EXISTS (
    SELECT 1 FROM memberships
    WHERE tenant_id = check_tenant_id AND user_id = app_current_user_id()
  );
$$ LANGUAGE sql STABLE;
-- +goose StatementEnd

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenants_select ON tenants FOR SELECT USING (app_has_tenant_access(id));
CREATE POLICY tenants_insert ON tenants FOR INSERT WITH CHECK (app_current_user_id() IS NOT NULL);
CREATE POLICY tenants_update ON tenants FOR UPDATE USING (app_has_tenant_access(id));

ALTER TABLE outlets ENABLE ROW LEVEL SECURITY;
ALTER TABLE outlets FORCE ROW LEVEL SECURITY;
CREATE POLICY outlets_all ON outlets FOR ALL
  USING (app_has_tenant_access(tenant_id))
  WITH CHECK (app_has_tenant_access(tenant_id));

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY memberships_select ON memberships FOR SELECT
  USING (user_id = app_current_user_id() OR app_has_tenant_access(tenant_id));
CREATE POLICY memberships_insert ON memberships FOR INSERT
  WITH CHECK (user_id = app_current_user_id() OR app_has_tenant_access(tenant_id));
CREATE POLICY memberships_update ON memberships FOR UPDATE
  USING (app_has_tenant_access(tenant_id));

ALTER TABLE membership_outlets ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership_outlets FORCE ROW LEVEL SECURITY;
CREATE POLICY membership_outlets_all ON membership_outlets FOR ALL
  USING (EXISTS (SELECT 1 FROM memberships m WHERE m.id = membership_outlets.membership_id AND app_has_tenant_access(m.tenant_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM memberships m WHERE m.id = membership_outlets.membership_id AND app_has_tenant_access(m.tenant_id)));

-- +goose Down
DROP TABLE IF EXISTS membership_outlets;
DROP POLICY IF EXISTS memberships_update ON memberships;
DROP POLICY IF EXISTS memberships_insert ON memberships;
DROP POLICY IF EXISTS memberships_select ON memberships;
DROP POLICY IF EXISTS outlets_all ON outlets;
DROP POLICY IF EXISTS tenants_update ON tenants;
DROP POLICY IF EXISTS tenants_insert ON tenants;
DROP POLICY IF EXISTS tenants_select ON tenants;
DROP FUNCTION IF EXISTS app_has_tenant_access(UUID);
DROP FUNCTION IF EXISTS app_is_platform_admin();
DROP FUNCTION IF EXISTS app_current_user_id();
DROP TABLE IF EXISTS memberships;
DROP TABLE IF EXISTS outlets;
DROP TABLE IF EXISTS tenants;
DROP TABLE IF EXISTS platform_admins;