-- +goose Up
ALTER TABLE queue_sessions ADD COLUMN used_quota INT NOT NULL DEFAULT 0 CHECK (used_quota >= 0);
UPDATE queue_sessions qs
SET used_quota = (SELECT count(*) FROM tickets t WHERE t.queue_session_id = qs.id AND t.status <> 'canceled');

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION claim_ticket_number_for_booking(p_session_id UUID) RETURNS INT
SECURITY DEFINER
SET search_path = public, pg_temp
LANGUAGE plpgsql
AS $$
DECLARE
  v_number INT;
BEGIN
  UPDATE queue_sessions
  SET next_ticket_number = next_ticket_number + 1,
      used_quota = used_quota + 1,
      updated_at = now()
  WHERE id = p_session_id AND status = 'open' AND used_quota < max_quota
  RETURNING next_ticket_number - 1 INTO v_number;

  RETURN COALESCE(v_number, -1);
END;
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION cancel_pending_ticket(p_ticket_id UUID) RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = public, pg_temp
LANGUAGE plpgsql
AS $$
DECLARE
  v_session_id UUID;
BEGIN
  UPDATE tickets
  SET status = 'canceled', updated_at = now()
  WHERE id = p_ticket_id
    AND status = 'pending_payment'
    AND (customer_user_id = app_current_user_id() OR app_has_tenant_access(tenant_id))
  RETURNING queue_session_id INTO v_session_id;

  IF v_session_id IS NULL THEN
    RETURN FALSE;
  END IF;

  UPDATE queue_sessions
  SET used_quota = used_quota - 1, updated_at = now()
  WHERE id = v_session_id AND used_quota > 0;

  RETURN TRUE;
END;
$$;
-- +goose StatementEnd

REVOKE EXECUTE ON FUNCTION cancel_pending_ticket(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cancel_pending_ticket(UUID) TO kapsflow_app;

CREATE TABLE subscription_reminders (
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    period_end TIMESTAMPTZ NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('h7','h3')),
    sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, period_end, kind)
);
ALTER TABLE subscription_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_reminders FORCE ROW LEVEL SECURITY;
CREATE POLICY subscription_reminders_all ON subscription_reminders FOR ALL
  USING (app_has_tenant_access(tenant_id)) WITH CHECK (app_has_tenant_access(tenant_id));

-- +goose Down
DROP TABLE IF EXISTS subscription_reminders;
DROP FUNCTION IF EXISTS cancel_pending_ticket(UUID);
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION claim_ticket_number_for_booking(p_session_id UUID) RETURNS INT
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_number INT;
BEGIN
  UPDATE queue_sessions
  SET next_ticket_number = next_ticket_number + 1, updated_at = now()
  WHERE id = p_session_id AND status = 'open' AND next_ticket_number <= max_quota
  RETURNING next_ticket_number - 1 INTO v_number;

  RETURN COALESCE(v_number, -1);
END;
$$;
-- +goose StatementEnd
ALTER TABLE queue_sessions DROP COLUMN IF EXISTS used_quota;