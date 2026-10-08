-- +goose Up
ALTER TABLE tickets ADD COLUMN turn_notified_at TIMESTAMPTZ;

-- +goose Down
ALTER TABLE tickets DROP COLUMN turn_notified_at;