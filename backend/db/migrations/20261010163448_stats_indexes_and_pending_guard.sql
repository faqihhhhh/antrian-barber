-- +goose Up
CREATE INDEX idx_queue_sessions_tenant_date ON queue_sessions (tenant_id, session_date);

-- Satu pesanan belum dibayar per pelanggan per sesi. Dijaga di level database
-- supaya dua request bersamaan dari pelanggan yang sama tetap tidak lolos.
CREATE UNIQUE INDEX idx_tickets_one_pending_per_customer
  ON tickets (queue_session_id, customer_user_id) WHERE status = 'pending_payment';

-- +goose Down
DROP INDEX IF EXISTS idx_tickets_one_pending_per_customer;
DROP INDEX IF EXISTS idx_queue_sessions_tenant_date;