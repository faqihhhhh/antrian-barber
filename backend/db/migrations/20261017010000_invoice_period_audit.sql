-- +goose Up
ALTER TABLE invoices
    ADD COLUMN period_start TIMESTAMPTZ,
    ADD COLUMN period_end TIMESTAMPTZ;

-- +goose Down
ALTER TABLE invoices
    DROP COLUMN period_end,
    DROP COLUMN period_start;
