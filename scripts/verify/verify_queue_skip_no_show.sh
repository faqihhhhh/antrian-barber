#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

API_BASE="${API_BASE:-http://localhost:8080}"
: "${TENANT_ID:?Set TENANT_ID to a test tenant with an active subscription}"
: "${OUTLET_ID:?Set OUTLET_ID to an outlet assigned to the kapster}"
: "${ADMIN_COOKIE_JAR:?Set ADMIN_COOKIE_JAR to a fresh admin cookie jar}"
: "${KAPSTER_COOKIE_JAR:?Set KAPSTER_COOKIE_JAR to a fresh kapster cookie jar}"

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

free_date() {
  local candidate
  while true; do
    candidate="$(date -d "+$((RANDOM % 250 + 20)) days" +%F)"
    if ! curl -fsS -b "$ADMIN_COOKIE_JAR" \
      "$API_BASE/v1/tenants/$TENANT_ID/outlets/$OUTLET_ID/queue-sessions" \
      | jq -e --arg date "$candidate" 'any(.[]; .session_date == $date)' >/dev/null; then
      echo "$candidate"
      return
    fi
  done
}

SESSION_DATE="$(free_date)"
SESSION_ID="$(curl -fsS -b "$ADMIN_COOKIE_JAR" -X POST \
  "$API_BASE/v1/tenants/$TENANT_ID/outlets/$OUTLET_ID/queue-sessions" \
  -H 'Content-Type: application/json' \
  -d "{\"session_date\":\"$SESSION_DATE\",\"max_quota\":3}" \
  | jq -er '.id')"

TICKET_IDS=()
for name in "Tidak hadir satu" "Tidak hadir dua" "Pelanggan tiga"; do
  response="$(curl -fsS -b "$ADMIN_COOKIE_JAR" -X POST \
    "$API_BASE/v1/tenants/$TENANT_ID/queue-sessions/$SESSION_ID/tickets" \
    -H 'Content-Type: application/json' -d "{\"customer_name\":\"$name\"}")"
  TICKET_IDS+=("$(jq -er '.id' <<<"$response")")
done

post_kapster() {
  curl -fsS -b "$KAPSTER_COOKIE_JAR" -X POST \
    "$API_BASE/v1/tenants/$TENANT_ID/queue-sessions/$SESSION_ID/$1" \
    -o "$TMP_DIR/response.json"
}

post_kapster ready
check "kapster memanggil pelanggan pertama" "1" "$(jq -r '.ticket_number' "$TMP_DIR/response.json")"
post_kapster skip
check "skip pertama memanggil pelanggan kedua" "2" "$(jq -r '.ticket_number' "$TMP_DIR/response.json")"
post_kapster skip
check "skip kedua melewati dua no-show dan memanggil pelanggan ketiga" "3" "$(jq -r '.ticket_number' "$TMP_DIR/response.json")"

QUEUE_TICKETS="$(curl -fsS -b "$KAPSTER_COOKIE_JAR" "$API_BASE/v1/tenants/$TENANT_ID/queue-sessions/$SESSION_ID/tickets")"
for index in 0 1; do
  check "tiket yang dilewati tercatat pernah dipanggil: #$((index + 1))" "true" "$(jq -er --arg id "${TICKET_IDS[$index]}" '.[] | select(.id == $id) | .has_been_called' <<<"$QUEUE_TICKETS")"
done

TICKET_STATE="$(docker compose exec -T db psql -U kapsflow -d kapsflow -At -v ON_ERROR_STOP=1 -c \
  "SELECT string_agg(ticket_number::text || ':' || status, ',' ORDER BY ticket_number) FROM tickets WHERE id IN ('${TICKET_IDS[0]}','${TICKET_IDS[1]}','${TICKET_IDS[2]}')")"
check "dua tiket yang dilewati kembali menunggu" "1:waiting,2:waiting,3:called" "$TICKET_STATE"

QUEUE_ORDER="$(docker compose exec -T db psql -U kapsflow -d kapsflow -At -v ON_ERROR_STOP=1 -c \
  "SELECT string_agg(ticket_number::text, ',' ORDER BY queue_position) FROM tickets WHERE queue_session_id = '$SESSION_ID' AND status = 'waiting'")"
check "tiket yang dilewati dipindah ke belakang antrean" "1,2" "$QUEUE_ORDER"

echo
echo "Sesi uji: $SESSION_ID ($SESSION_DATE). Data tiket dibiarkan sebagai data uji."
echo "Selesai: $FAILS pemeriksaan gagal."
exit "$FAILS"
