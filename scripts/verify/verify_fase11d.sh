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

free_session_date() {
  local candidate outlet has_session
  while true; do
    candidate="$(date -d "+$((RANDOM % 300 + 20)) days" +%F)"
    has_session=false
    for outlet in 3ae1bd6e-fb87-4963-9ef4-d93e998e03c6 681b1eae-8d76-4b0f-8a47-3edbfb0a5626 70ad4ca4-2c1e-497b-ba4c-25479a42ed0c; do
      if curl -fsS -b cookiesB.txt "$API_BASE/v1/tenants/$TENANT_B/outlets/$outlet/queue-sessions" \
        | jq -e --arg date "$candidate" 'any(.[]; .session_date == $date)' >/dev/null; then
        has_session=true
        break
      fi
    done
    if [ "$has_session" = false ]; then
      echo "$candidate"
      return
    fi
  done
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
check_code "kapster tidak boleh mengundang staf" "bukan_owner" "$(invite_probe cookiesKapsterB.txt)"
check_code "pelanggan tidak boleh mengundang staf" "bukan_owner" "$(invite_probe cookiesPembeli2.txt)"
check_code "orang luar tidak boleh mengundang staf" "bukan_owner" "$(invite_probe cookiesPembeli.txt)"
STAFF_EMAIL="staff-dto-$RANDOM-$$@example.test"
curl -fsS -b cookiesB.txt -X POST "$API_BASE/v1/tenants/$TENANT_B/staff" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$STAFF_EMAIL\",\"password\":\"password-uji-lokal\",\"roles\":[\"kapster\"],\"outlet_ids\":[\"3ae1bd6e-fb87-4963-9ef4-d93e998e03c6\"]}" -o "$TMP"
check_code "respons undang staf tidak mengirim ID internal user" "OK" "$(jq -r 'if has("user_id") or has("tenant_id") then "BOCOR" else "OK" end' "$TMP")"
curl -fsS -b cookiesB.txt "$API_BASE/v1/tenants/$TENANT_B/staff" -o "$TMP"
check_code "daftar staf tidak mengirim ID internal user" "OK" "$(jq -r 'if any(.[]; has("user_id") or has("tenant_id")) then "BOCOR" else "OK" end' "$TMP")"

SESSION_DATE="$(free_session_date)"
for role_action in outlets settings subscribe; do
  case "$role_action" in
    outlets)
      curl -sS -b cookiesAdminB.txt -X POST "$API_BASE/v1/tenants/$TENANT_B/outlets" \
        -H 'Content-Type: application/json' -d '{"name":"Uji outlet role","timezone":"Asia/Jakarta"}' -o "$TMP"
      ;;
    settings)
      curl -sS -b cookiesAdminB.txt -X PATCH "$API_BASE/v1/tenants/$TENANT_B/outlets/3ae1bd6e-fb87-4963-9ef4-d93e998e03c6/settings" \
        -H 'Content-Type: application/json' -d '{"dp_price_rupiah":15000,"default_duration_minutes":25}' -o "$TMP"
      ;;
    subscribe)
      curl -sS -b cookiesAdminB.txt -X POST "$API_BASE/v1/tenants/$TENANT_B/subscribe" \
        -H 'Content-Type: application/json' -d '{"plan_code":""}' -o "$TMP"
      ;;
  esac
  check_code "admin tidak boleh mengubah $role_action tenant" "bukan_owner" "$(jq -r '.error.code // "OK"' "$TMP")"
done
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

ADMIN_SESSION_CODE="$(curl -sS -b cookiesAdminB.txt -X POST "$API_BASE/v1/tenants/$TENANT_B/outlets/681b1eae-8d76-4b0f-8a47-3edbfb0a5626/queue-sessions" \
  -H 'Content-Type: application/json' -d "{\"session_date\":\"$SESSION_DATE\",\"max_quota\":5}" -o "$TMP" -w '%{http_code}')"
check_code "admin bisa membuka sesi di outlet penugasannya" "201" "$ADMIN_SESSION_CODE"
ADMIN_SESSION_ID="$(jq -er '.id' "$TMP")"
ADMIN_QUOTA_CODE="$(curl -sS -b cookiesAdminB.txt -X POST "$API_BASE/v1/tenants/$TENANT_B/queue-sessions/$ADMIN_SESSION_ID/increase-quota" \
  -H 'Content-Type: application/json' -d '{"by":1}' -o "$TMP" -w '%{http_code}')"
check_code "admin bisa menambah kuota di outlet penugasannya" "200" "$ADMIN_QUOTA_CODE"
ADMIN_TICKET_CODE="$(curl -sS -b cookiesAdminB.txt -X POST "$API_BASE/v1/tenants/$TENANT_B/queue-sessions/$ADMIN_SESSION_ID/tickets" \
  -H 'Content-Type: application/json' -d '{"customer_name":"Tes izin admin"}' -o "$TMP" -w '%{http_code}')"
check_code "admin bisa menambah tiket di outlet penugasannya" "201" "$ADMIN_TICKET_CODE"

KAPSTER_SESSION_CODE="$(curl -sS -b cookiesB.txt -X POST "$API_BASE/v1/tenants/$TENANT_B/outlets/70ad4ca4-2c1e-497b-ba4c-25479a42ed0c/queue-sessions" \
  -H 'Content-Type: application/json' -d "{\"session_date\":\"$SESSION_DATE\",\"max_quota\":5}" -o "$TMP" -w '%{http_code}')"
check_code "owner bisa membuka sesi untuk penugasan kapster" "201" "$KAPSTER_SESSION_CODE"
KAPSTER_SESSION_ID="$(jq -er '.id' "$TMP")"
curl -fsS -b cookiesB.txt -X POST "$API_BASE/v1/tenants/$TENANT_B/queue-sessions/$KAPSTER_SESSION_ID/tickets" \
  -H 'Content-Type: application/json' -d '{"customer_name":"Tes izin kapster"}' -o "$TMP"
for cookie in cookiesPembeli2.txt cookiesPembeli.txt; do
  curl -sS -b "$cookie" -X POST "$API_BASE/v1/tenants/$TENANT_B/queue-sessions/$KAPSTER_SESSION_ID/tickets" \
    -H 'Content-Type: application/json' -d '{"customer_name":"Harus ditolak"}' -o "$TMP"
  check_code "pelanggan atau orang luar tidak bisa menambah tiket ($cookie)" "bukan_anggota_tenant" "$(jq -r '.error.code // "OK"' "$TMP")"
done
for action in increase-quota tickets; do
  curl -sS -b cookiesKapsterB.txt -X POST "$API_BASE/v1/tenants/$TENANT_B/queue-sessions/$KAPSTER_SESSION_ID/$action" \
    -H 'Content-Type: application/json' -d '{"by":1,"customer_name":"Harus ditolak"}' -o "$TMP"
  check_code "kapster tidak punya hak admin untuk $action" "bukan_admin_tenant" "$(jq -r '.error.code // "OK"' "$TMP")"
done
KAPSTER_READY_CODE="$(curl -sS -b cookiesKapsterB.txt -X POST "$API_BASE/v1/tenants/$TENANT_B/queue-sessions/$KAPSTER_SESSION_ID/ready" -o "$TMP" -w '%{http_code}')"
check_code "kapster bisa memanggil tiket di outlet penugasannya" "200" "$KAPSTER_READY_CODE"
check_code "kapster memanggil tiket yang benar" "1" "$(jq -r '.ticket_number // 0' "$TMP")"

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
