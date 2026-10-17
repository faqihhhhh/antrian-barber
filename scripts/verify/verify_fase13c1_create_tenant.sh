#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:8080}"
TMP="$(mktemp)"
TEST_TENANT_ID=""
FAILS=0

sql() {
  docker compose exec -T db psql -U kapsflow -d kapsflow -At -v ON_ERROR_STOP=1 -c "$1"
}

cleanup() {
  if [ -n "$TEST_TENANT_ID" ]; then
    sql "DELETE FROM tenants WHERE id = '$TEST_TENANT_ID';" >/dev/null 2>&1 || true
  fi
  rm -f "$TMP"
}
trap cleanup EXIT

check() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then echo "PASS  $label"
  else FAILS=$((FAILS + 1)); echo "FAIL  $label: diharapkan $expected, didapat $actual"; fi
}

OWNER_ID="$(curl -fsS -b cookies.txt "$API_BASE/v1/me" | jq -er '.user.id')"
HTTP_CODE="$(curl -sS -b cookies.txt -X POST "$API_BASE/v1/tenants/" \
  -H 'Content-Type: application/json' -d '{"name":"  Uji Owner Onboarding  "}' \
  -o "$TMP" -w '%{http_code}')"
check "pemilik SaaS dapat membuat tenant untuk verifikasi endpoint" "201" "$HTTP_CODE"
TEST_TENANT_ID="$(jq -er '.id' "$TMP")"
check "nama bisnis dirapikan dan respons hanya berisi DTO aman" "true" \
  "$(jq -e 'keys == ["id", "name"] and .name == "Uji Owner Onboarding"' "$TMP" >/dev/null && echo true || echo false)"
check "akun pembuat langsung mendapat peran owner" "1" \
  "$(sql "SELECT count(*) FROM memberships WHERE tenant_id = '$TEST_TENANT_ID' AND user_id = '$OWNER_ID' AND roles @> ARRAY['owner'];")"

HTTP_CODE="$(curl -sS -b cookies.txt -X POST "$API_BASE/v1/tenants/" \
  -H 'Content-Type: application/json' -d '{"name":"   "}' \
  -o "$TMP" -w '%{http_code}')"
check "nama bisnis kosong ditolak" "400" "$HTTP_CODE"

echo
echo "Selesai: $FAILS pemeriksaan gagal."
exit "$FAILS"
