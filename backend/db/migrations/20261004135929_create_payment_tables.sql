-- +goose Up
ALTER TABLE tickets DROP CONSTRAINT tickets_status_check;
ALTER TABLE tickets ADD CONSTRAINT tickets_status_check
  CHECK (status IN ('pending_payment','waiting','called','in_progress','completed','canceled'));

ALTER TABLE tickets
    ADD COLUMN customer_user_id UUID REFERENCES users(id),
    ADD COLUMN final_amount_rupiah BIGINT,
    ADD COLUMN final_payment_confirmed_by UUID REFERENCES users(id),
    ADD COLUMN final_payment_confirmed_at TIMESTAMPTZ;

CREATE TABLE ticket_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    ticket_id UUID NOT NULL UNIQUE REFERENCES tickets(id) ON DELETE CASCADE,
    customer_user_id UUID REFERENCES users(id),
    method TEXT NOT NULL CHECK (method IN ('midtrans','manual')),
    amount_rupiah BIGINT NOT NULL,
    unique_code SMALLINT,
    midtrans_order_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed')),
    confirmed_by UUID REFERENCES users(id),
    paid_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ticket_payments_tenant_id ON ticket_payments(tenant_id);

-- Unik PER TENANT (bukan lintas platform seperti invoice langganan) — QRIS
-- tiap barbershop adalah rekening/merchant yang berbeda-beda.
CREATE UNIQUE INDEX idx_ticket_payments_unique_pending_amount
  ON ticket_payments(tenant_id, amount_rupiah) WHERE status = 'pending' AND method = 'manual';

ALTER TABLE ticket_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_payments FORCE ROW LEVEL SECURITY;
CREATE POLICY ticket_payments_all ON ticket_payments FOR ALL
  USING (app_has_tenant_access(tenant_id) OR customer_user_id = app_current_user_id())
  WITH CHECK (app_has_tenant_access(tenant_id) OR customer_user_id = app_current_user_id());

-- Longgarkan tickets & queue_sessions untuk pelanggan — lihat penjelasan di chat.
DROP POLICY tickets_all ON tickets;
CREATE POLICY tickets_all ON tickets FOR ALL
  USING (app_has_tenant_access(tenant_id) OR customer_user_id = app_current_user_id())
  WITH CHECK (app_has_tenant_access(tenant_id) OR customer_user_id = app_current_user_id());

DROP POLICY queue_sessions_all ON queue_sessions;
CREATE POLICY queue_sessions_select ON queue_sessions FOR SELECT USING (true);
CREATE POLICY queue_sessions_insert ON queue_sessions FOR INSERT WITH CHECK (app_has_tenant_access(tenant_id));
CREATE POLICY queue_sessions_update ON queue_sessions FOR UPDATE
  USING (app_has_tenant_access(tenant_id)) WITH CHECK (app_has_tenant_access(tenant_id));

-- SECURITY DEFINER: satu-satunya jalan pelanggan (bukan staf) bisa menaikkan
-- next_ticket_number — lewat validasi eksplisit di dalam fungsi ini sendiri,
-- bukan lewat hak UPDATE tabel secara umum.

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

  RETURN COALESCE(v_number, -1); -- -1 artinya sesi tidak ada / tertutup / kuota penuh
END;
$$;
-- +goose StatementEnd

REVOKE EXECUTE ON FUNCTION claim_ticket_number_for_booking(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_ticket_number_for_booking(UUID) TO kapsflow_app;

-- Akun "sistem" sintetis untuk transaksi tanpa pengguna login (webhook
-- Midtrans, nanti job terjadwal Fase 8). Ditandai platform admin supaya
-- app_has_tenant_access selalu true untuknya.
INSERT INTO users (id, email, password_hash, email_verified_at)
VALUES ('00000000-0000-0000-0000-000000000001', 'system@kapsflow.internal', 'disabled-no-login', now())
ON CONFLICT (id) DO NOTHING;
INSERT INTO platform_admins (user_id)
VALUES ('00000000-0000-0000-0000-000000000001')
ON CONFLICT (user_id) DO NOTHING;

-- +goose Down
DELETE FROM platform_admins WHERE user_id = '00000000-0000-0000-0000-000000000001';
DELETE FROM users WHERE id = '00000000-0000-0000-0000-000000000001';
REVOKE EXECUTE ON FUNCTION claim_ticket_number_for_booking(UUID) FROM kapsflow_app;
DROP FUNCTION IF EXISTS claim_ticket_number_for_booking(UUID);
DROP POLICY IF EXISTS queue_sessions_update ON queue_sessions;
DROP POLICY IF EXISTS queue_sessions_insert ON queue_sessions;
DROP POLICY IF EXISTS queue_sessions_select ON queue_sessions;
CREATE POLICY queue_sessions_all ON queue_sessions FOR ALL
  USING (app_has_tenant_access(tenant_id)) WITH CHECK (app_has_tenant_access(tenant_id));
DROP POLICY IF EXISTS tickets_all ON tickets;
CREATE POLICY tickets_all ON tickets FOR ALL
  USING (app_has_tenant_access(tenant_id)) WITH CHECK (app_has_tenant_access(tenant_id));
DROP TABLE IF EXISTS ticket_payments;
ALTER TABLE tickets
    DROP COLUMN IF EXISTS final_payment_confirmed_at,
    DROP COLUMN IF EXISTS final_payment_confirmed_by,
    DROP COLUMN IF EXISTS final_amount_rupiah,
    DROP COLUMN IF EXISTS customer_user_id;
ALTER TABLE tickets DROP CONSTRAINT tickets_status_check;
ALTER TABLE tickets ADD CONSTRAINT tickets_status_check
  CHECK (status IN ('waiting','called','in_progress','completed','canceled'));