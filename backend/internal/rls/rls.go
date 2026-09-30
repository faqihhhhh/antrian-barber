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