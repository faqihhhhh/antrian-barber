#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:8080}"
TENANT_ID="3159e203-02c0-49b0-8fe5-1e94ebbae2e1"
OUTLET_ID="70ad4ca4-2c1e-497b-ba4c-25479a42ed0c"
TMP="$(mktemp)"
ORIGINAL=""
UPDATED=false
trap 'if [ "$UPDATED" = true ] && [ -n "$ORIGINAL" ]; then curl -fsS -b cookiesB.txt -X PATCH "$API_BASE/v1/tenants/$TENANT_ID/outlets/$OUTLET_ID/settings" -H '\''Content-Type: application/json'\'' -d "$ORIGINAL" >/dev/null || true; fi; rm -f "$TMP"' EXIT
FAILS=0

check() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "PASS  $label"
  else
    FAILS=$((FAILS + 1))
    echo "FAIL  $label: diharapkan $expected, didapat $actual"
  fi
}

curl -fsS -b cookiesB.txt "$API_BASE/v1/tenants/$TENANT_ID/outlets" -o "$TMP"
check "owner dapat melihat daftar outlet" "true" "$(jq -r --arg id "$OUTLET_ID" 'any(.[]; .id == $id)' "$TMP")"
check "respons outlet tidak membocorkan kolom database" "false" "$(jq -r 'any(.[]; has("tenant_id") or has("created_at") or has("updated_at"))' "$TMP")"

ORIGINAL="$(jq -c --arg id "$OUTLET_ID" '[.[] | select(.id == $id)][0] | {dp_price_rupiah, default_duration_minutes}' "$TMP")"
TEST_DP="$(jq -r '.dp_price_rupiah + 1' <<<"$ORIGINAL")"
TEST_DURATION="$(jq -r '.default_duration_minutes + 1' <<<"$ORIGINAL")"
PAYLOAD="{\"dp_price_rupiah\":$TEST_DP,\"default_duration_minutes\":$TEST_DURATION}"

OWNER_PATCH_STATUS="$(curl -sS -b cookiesB.txt -X PATCH "$API_BASE/v1/tenants/$TENANT_ID/outlets/$OUTLET_ID/settings" -H 'Content-Type: application/json' -d "$PAYLOAD" -o "$TMP" -w '%{http_code}')"
check "owner dapat mengubah pengaturan outlet" "200" "$OWNER_PATCH_STATUS"
UPDATED=true
check "harga DP dan durasi tersimpan" "true" "$(jq -e --argjson price "$TEST_DP" --argjson duration "$TEST_DURATION" '.dp_price_rupiah == $price and .default_duration_minutes == $duration' "$TMP" >/dev/null && echo true || echo false)"

ADMIN_PATCH_STATUS="$(curl -sS -b cookiesAdminB.txt -X PATCH "$API_BASE/v1/tenants/$TENANT_ID/outlets/$OUTLET_ID/settings" -H 'Content-Type: application/json' -d "$PAYLOAD" -o "$TMP" -w '%{http_code}')"
check "admin tidak boleh mengubah pengaturan owner" "403" "$ADMIN_PATCH_STATUS"

INVALID_PATCH_STATUS="$(curl -sS -b cookiesB.txt -X PATCH "$API_BASE/v1/tenants/$TENANT_ID/outlets/$OUTLET_ID/settings" -H 'Content-Type: application/json' -d '{"dp_price_rupiah":-1,"default_duration_minutes":0}' -o "$TMP" -w '%{http_code}')"
check "harga negatif dan durasi nol ditolak" "400" "$INVALID_PATCH_STATUS"

curl -fsS -b cookiesB.txt -X PATCH "$API_BASE/v1/tenants/$TENANT_ID/outlets/$OUTLET_ID/settings" -H 'Content-Type: application/json' -d "$ORIGINAL" >/dev/null
UPDATED=false

echo
echo "Selesai: $FAILS pemeriksaan gagal."
exit "$FAILS"
