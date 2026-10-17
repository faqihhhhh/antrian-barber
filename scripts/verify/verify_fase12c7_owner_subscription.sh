#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:8080}"
TENANT_ID="3159e203-02c0-49b0-8fe5-1e94ebbae2e1"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
FAILS=0

check() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then echo "PASS  $label"
  else FAILS=$((FAILS + 1)); echo "FAIL  $label: diharapkan $expected, didapat $actual"; fi
}

for resource in subscription invoices; do
  OWNER_CODE="$(curl -sS -b cookiesB.txt "$API_BASE/v1/tenants/$TENANT_ID/$resource" -o "$TMP" -w '%{http_code}')"
  check "owner dapat membaca $resource" "200" "$OWNER_CODE"
  if [ "$resource" = subscription ]; then
    check "status langganan memakai DTO aman" "true" "$(jq -e 'type == "object" and has("status") and (has("tenant_id") | not)' "$TMP" >/dev/null && echo true || echo false)"
  else
    check "riwayat tagihan tidak membocorkan kolom internal" "true" "$(jq -e 'type == "array" and all(.[]; has("period_start") and has("period_end") and ((has("tenant_id") or has("plan_id") or has("confirmed_by")) | not))' "$TMP" >/dev/null && echo true || echo false)"
  fi
  ADMIN_CODE="$(curl -sS -b cookiesAdminB.txt "$API_BASE/v1/tenants/$TENANT_ID/$resource" -o "$TMP" -w '%{http_code}')"
  check "admin ditolak dari $resource" "403" "$ADMIN_CODE"
done

CREATE_CODE="$(curl -sS -b cookiesB.txt -X POST "$API_BASE/v1/tenants/$TENANT_ID/subscribe" \
  -H 'Content-Type: application/json' -d '{"plan_code":"starter_monthly"}' -o "$TMP" -w '%{http_code}')"
check "owner tidak membuat tagihan di luar jendela perpanjangan" "409" "$CREATE_CODE"
ERROR_CODE="$(jq -r '.error.code // ""' "$TMP")"
if [ "$ERROR_CODE" = "tagihan_masih_pending" ] || [ "$ERROR_CODE" = "langganan_masih_aktif" ]; then
  check "tagihan baru ditolak dengan alasan yang jelas" "true" "true"
else
  check "tagihan baru ditolak dengan alasan yang jelas" "false" "true"
fi

echo
echo "Selesai: $FAILS pemeriksaan gagal."
exit "$FAILS"
