#!/bin/bash
cd ~/kapsflow || exit 1

T=3159e203-02c0-49b0-8fe5-1e94ebbae2e1
OUTLET=3ae1bd6e-fb87-4963-9ef4-d93e998e03c6
API_BASE="${API_BASE:-http://localhost:8080}"
S=$API_BASE/v1/tenants/$T
P=$API_BASE/v1
H='Content-Type: application/json'
SK="SB-Mid-server-FAKE"
GROSS="15000.00"
FAILS=0

check() {
  if [ "$2" = "$3" ]; then echo "PASS  $1"
  else FAILS=$((FAILS+1)); echo "FAIL  $1"; echo "      diharapkan: $2"; echo "      didapat   : $3"; fi
}
sql()  { docker compose exec -T db psql -U kapsflow -d kapsflow -At -c "$1"; }
code() { jq -r '.error.code // "OK"'; }
post() { curl -s -b "$1" -X POST "$2" -H "$H" -d "$3"; }
randdate() { date -d "+$((RANDOM % 300 + 20)) days" +%F; }
freedate() {
  local d
  while true; do
    d=$(randdate)
    [ -z "$(sql "SELECT 1 FROM queue_sessions WHERE outlet_id='$OUTLET' AND session_date='$d';")" ] && { echo "$d"; return; }
  done
}
newsession() {
  post cookiesB.txt $S/outlets/$OUTLET/queue-sessions "{\"session_date\":\"$1\",\"max_quota\":5}" > /dev/null
  sql "SELECT id FROM queue_sessions WHERE outlet_id='$OUTLET' AND session_date='$1';"
}
sig()  { printf '%s' "$1$2$3$SK" | sha512sum | cut -d' ' -f1; }
hook() {
  curl -s -X POST $P/webhooks/midtrans -H "$H" \
    -d "{\"order_id\":\"$1\",\"status_code\":\"200\",\"gross_amount\":\"$GROSS\",\"signature_key\":\"$2\",\"transaction_status\":\"$3\",\"fraud_status\":\"accept\"}"
}

cleanup() {
  kill "$FAKE_PID" 2>/dev/null
  sql "UPDATE tenant_profiles SET midtrans_server_key_encrypted=NULL, midtrans_client_key_encrypted=NULL, midtrans_configured_at=NULL WHERE tenant_id='$T';" > /dev/null
  rm -f /tmp/fake_midtrans_status
}
trap cleanup EXIT

# Midtrans tiruan: membalas charge dengan QR palsu, dan status transaksi dibaca
# dari file /tmp/fake_midtrans_status (pending / settlement / expire).
cat > /tmp/fake_midtrans.py << 'PY'
import http.server, json, os, sys

STATUS_FILE = "/tmp/fake_midtrans_status"

