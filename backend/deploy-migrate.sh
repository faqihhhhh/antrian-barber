#!/bin/sh
set -eu

: "${DATABASE_URL:?DATABASE_URL wajib diisi untuk migrasi}"
: "${APP_DATABASE_PASSWORD:?APP_DATABASE_PASSWORD wajib diisi}"

goose -dir /migrations postgres "$DATABASE_URL" up

psql "$DATABASE_URL" \
  --set=ON_ERROR_STOP=1 \
  --set=app_password="$APP_DATABASE_PASSWORD" <<'SQL'
ALTER ROLE kapsflow_app WITH LOGIN PASSWORD :'app_password';
SQL
