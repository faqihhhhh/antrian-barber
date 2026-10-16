#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:8080}"
TENANT_ID="3159e203-02c0-49b0-8fe5-1e94ebbae2e1"
TMP="$(mktemp)"
trap 'rm -f "$TMP" "$TMP.response"' EXIT
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

OWNER_STATUS="$(curl -sS -b cookiesB.txt "$API_BASE/v1/tenants/$TENANT_ID/profile" -o "$TMP" -w '%{http_code}')"
check "owner dapat melihat status pembayaran" "200" "$OWNER_STATUS"
check "respons profil tidak berisi rahasia" "true" "$(jq -e 'type == "object" and (.midtrans_configured | type == "boolean") and (.manual_qris_configured | type == "boolean") and (.onboarding_completed | type == "boolean") and ((keys - ["midtrans_configured", "manual_qris_configured", "onboarding_completed"]) | length) == 0' "$TMP" >/dev/null && echo true || echo false)"

ADMIN_STATUS="$(curl -sS -b cookiesAdminB.txt "$API_BASE/v1/tenants/$TENANT_ID/profile" -o "$TMP" -w '%{http_code}')"
check "admin tidak boleh melihat pengaturan pembayaran owner" "403" "$ADMIN_STATUS"

printf 'bukan gambar QRIS' >"$TMP"
INVALID_OWNER_STATUS="$(curl -sS -b cookiesB.txt -X PUT "$API_BASE/v1/tenants/$TENANT_ID/profile/manual-qris" -H 'Content-Type: text/plain' --data-binary "@$TMP" -o "$TMP.response" -w '%{http_code}')"
check "unggahan owner menolak file yang bukan gambar" "400" "$INVALID_OWNER_STATUS"

INVALID_ADMIN_STATUS="$(curl -sS -b cookiesAdminB.txt -X PUT "$API_BASE/v1/tenants/$TENANT_ID/profile/manual-qris" -H 'Content-Type: text/plain' --data-binary "@$TMP" -o "$TMP.response" -w '%{http_code}')"
check "admin tidak boleh mengubah QRIS owner" "403" "$INVALID_ADMIN_STATUS"

ADMIN_DELETE_STATUS="$(curl -sS -b cookiesAdminB.txt -X DELETE "$API_BASE/v1/tenants/$TENANT_ID/profile/manual-qris" -o "$TMP.response" -w '%{http_code}')"
check "admin tidak boleh menghapus QRIS owner" "403" "$ADMIN_DELETE_STATUS"

echo
echo "Selesai: $FAILS pemeriksaan gagal."
exit "$FAILS"
