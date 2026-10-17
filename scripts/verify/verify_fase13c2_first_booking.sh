#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:8080}"
TENANT_ID="3159e203-02c0-49b0-8fe5-1e94ebbae2e1"
OUTLET_ID="3ae1bd6e-fb87-4963-9ef4-d93e998e03c6"
OWNER_COOKIES="cookiesB.txt"
CUSTOMER_COOKIES="cookiesPembeli.txt"
TMP_DIR="$(mktemp -d)"
SESSION_ID=""
FAILS=0

sql() {
  docker compose exec -T db psql -U kapsflow -d kapsflow -At -v ON_ERROR_STOP=1 -c "$1"
}

cleanup() {
  if [ -n "$SESSION_ID" ]; then
    sql "DELETE FROM queue_sessions WHERE id = '$SESSION_ID';" >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

check() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "PASS  $label"
  else
    FAILS=$((FAILS + 1))
    echo "FAIL  $label: diharapkan $expected, didapat $actual"
  fi
}

for cookie_file in "$OWNER_COOKIES" "$CUSTOMER_COOKIES"; do
  if [ ! -f "$cookie_file" ]; then
    echo "GAGAL: file sesi $cookie_file tidak ditemukan. Jalankan skrip dari ~/kapsflow."
    exit 2
  fi
done

curl -fsS "$API_BASE/healthz" >/dev/null
curl -fsS -b "$OWNER_COOKIES" "$API_BASE/v1/me" >"$TMP_DIR/owner.json"
check "akun uji adalah owner tenant aktif" "true" \
  "$(jq -e --arg tenant "$TENANT_ID" '[.memberships[] | select(.tenant_id == $tenant and ((.roles | index("owner")) != null)) | .subscription_status] | any(. == "aktif" or . == "masa_tenggang")' "$TMP_DIR/owner.json" >/dev/null && echo true || echo false)"

curl -fsS -b "$OWNER_COOKIES" \
  "$API_BASE/v1/tenants/$TENANT_ID/outlets/$OUTLET_ID/queue-sessions" >"$TMP_DIR/sessions.json"
OFFSET="$(shuf -i 20-320 -n 1)"
for attempt in $(seq 0 300); do
  SESSION_DATE="$(TZ=Asia/Jakarta date -d "+$((OFFSET + attempt)) days" +%F)"
  if ! jq -e --arg date "$SESSION_DATE" 'any(.[]; .session_date == $date)' "$TMP_DIR/sessions.json" >/dev/null; then
    break
  fi
done

HTTP_CODE="$(curl -sS -b "$OWNER_COOKIES" -X POST \
  "$API_BASE/v1/tenants/$TENANT_ID/outlets/$OUTLET_ID/queue-sessions" \
  -H 'Content-Type: application/json' \
  -d "{\"session_date\":\"$SESSION_DATE\",\"max_quota\":2}" \
  -o "$TMP_DIR/session.json" -w '%{http_code}')"
check "owner membuka sesi untuk tanggal kosong" "201" "$HTTP_CODE"
if [ "$HTTP_CODE" != "201" ]; then
  cat "$TMP_DIR/session.json"
  exit 1
fi
SESSION_ID="$(jq -er '.id' "$TMP_DIR/session.json")"

HTTP_CODE="$(curl -sS -b "$CUSTOMER_COOKIES" -X POST \
  "$API_BASE/v1/tenants/$TENANT_ID/outlets/$OUTLET_ID/book" \
  -H 'Content-Type: application/json' \
  -d "{\"session_date\":\"$SESSION_DATE\",\"customer_name\":\"Uji Tiket Pertama\"}" \
  -o "$TMP_DIR/booking.json" -w '%{http_code}')"
check "pelanggan membuat pesanan DP untuk sesi baru" "201" "$HTTP_CODE"
if [ "$HTTP_CODE" != "201" ]; then
  cat "$TMP_DIR/booking.json"
  exit 1
fi
TICKET_ID="$(jq -er '.ticket_id' "$TMP_DIR/booking.json")"
check "pesanan mulai menunggu pembayaran manual" "true" \
  "$(jq -e '.status == "pending_payment" and .payment_method == "manual" and .amount_rupiah > 0' "$TMP_DIR/booking.json" >/dev/null && echo true || echo false)"

# Simulasi konfirmasi admin pada data uji lokal; tidak ada transfer uang sungguhan.
HTTP_CODE="$(curl -sS -b "$OWNER_COOKIES" -X POST \
  "$API_BASE/v1/tenants/$TENANT_ID/tickets/$TICKET_ID/confirm-manual-payment" \
  -o "$TMP_DIR/confirm.json" -w '%{http_code}')"
check "owner mengonfirmasi pembayaran manual pada data uji" "200" "$HTTP_CODE"
if [ "$HTTP_CODE" != "200" ]; then
  cat "$TMP_DIR/confirm.json"
  exit 1
fi

curl -fsS -b "$CUSTOMER_COOKIES" "$API_BASE/v1/me/tickets" >"$TMP_DIR/my-tickets.json"
check "tiket muncul di akun pelanggan dengan status menunggu giliran" "true" \
  "$(jq -e --arg id "$TICKET_ID" 'any(.[]; .ticket_id == $id and .status == "waiting" and .payment.status == "paid")' "$TMP_DIR/my-tickets.json" >/dev/null && echo true || echo false)"
check "kuota sesi terpakai setelah booking" "1" \
  "$(sql "SELECT used_quota FROM queue_sessions WHERE id = '$SESSION_ID';")"

echo
echo "Data sesi uji akan dibersihkan saat skrip selesai."
echo "Selesai: $FAILS pemeriksaan gagal."
exit "$FAILS"
