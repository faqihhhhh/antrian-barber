#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

API_BASE="${API_BASE:-http://localhost:8080}"
TENANT_A="50871685-cdc1-47a7-bf8f-f2bcf45d731a"
TENANT_B="3159e203-02c0-49b0-8fe5-1e94ebbae2e1"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
FAILS=0

check_code() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "PASS  $label"
  else
    FAILS=$((FAILS + 1))
    echo "FAIL  $label: diharapkan $expected, didapat $actual"
  fi
}

OWNER_EMAIL="$(curl -fsS -b cookiesB.txt "$API_BASE/v1/me" | jq -er '.user.email')"
FOREIGN_OUTLET="$(curl -fsS -b cookies.txt "$API_BASE/v1/tenants/$TENANT_A/outlets" | jq -er '.[0].id')"

invite_probe() {
  local cookie="$1"
  curl -sS -b "$cookie" -X POST "$API_BASE/v1/tenants/$TENANT_B/staff" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$OWNER_EMAIL\",\"password\":\"password-uji-lokal\",\"roles\":[\"kapster\"],\"outlet_ids\":[\"$FOREIGN_OUTLET\"]}" \
    -o "$TMP"
  jq -er '.error.code' "$TMP"
}

check_code "owner menolak outlet milik tenant lain" "outlet_tidak_valid" "$(invite_probe cookiesB.txt)"
check_code "admin tidak boleh mengundang staf" "bukan_owner" "$(invite_probe cookiesAdminB.txt)"
STAFF_EMAIL="staff-dto-$RANDOM-$$@example.test"
curl -fsS -b cookiesB.txt -X POST "$API_BASE/v1/tenants/$TENANT_B/staff" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$STAFF_EMAIL\",\"password\":\"password-uji-lokal\",\"roles\":[\"kapster\"],\"outlet_ids\":[\"3ae1bd6e-fb87-4963-9ef4-d93e998e03c6\"]}" -o "$TMP"
check_code "respons undang staf tidak mengirim ID internal user" "OK" "$(jq -r 'if has("user_id") or has("tenant_id") then "BOCOR" else "OK" end' "$TMP")"
curl -fsS -b cookiesB.txt "$API_BASE/v1/tenants/$TENANT_B/staff" -o "$TMP"
check_code "daftar staf tidak mengirim ID internal user" "OK" "$(jq -r 'if any(.[]; has("user_id") or has("tenant_id")) then "BOCOR" else "OK" end' "$TMP")"

SESSION_DATE="$(date -d "+$((RANDOM % 300 + 20)) days" +%F)"
curl -sS -b cookiesAdminB.txt -X POST "$API_BASE/v1/tenants/$TENANT_B/outlets/3ae1bd6e-fb87-4963-9ef4-d93e998e03c6/queue-sessions" \
  -H 'Content-Type: application/json' \
  -d "{\"session_date\":\"$SESSION_DATE\",\"max_quota\":5}" \
  -o "$TMP"
check_code "admin tidak boleh membuka sesi outlet yang tidak ditugaskan" "outlet_tidak_ditugaskan" "$(jq -r '.error.code // "OK"' "$TMP")"

curl -fsS -b cookiesB.txt -X POST "$API_BASE/v1/tenants/$TENANT_B/outlets/3ae1bd6e-fb87-4963-9ef4-d93e998e03c6/queue-sessions" \
  -H 'Content-Type: application/json' \
  -d "{\"session_date\":\"$SESSION_DATE\",\"max_quota\":5}" -o "$TMP"
SESSION_ID="$(jq -er '.id' "$TMP")"
check_code "respons buka sesi tidak mengirim kolom internal" "OK" "$(jq -r 'if has("tenant_id") or has("created_by") or has("next_ticket_number") then "BOCOR" else "OK" end' "$TMP")"
curl -fsS -b cookiesB.txt "$API_BASE/v1/tenants/$TENANT_B/outlets/3ae1bd6e-fb87-4963-9ef4-d93e998e03c6/queue-sessions" -o "$TMP"
check_code "daftar sesi tidak mengirim kolom internal" "OK" "$(jq -r 'if any(.[]; has("tenant_id") or has("created_by") or has("next_ticket_number")) then "BOCOR" else "OK" end' "$TMP")"
curl -fsS -b cookiesB.txt -X POST "$API_BASE/v1/tenants/$TENANT_B/queue-sessions/$SESSION_ID/tickets" \
  -H 'Content-Type: application/json' -d '{"customer_name":"Tes DTO tiket"}' -o "$TMP"
check_code "respons tambah tiket tidak mengirim kolom internal" "OK" "$(jq -r 'if has("customer_user_id") or has("tenant_id") or has("assigned_membership_id") then "BOCOR" else "OK" end' "$TMP")"
curl -fsS -b cookiesB.txt "$API_BASE/v1/tenants/$TENANT_B/queue-sessions/$SESSION_ID/tickets" -o "$TMP"
check_code "daftar tiket tidak mengirim kolom internal" "OK" "$(jq -r 'if any(.[]; has("customer_user_id") or has("tenant_id") or has("assigned_membership_id")) then "BOCOR" else "OK" end' "$TMP")"
curl -sS -b cookiesAdminB.txt -X POST "$API_BASE/v1/tenants/$TENANT_B/queue-sessions/$SESSION_ID/increase-quota" \
  -H 'Content-Type: application/json' -d '{"by":1}' -o "$TMP"
check_code "admin tidak boleh menambah kuota outlet yang tidak ditugaskan" "outlet_tidak_ditugaskan" "$(jq -r '.error.code // "OK"' "$TMP")"
curl -sS -b cookiesAdminB.txt -X POST "$API_BASE/v1/tenants/$TENANT_B/queue-sessions/$SESSION_ID/tickets" \
  -H 'Content-Type: application/json' -d '{"customer_name":"Tes penugasan outlet"}' -o "$TMP"
check_code "admin tidak boleh menambah tiket di outlet yang tidak ditugaskan" "outlet_tidak_ditugaskan" "$(jq -r '.error.code // "OK"' "$TMP")"

for action in ready start skip complete; do
  curl -sS -b cookiesKapsterB.txt -X POST "$API_BASE/v1/tenants/$TENANT_B/queue-sessions/$SESSION_ID/$action" -o "$TMP"
  check_code "kapster tidak boleh melakukan $action pada outlet yang tidak ditugaskan" "outlet_tidak_ditugaskan" "$(jq -r '.error.code // "OK"' "$TMP")"
done

echo
echo "Selesai: $FAILS pemeriksaan gagal."
exit "$FAILS"
