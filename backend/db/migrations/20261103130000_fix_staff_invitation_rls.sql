-- +goose Up
DROP FUNCTION lookup_staff_invitation(BYTEA);
-- +goose StatementBegin
CREATE FUNCTION lookup_staff_invitation(p_token_hash BYTEA)
RETURNS TABLE (tenant_id UUID, tenant_name TEXT, expires_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  previous_app_user TEXT;
BEGIN
  previous_app_user := current_setting('app.user_id', true);
  PERFORM set_config('app.user_id', '00000000-0000-0000-0000-000000000001', true);

  RETURN QUERY
  SELECT i.tenant_id, t.name, i.expires_at
  FROM public.staff_invitation_links i
  JOIN public.tenants t ON t.id = i.tenant_id
  WHERE i.token_hash = p_token_hash
    AND i.revoked_at IS NULL
    AND i.expires_at > now()
  LIMIT 1;

  PERFORM set_config('app.user_id', COALESCE(previous_app_user, ''), true);
END;
$$;
-- +goose StatementEnd
REVOKE ALL ON FUNCTION lookup_staff_invitation(BYTEA) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lookup_staff_invitation(BYTEA) TO kapsflow_app;

DROP FUNCTION submit_staff_application(BYTEA, UUID);
-- +goose StatementBegin
CREATE FUNCTION submit_staff_application(p_token_hash BYTEA, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  previous_app_user TEXT;
  invitation_id UUID;
  invitation_tenant_id UUID;
  invitation_found BOOLEAN;
  created_count INTEGER;
BEGIN
  IF p_user_id IS DISTINCT FROM public.app_current_user_id() THEN
    RAISE EXCEPTION 'user_id does not match authenticated user';
  END IF;

  previous_app_user := current_setting('app.user_id', true);
  PERFORM set_config('app.user_id', '00000000-0000-0000-0000-000000000001', true);

  SELECT i.id, i.tenant_id
  INTO invitation_id, invitation_tenant_id
  FROM public.staff_invitation_links i
  WHERE i.token_hash = p_token_hash
    AND i.revoked_at IS NULL
    AND i.expires_at > now()
  FOR SHARE;
  invitation_found := FOUND;

  PERFORM set_config('app.user_id', COALESCE(previous_app_user, ''), true);
  IF NOT invitation_found THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.staff_applications (tenant_id, invitation_id, user_id)
  VALUES (invitation_tenant_id, invitation_id, p_user_id)
  ON CONFLICT (tenant_id, user_id) DO NOTHING;
  GET DIAGNOSTICS created_count = ROW_COUNT;
  RETURN created_count = 1;
END;
$$;
-- +goose StatementEnd
REVOKE ALL ON FUNCTION submit_staff_application(BYTEA, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION submit_staff_application(BYTEA, UUID) TO kapsflow_app;

-- +goose Down
DROP FUNCTION submit_staff_application(BYTEA, UUID);
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

DROP FUNCTION lookup_staff_invitation(BYTEA);
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
