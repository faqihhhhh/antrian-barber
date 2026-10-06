-- +goose Up
ALTER TABLE tenant_profiles ADD COLUMN midtrans_is_production BOOLEAN NOT NULL DEFAULT false;

-- +goose Down
ALTER TABLE tenant_profiles DROP COLUMN midtrans_is_production;