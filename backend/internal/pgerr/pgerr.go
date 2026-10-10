package pgerr

import (
	"errors"

	"github.com/jackc/pgx/v5/pgconn"
)

// IsUniqueViolation true kalau error dari Postgres adalah pelanggaran
// unique constraint (kode 23505) — dipakai untuk membalas 409 Conflict
// yang rapi, bukan 500 generik.
func IsUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "23505"
	}
	return false
}

// IsUniqueViolationOn true kalau pelanggaran unik berasal dari constraint atau
// index dengan nama tertentu.
func IsUniqueViolationOn(err error, constraint string) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "23505" && pgErr.ConstraintName == constraint
	}
	return false
}