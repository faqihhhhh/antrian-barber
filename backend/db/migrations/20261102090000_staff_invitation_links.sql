-- +goose Up
CREATE TABLE staff_invitation_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    token_hash BYTEA NOT NULL UNIQUE,
    created_by UUID NOT NULL REFERENCES users(id),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_staff_invitation_links_tenant ON staff_invitation_links(tenant_id);

CREATE TABLE staff_applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    invitation_id UUID NOT NULL REFERENCES staff_invitation_links(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, user_id)
);
CREATE INDEX idx_staff_applications_tenant_status ON staff_applications(tenant_id, status);

ALTER TABLE staff_invitation_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_invitation_links FORCE ROW LEVEL SECURITY;
CREATE POLICY staff_invitation_links_owner ON staff_invitation_links FOR ALL
  USING (app_has_tenant_access(tenant_id)) WITH CHECK (app_has_tenant_access(tenant_id));

ALTER TABLE staff_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_applications FORCE ROW LEVEL SECURITY;
CREATE POLICY staff_applications_select ON staff_applications FOR SELECT
  USING (app_has_tenant_access(tenant_id) OR user_id = app_current_user_id());
CREATE POLICY staff_applications_insert ON staff_applications FOR INSERT
  WITH CHECK (user_id = app_current_user_id());
CREATE POLICY staff_applications_update ON staff_applications FOR UPDATE
  USING (app_has_tenant_access(tenant_id)) WITH CHECK (app_has_tenant_access(tenant_id));

-- Fungsi publik hanya mengembalikan nama bisnis untuk token valid; tabel dan hash
-- undangan tetap tidak dapat dibaca langsung oleh pengguna anonim.
-- +goose StatementBegin
CREATE FUNCTION lookup_staff_invitation(p_token_hash BYTEA)
RETURNS TABLE (tenant_id UUID, tenant_name TEXT, expires_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT i.tenant_id, t.name, i.expires_at
  FROM public.staff_invitation_links i
  JOIN public.tenants t ON t.id = i.tenant_id
  WHERE i.token_hash = p_token_hash
    AND i.revoked_at IS NULL
    AND i.expires_at > now()
  LIMIT 1;
$$;
-- +goose StatementEnd
REVOKE ALL ON FUNCTION lookup_staff_invitation(BYTEA) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lookup_staff_invitation(BYTEA) TO kapsflow_app;

-- Pembuatan pengajuan dijalankan sebagai fungsi terbatas agar pemohon tanpa
-- membership dapat memakai token, tetapi hanya untuk user_id sesi miliknya.
-- +goose StatementBegin
CREATE FUNCTION submit_staff_application(p_token_hash BYTEA, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  created_count INTEGER;
BEGIN
  IF p_user_id IS DISTINCT FROM public.app_current_user_id() THEN
    RAISE EXCEPTION 'user_id does not match authenticated user';
  END IF;
  INSERT INTO public.staff_applications (tenant_id, invitation_id, user_id)
  SELECT i.tenant_id, i.id, p_user_id
  FROM public.staff_invitation_links i
  WHERE i.token_hash = p_token_hash AND i.revoked_at IS NULL AND i.expires_at > now()
  ON CONFLICT (tenant_id, user_id) DO NOTHING;
  GET DIAGNOSTICS created_count = ROW_COUNT;
  RETURN created_count = 1;
END;
$$;
-- +goose StatementEnd
REVOKE ALL ON FUNCTION submit_staff_application(BYTEA, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION submit_staff_application(BYTEA, UUID) TO kapsflow_app;

-- +goose Down
REVOKE EXECUTE ON FUNCTION submit_staff_application(BYTEA, UUID) FROM kapsflow_app;
DROP FUNCTION IF EXISTS submit_staff_application(BYTEA, UUID);
REVOKE EXECUTE ON FUNCTION lookup_staff_invitation(BYTEA) FROM kapsflow_app;
DROP FUNCTION IF EXISTS lookup_staff_invitation(BYTEA);
DROP TABLE IF EXISTS staff_applications;
DROP TABLE IF EXISTS staff_invitation_links;
