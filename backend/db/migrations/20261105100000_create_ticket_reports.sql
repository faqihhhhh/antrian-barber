-- +goose Up
CREATE TABLE ticket_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    ticket_id UUID NOT NULL UNIQUE REFERENCES tickets(id) ON DELETE CASCADE,
    customer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    comment TEXT NOT NULL CHECK (char_length(comment) BETWEEN 1 AND 2000),
    refund_sent_at TIMESTAMPTZ,
    refund_confirmed_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ticket_reports_tenant_created ON ticket_reports(tenant_id, created_at DESC);

ALTER TABLE ticket_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_reports FORCE ROW LEVEL SECURITY;
CREATE POLICY ticket_reports_select ON ticket_reports FOR SELECT
  USING (customer_user_id = app_current_user_id() OR app_is_tenant_owner(tenant_id));
CREATE POLICY ticket_reports_insert ON ticket_reports FOR INSERT
  WITH CHECK (
    customer_user_id = app_current_user_id()
    AND EXISTS (
      SELECT 1
      FROM tickets t
      JOIN queue_sessions qs ON qs.id = t.queue_session_id
      JOIN outlets o ON o.id = qs.outlet_id
      JOIN ticket_payments p ON p.ticket_id = t.id
      WHERE t.id = ticket_reports.ticket_id
        AND t.tenant_id = ticket_reports.tenant_id
        AND t.customer_user_id = ticket_reports.customer_user_id
        AND t.channel = 'online'
        AND t.status IN ('waiting', 'called')
        AND p.status = 'paid'
        AND qs.session_date < (now() AT TIME ZONE o.timezone)::date
    )
  );
CREATE POLICY ticket_reports_update ON ticket_reports FOR UPDATE
  USING (app_is_tenant_owner(tenant_id))
  WITH CHECK (app_is_tenant_owner(tenant_id));

-- +goose Down
DROP TABLE IF EXISTS ticket_reports;
