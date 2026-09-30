package dbx

import (
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

func TS(t time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: t, Valid: true}
}

// UUID mengubah uuid.UUID biasa menjadi pgtype.UUID, dipakai untuk kolom
// UUID yang nullable (misalnya invoices.confirmed_by), berbeda dari kolom
// UUID wajib yang sudah di-override otomatis oleh sqlc.
func UUID(u uuid.UUID) pgtype.UUID {
	return pgtype.UUID{Bytes: [16]byte(u), Valid: true}
}