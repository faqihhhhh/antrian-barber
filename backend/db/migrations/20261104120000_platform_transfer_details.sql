-- +goose Up
ALTER TABLE platform_payment_settings
    ADD COLUMN transfer_recipient_name TEXT,
    ADD COLUMN transfer_bank_name TEXT,
    ADD COLUMN transfer_bank_account TEXT,
    ADD COLUMN transfer_dana_number TEXT,
    ADD COLUMN transfer_gopay_number TEXT;

-- +goose Down
ALTER TABLE platform_payment_settings
    DROP COLUMN transfer_gopay_number,
    DROP COLUMN transfer_dana_number,
    DROP COLUMN transfer_bank_account,
    DROP COLUMN transfer_bank_name,
    DROP COLUMN transfer_recipient_name;