class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.command, self.path))

    def reply(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            return self.reply(200, {"ok": True})
        if self.path.startswith("/v2/") and self.path.endswith("/status"):
            st = open(STATUS_FILE).read().strip() if os.path.exists(STATUS_FILE) else "pending"
            return self.reply(200, {"transaction_status": st, "fraud_status": "accept"})
        self.reply(404, {"status_message": "tidak ada"})

    def do_POST(self):
        n = int(self.headers.get("Content-Length", "0"))
        body = json.loads(self.rfile.read(n) or b"{}")
        if self.path == "/v2/charge":
            oid = body["transaction_details"]["order_id"]
            return self.reply(201, {
                "order_id": oid,
                "transaction_id": "fake-" + oid,
                "status_message": "Success, QRIS transaction is successful",
                "actions": [{"name": "generate-qr-code", "url": "http://localhost:9099/qr/" + oid + ".png"}],
            })
        self.reply(404, {"status_message": "tidak ada"})

http.server.ThreadingHTTPServer(("127.0.0.1", 9099), H).serve_forever()
PY

echo "== 0. Persiapan =="
echo pending > /tmp/fake_midtrans_status
python3 /tmp/fake_midtrans.py 2> /tmp/fake_midtrans.log &
FAKE_PID=$!
sleep 1
check "Midtrans tiruan hidup" "true" "$(curl -s localhost:9099/health | jq -r '.ok')"

curl -s -b cookiesB.txt -X PATCH $S/outlets/$OUTLET/settings -H "$H" -d '{"dp_price_rupiah":15000,"default_duration_minutes":25}' > /dev/null
post cookiesB.txt $S/profile/midtrans "{\"server_key\":\"$SK\",\"client_key\":\"SB-Mid-client-FAKE\",\"is_production\":false}" > /dev/null
SLUG=$(sql "SELECT slug FROM outlets WHERE id='$OUTLET';")
check "mode pembayaran outlet = midtrans" "midtrans" "$(curl -s $P/public/outlets/$SLUG | jq -r '.payment_mode')"

D1=$(freedate); SESS1=$(newsession "$D1")
D2=$(freedate); SESS2=$(newsession "$D2")
D3=$(freedate); SESS3=$(newsession "$D3")

echo "== 1. Pemesanan Midtrans =="
R=$(post cookiesPembeli2.txt $S/outlets/$OUTLET/book "{\"session_date\":\"$D1\",\"customer_name\":\"Uji Midtrans\"}")
TK1=$(echo "$R" | jq -r '.ticket_id')
if [ -z "$TK1" ] || [ "$TK1" = "null" ]; then
  echo "FAIL  pemesanan gagal: $R"
  echo "      Pastikan API dijalankan dengan: MIDTRANS_BASE_URL_OVERRIDE=http://localhost:9099 make dev"
  exit 1
fi
PID1=$(sql "SELECT id FROM ticket_payments WHERE ticket_id='$TK1';")
check "metode midtrans" "midtrans" "$(echo "$R" | jq -r '.payment_method')"
check "nominal = harga DP (tanpa kode unik)" "15000" "$(echo "$R" | jq -r '.amount_rupiah')"
check "QR berasal dari Midtrans tiruan" "http://localhost:9099/qr/$PID1.png" "$(echo "$R" | jq -r '.qr_code_url')"
MT=$(curl -s -b cookiesPembeli2.txt $P/me/tickets | jq --arg id "$TK1" '.[] | select(.ticket_id==$id)')
check "tiket saya memuat alamat QR yang sama" "http://localhost:9099/qr/$PID1.png" "$(echo "$MT" | jq -r '.payment.qr_code_url')"

echo "== 2. Hak UPDATE pelanggan lewat RLS =="
UID2=$(curl -s -b cookiesPembeli2.txt $P/me | jq -r '.user.id')
PID1=$(sql "SELECT id FROM ticket_payments WHERE ticket_id='$TK1';")
CNT=$(docker compose exec -T db psql -q -U kapsflow_app -d kapsflow -At -c "BEGIN; SELECT set_config('app.user_id','$UID2',true); WITH u AS (UPDATE ticket_payments SET status='paid' WHERE id='$PID1' RETURNING 1) SELECT count(*) FROM u; ROLLBACK;" | grep -E '^[0-9]+$' | tail -1)
check "pelanggan tidak bisa mengubah pembayaran lewat RLS" "0" "$CNT"
CNT_TICKET=$(docker compose exec -T db psql -q -U kapsflow_app -d kapsflow -At -c "BEGIN; SELECT set_config('app.user_id','$UID2',true); WITH u AS (UPDATE tickets SET status='canceled' WHERE id='$TK1' RETURNING 1) SELECT count(*) FROM u; ROLLBACK;" | grep -E '^[0-9]+$' | tail -1)
check "pelanggan tidak bisa mengubah tiket lewat RLS" "0" "$CNT_TICKET"

echo "== 3. Cek ulang saat belum dibayar =="
RC=$(post cookiesPembeli2.txt $S/tickets/$TK1/recheck-payment '{}')
check "status pending" "pending" "$(echo "$RC" | jq -r '.status')"
check "respons hanya berisi status" '["status"]' "$(echo "$RC" | jq -c 'keys')"
check "tiket masih menunggu pembayaran" "pending_payment" "$(sql "SELECT status FROM tickets WHERE id='$TK1';")"

echo "== 4. Hak akses =="
check "pelanggan lain ditolak" "pembayaran_tidak_ditemukan" "$(post cookiesPembeli.txt $S/tickets/$TK1/recheck-payment '{}' | code)"
OTHER=$(sql "SELECT id FROM tenants WHERE id<>'$T' LIMIT 1;")
WRONG=$(post cookiesPembeli2.txt $API_BASE/v1/tenants/$OTHER/tickets/$TK1/recheck-payment '{}' | code)
check "alamat tenant yang salah tidak diproses" "ditolak" "$([ "$WRONG" != "OK" ] && echo ditolak || echo diproses)"

echo "== 5. Cek ulang setelah dibayar =="
echo settlement > /tmp/fake_midtrans_status
# Tiket offline milik orang lain: tidak terlihat oleh pelanggan lewat RLS, tapi harus
# ikut terhitung di siaran realtime (siaran dibuat dengan hak sistem).
post cookiesB.txt $S/queue-sessions/$SESS1/tickets '{"customer_name":"Offline Uji"}' > /dev/null
curl -sN $P/public/queue-sessions/$SESS1/stream > /tmp/sse1.out 2>/dev/null &
SSE=$!
sleep 1
RC=$(post cookiesPembeli2.txt $S/tickets/$TK1/recheck-payment '{}')
sleep 1
kill "$SSE" 2>/dev/null; wait "$SSE" 2>/dev/null
check "status paid" "paid" "$(echo "$RC" | jq -r '.status')"
check "pembayaran lunas di database" "paid" "$(sql "SELECT status FROM ticket_payments WHERE id='$PID1';")"
check "tiket masuk antrian" "waiting" "$(sql "SELECT status FROM tickets WHERE id='$TK1';")"
LAST=$(grep '^data:' /tmp/sse1.out | tail -1 | sed 's/^data: *//')
check "siaran realtime terakhir: 2 orang menunggu (1 offline + 1 pelanggan ini)" "2" "$(echo "$LAST" | jq -r '.waiting_count')"
check "tiket saya: waiting dan ada estimasi" "waiting/true" "$(curl -s -b cookiesPembeli2.txt $P/me/tickets | jq -r --arg id "$TK1" '.[] | select(.ticket_id==$id) | .status + "/" + ((.estimate != null) | tostring)')"
check "cek ulang kedua kali tetap paid" "paid" "$(post cookiesPembeli2.txt $S/tickets/$TK1/recheck-payment '{}' | jq -r '.status')"
check "tidak ada antrian ganda" "2" "$(sql "SELECT count(*) FROM tickets WHERE queue_session_id='$SESS1' AND status='waiting';")"

echo "== 6. Webhook =="
R2=$(post cookiesPembeli.txt $S/outlets/$OUTLET/book "{\"session_date\":\"$D2\",\"customer_name\":\"Uji Webhook\"}")
TK2=$(echo "$R2" | jq -r '.ticket_id')
PID2=$(sql "SELECT id FROM ticket_payments WHERE ticket_id='$TK2';")
check "tanda tangan salah ditolak" "tanda_tangan_tidak_valid" "$(hook $PID2 salah settlement | code)"
check "tiket tetap menunggu pembayaran" "pending_payment" "$(sql "SELECT status FROM tickets WHERE id='$TK2';")"
SIG=$(sig "$PID2" 200 "$GROSS")
check "webhook sah diterima" "ok" "$(hook $PID2 $SIG settlement | jq -r '.status')"
check "tiket masuk antrian" "waiting" "$(sql "SELECT status FROM tickets WHERE id='$TK2';")"
check "webhook ganda diterima tanpa efek" "ok" "$(hook $PID2 $SIG settlement | jq -r '.status')"
check "tidak ada antrian ganda" "1" "$(sql "SELECT count(*) FROM tickets WHERE queue_session_id='$SESS2' AND status='waiting';")"

echo "== 7. Pembayaran gagal atau hangus =="
R3=$(post cookiesPembeli2.txt $S/outlets/$OUTLET/book "{\"session_date\":\"$D3\",\"customer_name\":\"Uji Hangus\"}")
TK3=$(echo "$R3" | jq -r '.ticket_id')
PID3=$(sql "SELECT id FROM ticket_payments WHERE ticket_id='$TK3';")
check "kuota terpakai 1 setelah memesan" "1" "$(sql "SELECT used_quota FROM queue_sessions WHERE id='$SESS3';")"
echo expire > /tmp/fake_midtrans_status
check "status failed" "failed" "$(post cookiesPembeli2.txt $S/tickets/$TK3/recheck-payment '{}' | jq -r '.status')"
check "pembayaran failed di database" "failed" "$(sql "SELECT status FROM ticket_payments WHERE id='$PID3';")"
check "tiket dibatalkan" "canceled" "$(sql "SELECT status FROM tickets WHERE id='$TK3';")"
check "kuota kembali" "0" "$(sql "SELECT used_quota FROM queue_sessions WHERE id='$SESS3';")"

echo
echo "Selesai: $FAILS pemeriksaan gagal."
