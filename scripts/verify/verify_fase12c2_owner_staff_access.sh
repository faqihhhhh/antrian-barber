#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:8080}"
TENANT_ID="3159e203-02c0-49b0-8fe5-1e94ebbae2e1"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
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

OWNER_STATUS="$(curl -sS -b cookiesB.txt "$API_BASE/v1/tenants/$TENANT_ID/staff" -o "$TMP" -w '%{http_code}')"
check "owner dapat melihat daftar staf" "200" "$OWNER_STATUS"
check "respons staf hanya berisi DTO aman" "true" "$(jq -e 'type == "array" and all(.[]; has("membership_id") and has("email") and has("roles") and has("email_verified") and has("outlet_ids") and ((keys - ["membership_id", "email", "roles", "email_verified", "outlet_ids"]) | length) == 0)' "$TMP" >/dev/null && echo true || echo false)"

ADMIN_STATUS="$(curl -sS -b cookiesAdminB.txt "$API_BASE/v1/tenants/$TENANT_ID/staff" -o "$TMP" -w '%{http_code}')"
check "admin tidak boleh melihat daftar staf owner" "403" "$ADMIN_STATUS"

echo
echo "Selesai: $FAILS pemeriksaan gagal."
exit "$FAILS"
