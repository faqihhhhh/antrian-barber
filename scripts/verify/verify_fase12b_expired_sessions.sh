#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

API_BASE="${API_BASE:-http://localhost:8080}"
TENANT_ID="3159e203-02c0-49b0-8fe5-1e94ebbae2e1"
OUTLET_ID="70ad4ca4-2c1e-497b-ba4c-25479a42ed0c"
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

free_date() {
  local offset="$1" direction="$2" candidate
  while true; do
    local days=$((RANDOM % 250 + offset))
    if [ "$direction" = "past" ]; then
      candidate="$(date -d "-$days days" +%F)"
    else
      candidate="$(date -d "+$days days" +%F)"
    fi
    if ! curl -fsS -b cookiesB.txt \
      "$API_BASE/v1/tenants/$TENANT_ID/outlets/$OUTLET_ID/queue-sessions" \
      | jq -e --arg date "$candidate" 'any(.[]; .session_date == $date)' >/dev/null; then
      echo "$candidate"
      return
    fi
  done
}

PAST_DATE="$(free_date 10 past)"
PAST_CREATE_STATUS="$(curl -sS -b cookiesB.txt -X POST \
  "$API_BASE/v1/tenants/$TENANT_ID/outlets/$OUTLET_ID/queue-sessions" \
  -H 'Content-Type: application/json' \
  -d "{\"session_date\":\"$PAST_DATE\",\"max_quota\":5}" \
  -o "$TMP" -w '%{http_code}')"
check "owner tidak bisa membuka sesi untuk tanggal yang lewat" "400" "$PAST_CREATE_STATUS"
check "kode error tanggal sesi lewat" "tanggal_sudah_lewat" "$(jq -r '.error.code // ""' "$TMP")"

FUTURE_DATE="$(free_date 20 future)"
SESSION_ID="$(curl -fsS -b cookiesB.txt -X POST \
  "$API_BASE/v1/tenants/$TENANT_ID/outlets/$OUTLET_ID/queue-sessions" \
  -H 'Content-Type: application/json' \
  -d "{\"session_date\":\"$FUTURE_DATE\",\"max_quota\":5}" \
  | jq -er '.id')"
curl -fsS -b cookiesB.txt -X POST \
  "$API_BASE/v1/tenants/$TENANT_ID/queue-sessions/$SESSION_ID/tickets" \
  -H 'Content-Type: application/json' \
  -d '{"customer_name":"Tes antrean sesi lewat"}' -o "$TMP"

docker compose exec -T db psql -U kapsflow -d kapsflow -v ON_ERROR_STOP=1 -c \
  "UPDATE queue_sessions SET session_date = '$PAST_DATE' WHERE id = '$SESSION_ID'" >/dev/null

SESSION_STATUS="open"
for _ in $(seq 1 90); do
  SESSION_STATUS="$(curl -fsS -b cookiesB.txt \
    "$API_BASE/v1/tenants/$TENANT_ID/outlets/$OUTLET_ID/queue-sessions" \
    | jq -er --arg id "$SESSION_ID" '.[] | select(.id == $id) | .status')"
  [ "$SESSION_STATUS" = "closed" ] && break
  sleep 1
done
check "job menutup sesi setelah tanggal lokal outlet lewat" "closed" "$SESSION_STATUS"

ADD_CLOSED_STATUS="$(curl -sS -b cookiesB.txt -X POST \
  "$API_BASE/v1/tenants/$TENANT_ID/queue-sessions/$SESSION_ID/tickets" \
  -H 'Content-Type: application/json' -d '{"customer_name":"Tidak boleh masuk"}' \
  -o "$TMP" -w '%{http_code}')"
check "tiket offline baru ditolak pada sesi tertutup" "409" "$ADD_CLOSED_STATUS"
check "kode error tiket sesi tertutup" "sesi_sudah_ditutup" "$(jq -r '.error.code // ""' "$TMP")"

QUOTA_CLOSED_STATUS="$(curl -sS -b cookiesB.txt -X POST \
  "$API_BASE/v1/tenants/$TENANT_ID/queue-sessions/$SESSION_ID/increase-quota" \
  -H 'Content-Type: application/json' -d '{"by":1}' \
  -o "$TMP" -w '%{http_code}')"
check "kuota tidak bisa ditambah pada sesi tertutup" "409" "$QUOTA_CLOSED_STATUS"

READY_STATUS="$(curl -sS -b cookiesKapsterB.txt -X POST \
  "$API_BASE/v1/tenants/$TENANT_ID/queue-sessions/$SESSION_ID/ready" \
  -o "$TMP" -w '%{http_code}')"
check "kapster tetap bisa memanggil tiket yang tersisa" "200" "$READY_STATUS"
TICKET_ID="$(jq -er '.id' "$TMP")"
START_STATUS="$(curl -sS -b cookiesKapsterB.txt -X POST \
  "$API_BASE/v1/tenants/$TENANT_ID/queue-sessions/$SESSION_ID/start" \
  -o "$TMP" -w '%{http_code}')"
check "kapster tetap bisa memulai layanan pada sesi tertutup" "200" "$START_STATUS"
COMPLETE_STATUS="$(curl -sS -b cookiesKapsterB.txt -X POST \
  "$API_BASE/v1/tenants/$TENANT_ID/queue-sessions/$SESSION_ID/complete" \
  -o "$TMP" -w '%{http_code}')"
check "kapster tetap bisa menyelesaikan tiket sesi tertutup" "200" "$COMPLETE_STATUS"

echo
echo "Selesai: $FAILS pemeriksaan gagal."
exit "$FAILS"
