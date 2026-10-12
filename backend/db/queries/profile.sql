-- name: GetTenantProfile :one
SELECT tenant_id, midtrans_server_key_encrypted, midtrans_client_key_encrypted, midtrans_is_production,
       midtrans_configured_at, onboarding_completed_at, manual_qris_updated_at
FROM tenant_profiles WHERE tenant_id = $1;

-- name: SetManualQRIS :exec
INSERT INTO tenant_profiles (tenant_id, manual_qris_image, manual_qris_content_type, manual_qris_updated_at)
VALUES ($1, $2, $3, now())
ON CONFLICT (tenant_id) DO UPDATE SET
  manual_qris_image = EXCLUDED.manual_qris_image,
  manual_qris_content_type = EXCLUDED.manual_qris_content_type,
  manual_qris_updated_at = now(),
  updated_at = now();

-- name: GetManualQRIS :one
SELECT manual_qris_image, manual_qris_content_type FROM tenant_profiles WHERE tenant_id = $1;

-- name: UpsertTenantProfileMidtrans :exec
INSERT INTO tenant_profiles (tenant_id, midtrans_server_key_encrypted, midtrans_client_key_encrypted, midtrans_is_production, midtrans_configured_at, onboarding_completed_at)
VALUES ($1, $2, $3, $4, now(), now())
ON CONFLICT (tenant_id) DO UPDATE SET
  midtrans_server_key_encrypted = EXCLUDED.midtrans_server_key_encrypted,
  midtrans_client_key_encrypted = EXCLUDED.midtrans_client_key_encrypted,
  midtrans_is_production = EXCLUDED.midtrans_is_production,
  midtrans_configured_at = now(),
  onboarding_completed_at = now(),
  updated_at = now();

-- name: MarkOnboardingSkippedMidtrans :exec
INSERT INTO tenant_profiles (tenant_id, onboarding_completed_at)
VALUES ($1, now())
ON CONFLICT (tenant_id) DO UPDATE SET onboarding_completed_at = now(), updated_at = now();