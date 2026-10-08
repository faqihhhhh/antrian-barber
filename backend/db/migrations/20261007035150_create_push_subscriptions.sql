-- +goose Up
CREATE TABLE push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_push_subscriptions_user_id ON push_subscriptions(user_id);

-- Tabel milik pengguna sendiri (bukan tenant), jadi kebijakannya langsung
-- ke user_id, tidak lewat app_has_tenant_access sama sekali.
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY push_subscriptions_all ON push_subscriptions FOR ALL
  USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());

-- +goose Down
DROP TABLE IF EXISTS push_subscriptions;