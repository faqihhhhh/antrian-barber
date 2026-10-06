package rls

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"kapsflow/internal/httpx"
	"kapsflow/internal/identity"
	"github.com/google/uuid"
)

type ctxKey string

const txContextKey ctxKey = "rls_tx"

func TxFromContext(ctx context.Context) (pgx.Tx, bool) {
	tx, ok := ctx.Value(txContextKey).(pgx.Tx)
	return tx, ok
}

// Middleware membungkus request dalam satu transaksi, ditandai app.user_id
// milik pengguna yang login. Transaksi di-COMMIT hanya kalau handler
// membalas status sukses (di bawah 400); kalau handler membalas error
// (bahkan error logika bisnis biasa, bukan error SQL), transaksi
// di-ROLLBACK, supaya tulisan sebagian tidak ikut tersimpan.
func Middleware(pool *pgxpool.Pool, log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user, ok := identity.UserFromContext(r.Context())
			if !ok {
				httpx.Error(w, r, log, httpx.Unauthorized("belum_login", "Anda belum masuk", nil))
				return
			}

			tx, err := pool.Begin(r.Context())
			if err != nil {
				httpx.Error(w, r, log, httpx.Internal(err))
				return
			}
			defer tx.Rollback(r.Context()) // tidak berefek kalau sudah di-commit

			if _, err := tx.Exec(r.Context(), `SELECT set_config('app.user_id', $1, true)`, user.ID.String()); err != nil {
				httpx.Error(w, r, log, httpx.Internal(err))
				return
			}

			ctx := context.WithValue(r.Context(), txContextKey, tx)
			ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
			next.ServeHTTP(ww, r.WithContext(ctx))

			if ww.Status() >= 400 {
				return // biarkan defer tx.Rollback yang membatalkan
			}
			if err := tx.Commit(r.Context()); err != nil {
				log.Error("gagal commit transaksi RLS", "err", err, "path", r.URL.Path)
			}
		})
	}
}

// SystemUserID adalah akun sintetis (dibuat lewat migrasi) untuk transaksi
// yang tidak dipicu pengguna login — webhook Midtrans, nanti job terjadwal
// di Fase 8.
var SystemUserID = uuid.MustParse("00000000-0000-0000-0000-000000000001")

// RunAsSystem sama seperti Middleware, tapi untuk kode yang dijalankan di
// luar siklus request HTTP biasa. Karena pengguna sistem ditandai platform
// admin di database, app_has_tenant_access selalu true untuknya — artinya
// fn di dalam SEPENUHNYA bertanggung jawab melakukan validasinya sendiri
// sebelum mengubah data, persis seperti SECURITY DEFINER.
func RunAsSystem(ctx context.Context, pool *pgxpool.Pool, fn func(ctx context.Context) error) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `SELECT set_config('app.user_id', $1, true)`, SystemUserID.String()); err != nil {
		return err
	}

	fnCtx := context.WithValue(ctx, txContextKey, tx)
	if err := fn(fnCtx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}