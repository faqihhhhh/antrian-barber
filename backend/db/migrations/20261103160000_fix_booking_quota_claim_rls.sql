-- +goose Up
-- Function owner on managed PostgreSQL may not have BYPASSRLS. Because
-- queue_sessions uses FORCE ROW LEVEL SECURITY, run this narrow atomic update
-- in the system-user RLS context, then restore the authenticated customer.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.claim_ticket_number_for_booking(p_session_id UUID) RETURNS INT
SECURITY DEFINER
SET search_path = pg_catalog, public
LANGUAGE plpgsql
AS $$
DECLARE
  v_number INT;
  previous_app_user TEXT;
BEGIN
  previous_app_user := current_setting('app.user_id', true);
  PERFORM set_config('app.user_id', '00000000-0000-0000-0000-000000000001', true);

  UPDATE public.queue_sessions
  SET next_ticket_number = next_ticket_number + 1,
      used_quota = used_quota + 1,
      updated_at = now()
  WHERE id = p_session_id
    AND status = 'open'
    AND used_quota < max_quota
  RETURNING next_ticket_number - 1 INTO v_number;

  PERFORM set_config('app.user_id', COALESCE(previous_app_user, ''), true);
  RETURN COALESCE(v_number, -1);
END;
$$;
-- +goose StatementEnd
REVOKE ALL ON FUNCTION public.claim_ticket_number_for_booking(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_ticket_number_for_booking(UUID) TO kapsflow_app;

-- +goose Down
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.claim_ticket_number_for_booking(p_session_id UUID) RETURNS INT
SECURITY DEFINER
SET search_path = pg_catalog, public
LANGUAGE plpgsql
AS $$
DECLARE
  v_number INT;
BEGIN
  UPDATE public.queue_sessions
  SET next_ticket_number = next_ticket_number + 1,
      used_quota = used_quota + 1,
      updated_at = now()
  WHERE id = p_session_id
    AND status = 'open'
    AND used_quota < max_quota
  RETURNING next_ticket_number - 1 INTO v_number;

  RETURN COALESCE(v_number, -1);
END;
$$;
-- +goose StatementEnd
REVOKE ALL ON FUNCTION public.claim_ticket_number_for_booking(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_ticket_number_for_booking(UUID) TO kapsflow_app;
