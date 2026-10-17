#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:8080}"
TEST_TENANT_ID="$(cat /proc/sys/kernel/random/uuid)"
RESPONSE_FILE="$(mktemp)"
FAILS=0

sql() {
  docker compose exec -T db psql -U kapsflow -d kapsflow -At -v ON_ERROR_STOP=1 -c "$1"
}

cleanup() {
  if [ -n "${TEST_TENANT_ID:-}" ]; then
    sql "DELETE FROM tenants WHERE id = '$TEST_TENANT_ID';" >/dev/null 2>&1 || true
  fi
  rm -f "$RESPONSE_FILE"
}
trap cleanup EXIT

check() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then echo "PASS  $label"
  else FAILS=$((FAILS + 1)); echo "FAIL  $label: diharapkan $expected, didapat $actual"; fi
}

OWNER_ID="$(curl -fsS -b cookiesB.txt "$API_BASE/v1/me" | jq -er '.user.id')"
sql "INSERT INTO tenants (id, name) VALUES ('$TEST_TENANT_ID', 'Tes Periode Billing');
INSERT INTO memberships (tenant_id, user_id, roles) VALUES ('$TEST_TENANT_ID', '$OWNER_ID', ARRAY['owner']);
INSERT INTO subscriptions (tenant_id, plan_id)
SELECT '$TEST_TENANT_ID', id FROM plans WHERE code = 'starter_monthly';"

CREATE_CODE="$(curl -sS -b cookiesB.txt -X POST "$API_BASE/v1/tenants/$TEST_TENANT_ID/subscribe" \
  -H 'Content-Type: application/json' -d '{"plan_code":"starter_monthly"}' -o "$RESPONSE_FILE" -w '%{http_code}')"
check "owner membuat invoice tenant uji" "201" "$CREATE_CODE"
TEST_INVOICE_ID="$(jq -er '.id' "$RESPONSE_FILE")"
check "respons invoice tidak membocorkan kolom internal" "true" "$(jq -e 'has("id") and ((has("tenant_id") or has("plan_id") or has("confirmed_by")) | not)' "$RESPONSE_FILE" >/dev/null && echo true || echo false)"

EXPIRY_SECONDS="$(sql "SELECT EXTRACT(epoch FROM expires_at - created_at)::int FROM invoices WHERE id = '$TEST_INVOICE_ID';")"
check "invoice kedaluwarsa tepat 24 jam sejak dibuat" "86400" "$EXPIRY_SECONDS"
sql "UPDATE subscriptions SET current_period_end = now() + interval '14 days' WHERE tenant_id = '$TEST_TENANT_ID';"
EXPECTED_START="$(sql "SELECT to_char(current_period_end AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI:SS') FROM subscriptions WHERE tenant_id = '$TEST_TENANT_ID';")"
EXPECTED_END="$(sql "SELECT to_char((current_period_end + interval '1 month') AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI:SS') FROM subscriptions WHERE tenant_id = '$TEST_TENANT_ID';")"
HTTP_CODE="$(curl -sS -b cookies.txt -X POST "$API_BASE/v1/admin/invoices/$TEST_INVOICE_ID/confirm" -o "$RESPONSE_FILE" -w '%{http_code}')"
check "pemilik SaaS mengonfirmasi invoice uji" "200" "$HTTP_CODE"

ACTUAL="$(sql "SELECT status || '|' || to_char(period_start AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI:SS') || '|' || to_char(period_end AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI:SS') FROM invoices WHERE id = '$TEST_INVOICE_ID';")"
check "invoice mencatat periode dan subscription diperpanjang dari akhir lama" "paid|$EXPECTED_START|$EXPECTED_END" "$ACTUAL"

echo
echo "Selesai: $FAILS pemeriksaan gagal."
exit "$FAILS"
