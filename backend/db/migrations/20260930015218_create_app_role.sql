-- +goose Up
-- Role restricted khusus untuk koneksi aplikasi saat runtime.
-- Password sengaja tidak ditulis di sini, diatur manual lewat psql.

-- +goose StatementBegin
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'kapsflow_app') THEN
    CREATE ROLE kapsflow_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;
-- +goose StatementEnd

GRANT USAGE ON SCHEMA public TO kapsflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO kapsflow_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kapsflow_app;

-- Supaya tabel yang dibuat di migrasi FUTURE (fase 4 dst) otomatis
-- ter-grant juga, tanpa perlu menulis ulang baris GRANT setiap migrasi baru.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO kapsflow_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO kapsflow_app;

-- +goose Down
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM kapsflow_app;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM kapsflow_app;
REVOKE USAGE ON SCHEMA public FROM kapsflow_app;
DROP ROLE IF EXISTS kapsflow_app;