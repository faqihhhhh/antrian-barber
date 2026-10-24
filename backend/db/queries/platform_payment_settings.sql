-- name: GetPlatformPaymentSettings :one
SELECT manual_qris_image, manual_qris_content_type, manual_qris_updated_at
FROM platform_payment_settings WHERE id = true;

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
