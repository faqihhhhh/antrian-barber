#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

backup_dir="$repo_root/backups"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_path="$backup_dir/kapsflow_${timestamp}.dump"
restore_db="kapsflow_restore_check_${timestamp//[^a-zA-Z0-9]/_}"

mkdir -p "$backup_dir"
umask 077
restore_created=0

cleanup() {
	if [[ "$restore_created" == 1 ]]; then
		docker compose exec -T db sh -c 'dropdb -U "$POSTGRES_USER" --if-exists "$1"' sh "$restore_db" >/dev/null
	fi
}
trap cleanup EXIT

echo "Membuat backup: $backup_path"
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' > "$backup_path"
test -s "$backup_path"

source_table_count="$(docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc "$1"' sh \
	"SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'")"
if [[ ! "$source_table_count" =~ ^[0-9]+$ ]] || (( source_table_count == 0 )); then
	echo "FAIL: database sumber tidak memiliki tabel publik untuk diperiksa" >&2
	exit 1
fi

docker compose exec -T db sh -c 'createdb -U "$POSTGRES_USER" "$1"' sh "$restore_db"
restore_created=1
docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$1" --exit-on-error' sh "$restore_db" < "$backup_path"

restored_table_count="$(docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$1" -Atqc "$2"' sh \
	"$restore_db" \
	"SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'")"
if [[ "$restored_table_count" != "$source_table_count" ]]; then
	echo "FAIL: jumlah tabel berbeda (sumber=$source_table_count, hasil restore=$restored_table_count)" >&2
	exit 1
fi

echo "PASS: backup dapat dipulihkan; tabel publik sumber dan hasil restore: $source_table_count"
echo "Backup tersimpan di: $backup_path"
