-- +goose Up
-- Keanggotaan dengan roles kosong tetap menyimpan jejak FK tiket dan ulasan,
-- tetapi tidak lagi dianggap sebagai anggota aktif oleh RLS.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION app_has_tenant_access(check_tenant_id UUID) RETURNS BOOLEAN AS $$
  SELECT app_is_platform_admin() OR EXISTS (
    SELECT 1 FROM memberships
    WHERE tenant_id = check_tenant_id
      AND user_id = app_current_user_id()
      AND cardinality(roles) > 0
  );
$$ LANGUAGE sql STABLE;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION app_has_tenant_access(check_tenant_id UUID) RETURNS BOOLEAN AS $$
  SELECT app_is_platform_admin() OR EXISTS (
    SELECT 1 FROM memberships
    WHERE tenant_id = check_tenant_id AND user_id = app_current_user_id()
  );
$$ LANGUAGE sql STABLE;
-- +goose StatementEnd
