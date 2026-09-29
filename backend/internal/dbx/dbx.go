package dbx

import (
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

// TS mengubah time.Time Go biasa menjadi pgtype.Timestamptz, tipe yang
// dipakai sqlc+pgx untuk kolom timestamptz, termasuk yang nullable.
func TS(t time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: t, Valid: true}
}