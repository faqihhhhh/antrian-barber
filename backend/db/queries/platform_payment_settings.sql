-- name: GetPlatformPaymentSettings :one
SELECT manual_qris_image, manual_qris_content_type, manual_qris_updated_at,
       transfer_recipient_name, transfer_bank_name, transfer_bank_account,
       transfer_dana_number, transfer_gopay_number
FROM platform_payment_settings WHERE id = true;

-- name: SetPlatformTransferDetails :exec
INSERT INTO platform_payment_settings (
    id, transfer_recipient_name, transfer_bank_name, transfer_bank_account,
    transfer_dana_number, transfer_gopay_number, updated_at
) VALUES (true, $1, $2, $3, $4, $5, now())
ON CONFLICT (id) DO UPDATE SET
    transfer_recipient_name = EXCLUDED.transfer_recipient_name,
    transfer_bank_name = EXCLUDED.transfer_bank_name,
    transfer_bank_account = EXCLUDED.transfer_bank_account,
    transfer_dana_number = EXCLUDED.transfer_dana_number,
    transfer_gopay_number = EXCLUDED.transfer_gopay_number,
    updated_at = now();

-- name: SetPlatformManualQRIS :exec
INSERT INTO platform_payment_settings (
    id, manual_qris_image, manual_qris_content_type, manual_qris_updated_at, updated_at
) VALUES (true, $1, $2, now(), now())
ON CONFLICT (id) DO UPDATE SET
    manual_qris_image = EXCLUDED.manual_qris_image,
    manual_qris_content_type = EXCLUDED.manual_qris_content_type,
    manual_qris_updated_at = now(),
    updated_at = now();

-- name: ClearPlatformManualQRIS :exec
UPDATE platform_payment_settings
SET manual_qris_image = NULL, manual_qris_content_type = NULL,
    manual_qris_updated_at = NULL, updated_at = now()
WHERE id = true;
