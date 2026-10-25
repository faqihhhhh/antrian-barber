#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

API_BASE="${API_BASE:-http://localhost:8080}"
: "${TENANT_ID:?Set TENANT_ID to an active test tenant}"
: "${OUTLET_ID:?Set OUTLET_ID to an outlet assigned to the kapster}"
: "${ADMIN_COOKIE_JAR:?Set ADMIN_COOKIE_JAR to an admin cookie jar}"
: "${KAPSTER_COOKIE_JAR:?Set KAPSTER_COOKIE_JAR to a kapster cookie jar}"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
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

SESSION_DATE=""
while true; do
  SESSION_DATE="$(date -d "+$((RANDOM % 220 + 30)) days" +%F)"
  if ! curl -fsS -b "$ADMIN_COOKIE_JAR" \
    "$API_BASE/v1/tenants/$TENANT_ID/outlets/$OUTLET_ID/queue-sessions" \
    | jq -e --arg date "$SESSION_DATE" 'any(.[]; .session_date == $date)' >/dev/null; then
    break
  fi
done
SESSION_ID="$(curl -fsS -b "$ADMIN_COOKIE_JAR" -X POST \
  "$API_BASE/v1/tenants/$TENANT_ID/outlets/$OUTLET_ID/queue-sessions" \
  -H 'Content-Type: application/json' \
  -d "{\"session_date\":\"$SESSION_DATE\",\"max_quota\":3}" | jq -er '.id')"
KAPSTER_MEMBERSHIP_ID="$(curl -fsS -b "$KAPSTER_COOKIE_JAR" "$API_BASE/v1/me" | \
  jq -er --arg tenant "$TENANT_ID" '[.memberships[] | select(.tenant_id == $tenant and (.roles | index("kapster"))) | .membership_id][0]')"

post_kapster() {
  curl -sS -b "$KAPSTER_COOKIE_JAR" -X POST \
    "$API_BASE/v1/tenants/$TENANT_ID/queue-sessions/$SESSION_ID/$1" \
    -o "$TMP_DIR/response.json" -w '%{http_code}'
}

READY_CODE="$(post_kapster ready)"
check "kapster siap saat antrean kosong" "200" "$READY_CODE"
check "status setelah siap" "ready" "$(curl -fsS -b "$KAPSTER_COOKIE_JAR" "$API_BASE/v1/tenants/$TENANT_ID/queue-sessions/$SESSION_ID/kapster-states" | jq -er --arg id "$KAPSTER_MEMBERSHIP_ID" '.[] | select(.membership_id == $id) | .status')"

PAUSE_CODE="$(post_kapster pause)"
check "kapster dapat berhenti sementara" "200" "$PAUSE_CODE"
check "status setelah berhenti sementara" "idle" "$(curl -fsS -b "$KAPSTER_COOKIE_JAR" "$API_BASE/v1/tenants/$TENANT_ID/queue-sessions/$SESSION_ID/kapster-states" | jq -er --arg id "$KAPSTER_MEMBERSHIP_ID" '.[] | select(.membership_id == $id) | .status')"

curl -fsS -b "$ADMIN_COOKIE_JAR" -X POST \
  "$API_BASE/v1/tenants/$TENANT_ID/queue-sessions/$SESSION_ID/tickets" \
  -H 'Content-Type: application/json' -d '{"customer_name":"Pelanggan saat kapster jeda"}' >/dev/null
READY_CODE="$(post_kapster ready)"
check "kapster kembali siap lalu memanggil pelanggan" "200" "$READY_CODE"
check "tiket baru dipanggil" "called" "$(jq -er '.status' "$TMP_DIR/response.json")"
PAUSE_CODE="$(post_kapster pause)"
check "kapster tidak bisa berhenti saat pelanggan aktif" "409" "$PAUSE_CODE"
check "pelanggan aktif tetap ditangani" "busy" "$(curl -fsS -b "$KAPSTER_COOKIE_JAR" "$API_BASE/v1/tenants/$TENANT_ID/queue-sessions/$SESSION_ID/kapster-states" | jq -er --arg id "$KAPSTER_MEMBERSHIP_ID" '.[] | select(.membership_id == $id) | .status')"

START_CODE="$(post_kapster start)"
check "kapster dapat memulai pelanggan yang dipanggil" "200" "$START_CODE"
COMPLETE_CODE="$(post_kapster complete)"
check "kapster dapat menyelesaikan pelanggan" "200" "$COMPLETE_CODE"
READY_CODE="$(post_kapster ready)"
check "kapster kembali siap saat antrean kosong" "200" "$READY_CODE"
CLOSE_CODE="$(curl -sS -b "$ADMIN_COOKIE_JAR" -X POST \
  "$API_BASE/v1/tenants/$TENANT_ID/queue-sessions/$SESSION_ID/close" \
  -o "$TMP_DIR/response.json" -w '%{http_code}')"
check "sesi dapat ditutup" "200" "$CLOSE_CODE"
check "penutupan sesi mengakhiri status siap" "idle" "$(curl -fsS -b "$KAPSTER_COOKIE_JAR" "$API_BASE/v1/tenants/$TENANT_ID/queue-sessions/$SESSION_ID/kapster-states" | jq -er --arg id "$KAPSTER_MEMBERSHIP_ID" '.[] | select(.membership_id == $id) | .status')"

echo
echo "Sesi uji: $SESSION_ID ($SESSION_DATE). Data sesi uji dibiarkan di database."
echo "Selesai: $FAILS pemeriksaan gagal."
exit "$FAILS"
