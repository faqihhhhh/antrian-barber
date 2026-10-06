-- +goose Up
DROP POLICY outlets_all ON outlets;
CREATE POLICY outlets_select ON outlets FOR SELECT USING (true);
CREATE POLICY outlets_insert ON outlets FOR INSERT WITH CHECK (app_has_tenant_access(tenant_id));
CREATE POLICY outlets_update ON outlets FOR UPDATE
  USING (app_has_tenant_access(tenant_id)) WITH CHECK (app_has_tenant_access(tenant_id));
CREATE POLICY outlets_delete ON outlets FOR DELETE USING (app_has_tenant_access(tenant_id));

-- Kebijakan DELETE juga belum ada di queue_sessions sejak Fase 7 (celah
-- kecil yang belum ketahuan karena belum ada fitur hapus sesi) — ditambal
-- sekalian di sini supaya konsisten.
CREATE POLICY queue_sessions_delete ON queue_sessions FOR DELETE USING (app_has_tenant_access(tenant_id));

-- +goose Down
DROP POLICY IF EXISTS queue_sessions_delete ON queue_sessions;
DROP POLICY IF EXISTS outlets_delete ON outlets;
DROP POLICY IF EXISTS outlets_update ON outlets;
DROP POLICY IF EXISTS outlets_insert ON outlets;
DROP POLICY IF EXISTS outlets_select ON outlets;
CREATE POLICY outlets_all ON outlets FOR ALL
  USING (app_has_tenant_access(tenant_id)) WITH CHECK (app_has_tenant_access(tenant_id));