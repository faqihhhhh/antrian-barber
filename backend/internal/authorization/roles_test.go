package authorization

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	db "kapsflow/internal/db"
	"kapsflow/internal/httpx"
)

type fakeDB struct{ row pgx.Row }

func (fakeDB) Exec(context.Context, string, ...interface{}) (pgconn.CommandTag, error) {
	return pgconn.CommandTag{}, nil
}
func (fakeDB) Query(context.Context, string, ...interface{}) (pgx.Rows, error) { return nil, nil }
func (f fakeDB) QueryRow(context.Context, string, ...interface{}) pgx.Row      { return f.row }

type fakeRow struct {
	roles []string
	err   error
}

func (r fakeRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	values := []any{uuid.New(), uuid.New(), uuid.New(), r.roles, pgtype.Timestamptz{}, pgtype.Timestamptz{}}
	for i := range dest {
		reflect.ValueOf(dest[i]).Elem().Set(reflect.ValueOf(values[i]))
	}
	return nil
}

func TestRequireTenantRole(t *testing.T) {
	tests := []struct {
		name      string
		row       pgx.Row
		wantError bool
		wantCode  string
	}{
		{name: "owner diizinkan", row: fakeRow{roles: []string{"owner"}}},
		{name: "admin ditolak", row: fakeRow{roles: []string{"admin"}}, wantError: true, wantCode: "bukan_owner"},
		{name: "orang luar ditolak", row: fakeRow{err: pgx.ErrNoRows}, wantError: true, wantCode: "bukan_owner"},
		{name: "kesalahan query diteruskan sebagai internal", row: fakeRow{err: errors.New("database gagal")}, wantError: true, wantCode: "internal_error"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := RequireTenantRole(context.Background(), db.New(fakeDB{row: tt.row}), uuid.New(), uuid.New(), "owner")
			if !tt.wantError {
				if err != nil {
					t.Fatalf("RequireTenantRole() error = %v", err)
				}
				return
			}
			appErr, ok := err.(*httpx.AppError)
			if !ok || appErr.Code != tt.wantCode {
				t.Fatalf("RequireTenantRole() error = %v, want code %q", err, tt.wantCode)
			}
		})
	}
}

func TestHasRole(t *testing.T) {
	tests := []struct {
		name     string
		roles    []string
		required string
		want     bool
	}{
		{name: "owner diizinkan", roles: []string{"owner"}, required: "owner", want: true},
		{name: "admin bukan owner", roles: []string{"admin"}, required: "owner", want: false},
		{name: "role gabungan memuat owner", roles: []string{"kapster", "owner"}, required: "owner", want: true},
		{name: "tanpa role ditolak", roles: nil, required: "owner", want: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := HasRole(tt.roles, tt.required); got != tt.want {
				t.Fatalf("HasRole(%v, %q) = %v, want %v", tt.roles, tt.required, got, tt.want)
			}
		})
	}
}
