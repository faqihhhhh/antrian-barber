-- +goose Up
CREATE UNIQUE INDEX idx_invoices_one_pending_per_tenant
    ON invoices (tenant_id)
    WHERE status = 'pending';

-- +goose Down
DROP INDEX IF EXISTS idx_invoices_one_pending_per_tenant;
