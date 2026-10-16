-- +goose Up
DROP POLICY tickets_all ON tickets;
CREATE POLICY tickets_select ON tickets FOR SELECT
  USING (app_has_tenant_access(tenant_id) OR customer_user_id = app_current_user_id());
CREATE POLICY tickets_insert ON tickets FOR INSERT
  WITH CHECK (app_has_tenant_access(tenant_id) OR customer_user_id = app_current_user_id());
CREATE POLICY tickets_staff_update ON tickets FOR UPDATE
  USING (app_has_tenant_access(tenant_id))
  WITH CHECK (app_has_tenant_access(tenant_id));

DROP POLICY ticket_payments_all ON ticket_payments;
CREATE POLICY ticket_payments_select ON ticket_payments FOR SELECT
  USING (app_has_tenant_access(tenant_id) OR customer_user_id = app_current_user_id());
CREATE POLICY ticket_payments_insert ON ticket_payments FOR INSERT
  WITH CHECK (app_has_tenant_access(tenant_id) OR customer_user_id = app_current_user_id());
CREATE POLICY ticket_payments_staff_update ON ticket_payments FOR UPDATE
  USING (app_has_tenant_access(tenant_id))
  WITH CHECK (app_has_tenant_access(tenant_id));

-- +goose Down
DROP POLICY IF EXISTS tickets_staff_update ON tickets;
DROP POLICY IF EXISTS tickets_insert ON tickets;
DROP POLICY IF EXISTS tickets_select ON tickets;
CREATE POLICY tickets_all ON tickets FOR ALL
  USING (app_has_tenant_access(tenant_id) OR customer_user_id = app_current_user_id())
  WITH CHECK (app_has_tenant_access(tenant_id) OR customer_user_id = app_current_user_id());

DROP POLICY IF EXISTS ticket_payments_staff_update ON ticket_payments;
DROP POLICY IF EXISTS ticket_payments_insert ON ticket_payments;
DROP POLICY IF EXISTS ticket_payments_select ON ticket_payments;
CREATE POLICY ticket_payments_all ON ticket_payments FOR ALL
  USING (app_has_tenant_access(tenant_id) OR customer_user_id = app_current_user_id())
  WITH CHECK (app_has_tenant_access(tenant_id) OR customer_user_id = app_current_user_id());
