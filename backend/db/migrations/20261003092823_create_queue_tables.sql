-- +goose Up
ALTER TABLE outlets
    ADD COLUMN dp_price_rupiah BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN default_duration_minutes INT NOT NULL DEFAULT 30;

CREATE TABLE queue_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    outlet_id UUID NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
    session_date DATE NOT NULL,
    max_quota INT NOT NULL CHECK (max_quota > 0),
    next_ticket_number INT NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (outlet_id, session_date)
);
CREATE INDEX idx_queue_sessions_tenant_id ON queue_sessions(tenant_id);
CREATE INDEX idx_queue_sessions_outlet_id ON queue_sessions(outlet_id);

CREATE TABLE tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    queue_session_id UUID NOT NULL REFERENCES queue_sessions(id) ON DELETE CASCADE,
    ticket_number INT NOT NULL,
    queue_position INT NOT NULL,
    channel TEXT NOT NULL CHECK (channel IN ('online','offline')),
    customer_name TEXT,
    match_code TEXT,
    status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','called','in_progress','completed','canceled')),
    assigned_membership_id UUID REFERENCES memberships(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (queue_session_id, ticket_number)
);
CREATE INDEX idx_tickets_tenant_id ON tickets(tenant_id);
-- Index ini yang dipakai query klaim tiket (FOR UPDATE SKIP LOCKED) tiap
-- kapster pencet "siap" — harus tetap cepat walau dipanggil bersamaan.
CREATE INDEX idx_tickets_session_waiting ON tickets(queue_session_id, queue_position) WHERE status = 'waiting';

CREATE TABLE ticket_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN ('created','called','started','completed','skipped')),
    actor_membership_id UUID REFERENCES memberships(id),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ticket_events_ticket_id ON ticket_events(ticket_id);

CREATE TABLE kapster_session_state (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    queue_session_id UUID NOT NULL REFERENCES queue_sessions(id) ON DELETE CASCADE,
    membership_id UUID NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle','ready','busy')),
    current_ticket_id UUID REFERENCES tickets(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (queue_session_id, membership_id)
);
CREATE INDEX idx_kapster_session_state_tenant_id ON kapster_session_state(tenant_id);

-- FOR ALL (bukan cuma SELECT) di semua tabel baru ini — lihat catatan di
-- chat soal SELECT ... FOR UPDATE diam-diam mengunci nol baris kalau cuma
-- ada kebijakan SELECT.
ALTER TABLE queue_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE queue_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY queue_sessions_all ON queue_sessions FOR ALL
  USING (app_has_tenant_access(tenant_id)) WITH CHECK (app_has_tenant_access(tenant_id));

ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets FORCE ROW LEVEL SECURITY;
CREATE POLICY tickets_all ON tickets FOR ALL
  USING (app_has_tenant_access(tenant_id)) WITH CHECK (app_has_tenant_access(tenant_id));

ALTER TABLE ticket_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_events FORCE ROW LEVEL SECURITY;
CREATE POLICY ticket_events_all ON ticket_events FOR ALL
  USING (app_has_tenant_access(tenant_id)) WITH CHECK (app_has_tenant_access(tenant_id));

ALTER TABLE kapster_session_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE kapster_session_state FORCE ROW LEVEL SECURITY;
CREATE POLICY kapster_session_state_all ON kapster_session_state FOR ALL
  USING (app_has_tenant_access(tenant_id)) WITH CHECK (app_has_tenant_access(tenant_id));

-- +goose Down
DROP TABLE IF EXISTS kapster_session_state;
DROP TABLE IF EXISTS ticket_events;
DROP TABLE IF EXISTS tickets;
DROP TABLE IF EXISTS queue_sessions;
ALTER TABLE outlets DROP COLUMN IF EXISTS dp_price_rupiah;
ALTER TABLE outlets DROP COLUMN IF EXISTS default_duration_minutes;