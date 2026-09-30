-- name: GetTenantProfile :one
SELECT * FROM tenant_profiles WHERE tenant_id = $1;

-- name: UpsertTenantProfileMidtrans :exec
INSERT INTO tenant_profiles (tenant_id, midtrans_server_key_encrypted, midtrans_client_key_encrypted, midtrans_configured_at, onboarding_completed_at)
VALUES ($1, $2, $3, now(), now())
ON CONFLICT (tenant_id) DO UPDATE SET
  midtrans_server_key_encrypted = EXCLUDED.midtrans_server_key_encrypted,
  midtrans_client_key_encrypted = EXCLUDED.midtrans_client_key_encrypted,
  midtrans_configured_at = now(),
  onboarding_completed_at = now(),
  updated_at = now();

-- name: MarkOnboardingSkippedMidtrans :exec
INSERT INTO tenant_profiles (tenant_id, onboarding_completed_at)
VALUES ($1, now())
ON CONFLICT (tenant_id) DO UPDATE SET onboarding_completed_at = now(), updated_at = now();