#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

API_BASE="${API_BASE:-http://localhost:8080}"
TENANT_ID="3159e203-02c0-49b0-8fe5-1e94ebbae2e1"
OUTLET_ID="681b1eae-8d76-4b0f-8a47-3edbfb0a5626"
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

free_session_date() {
  local candidate
  while true; do
    candidate="$(date -d "+$((RANDOM % 300 + 20)) days" +%F)"
    if ! curl -fsS -b cookiesAdminB.txt \
      "$API_BASE/v1/tenants/$TENANT_ID/outlets/$OUTLET_ID/queue-sessions" \
      | jq -e --arg date "$candidate" 'any(.[]; .session_date == $date)' >/dev/null; then
      echo "$candidate"
      return
    fi
  done
}

create_session() {
  local date="$1"
  curl -fsS -b cookiesAdminB.txt -X POST \
    "$API_BASE/v1/tenants/$TENANT_ID/outlets/$OUTLET_ID/queue-sessions" \
    -H 'Content-Type: application/json' \
    -d "{\"session_date\":\"$date\",\"max_quota\":5}" \
    | jq -er '.id'
}

EMPTY_SESSION_ID="$(create_session "$(free_session_date)")"
EMPTY_CLOSE_STATUS="$(curl -sS -b cookiesAdminB.txt -X POST \
  "$API_BASE/v1/tenants/$TENANT_ID/queue-sessions/$EMPTY_SESSION_ID/close" \
  -o "$TMP" -w '%{http_code}')"
check "admin menutup sesi tanpa tiket aktif" "200" "$EMPTY_CLOSE_STATUS"
check "respons sesi menunjukkan status ditutup" "closed" "$(jq -r '.status // ""' "$TMP")"

ACTIVE_SESSION_ID="$(create_session "$(free_session_date)")"
curl -fsS -b cookiesAdminB.txt -X POST \
  "$API_BASE/v1/tenants/$TENANT_ID/queue-sessions/$ACTIVE_SESSION_ID/tickets" \
  -H 'Content-Type: application/json' \
  -d '{"customer_name":"Tes tiket aktif sesi"}' -o "$TMP"
ACTIVE_CLOSE_STATUS="$(curl -sS -b cookiesAdminB.txt -X POST \
  "$API_BASE/v1/tenants/$TENANT_ID/queue-sessions/$ACTIVE_SESSION_ID/close" \
  -o "$TMP" -w '%{http_code}')"
check "sesi dengan tiket aktif ditolak" "409" "$ACTIVE_CLOSE_STATUS"
check "kode error menjelaskan tiket aktif" "tiket_belum_selesai" "$(jq -r '.error.code // ""' "$TMP")"

STATUS_AFTER_REJECTION="$(curl -fsS -b cookiesAdminB.txt \
  "$API_BASE/v1/tenants/$TENANT_ID/outlets/$OUTLET_ID/queue-sessions" \
  | jq -er --arg id "$ACTIVE_SESSION_ID" '.[] | select(.id == $id) | .status')"
check "sesi tetap terbuka setelah penolakan" "open" "$STATUS_AFTER_REJECTION"

KAPSTER_STATUS="$(curl -sS -b cookiesKapsterB.txt -X POST \
  "$API_BASE/v1/tenants/$TENANT_ID/queue-sessions/$EMPTY_SESSION_ID/close" \
  -o "$TMP" -w '%{http_code}')"
check "kapster dilarang menutup sesi" "403" "$KAPSTER_STATUS"
check "kode error menolak kapster" "bukan_admin_tenant" "$(jq -r '.error.code // ""' "$TMP")"

echo
echo "Selesai: $FAILS pemeriksaan gagal."
exit "$FAILS"
