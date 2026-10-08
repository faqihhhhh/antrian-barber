-- +goose Up
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION app_is_system_user() RETURNS BOOLEAN AS $$
  SELECT app_current_user_id() = '00000000-0000-0000-0000-000000000001'::uuid;
$$ LANGUAGE sql STABLE;
-- +goose StatementEnd

DROP POLICY push_subscriptions_all ON push_subscriptions;
CREATE POLICY push_subscriptions_all ON push_subscriptions FOR ALL
  USING (user_id = app_current_user_id() OR app_is_system_user())
  WITH CHECK (user_id = app_current_user_id() OR app_is_system_user());

-- +goose Down
DROP POLICY IF EXISTS push_subscriptions_all ON push_subscriptions;
CREATE POLICY push_subscriptions_all ON push_subscriptions FOR ALL
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());

DROP FUNCTION IF EXISTS app_is_system_user();