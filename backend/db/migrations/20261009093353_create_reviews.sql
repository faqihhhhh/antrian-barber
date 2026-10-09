-- +goose Up
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION app_is_tenant_owner(check_tenant_id UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM memberships
    WHERE tenant_id = check_tenant_id
      AND user_id = app_current_user_id()
      AND 'owner' = ANY(roles)
  );
$$ LANGUAGE sql STABLE;
-- +goose StatementEnd

-- Target FK komposit dari reviews: memastikan tenant, pelanggan, dan kapster
-- di baris ulasan persis sama dengan yang tercatat di tiketnya.
ALTER TABLE tickets ADD CONSTRAINT tickets_review_ref_unique
  UNIQUE (id, tenant_id, customer_user_id, assigned_membership_id);

CREATE TABLE reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    ticket_id UUID NOT NULL UNIQUE,
    kapster_membership_id UUID NOT NULL,
    customer_user_id UUID NOT NULL,
    rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment TEXT CHECK (comment IS NULL OR char_length(comment) <= 1000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (ticket_id, tenant_id, customer_user_id, kapster_membership_id)
      REFERENCES tickets (id, tenant_id, customer_user_id, assigned_membership_id) ON DELETE CASCADE
);
CREATE INDEX idx_reviews_tenant_created ON reviews(tenant_id, created_at DESC);
CREATE INDEX idx_reviews_kapster ON reviews(kapster_membership_id);

ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY reviews_select ON reviews FOR SELECT
  USING (customer_user_id = app_current_user_id() OR app_is_tenant_owner(tenant_id));
CREATE POLICY reviews_insert ON reviews FOR INSERT
  WITH CHECK (customer_user_id = app_current_user_id());
-- Sengaja tanpa kebijakan UPDATE/DELETE: ulasan tidak bisa diubah atau dihapus.

-- +goose Down
DROP TABLE IF EXISTS reviews;
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_review_ref_unique;
DROP FUNCTION IF EXISTS app_is_tenant_owner(UUID);