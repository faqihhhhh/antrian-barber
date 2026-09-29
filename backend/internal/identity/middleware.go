package identity

import (
	"context"
	"log/slog"
	"net/http"

	db "kapsflow/internal/db"
	"kapsflow/internal/httpx"
)

type contextKey string

const userContextKey contextKey = "current_user"

func UserFromContext(ctx context.Context) (db.User, bool) {
	user, ok := ctx.Value(userContextKey).(db.User)
	return user, ok
}

// RequireAuth membaca cookie sesi lalu menaruh user-nya di context, supaya
// handler lain (Me, dan modul-modul berikutnya) tinggal panggil
// UserFromContext tanpa perlu tahu soal cookie sama sekali.
func RequireAuth(svc *Service, log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			cookie, err := r.Cookie(SessionCookieName)
			if err != nil {
				httpx.Error(w, r, log, httpx.Unauthorized("belum_login", "Anda belum masuk", nil))
				return
			}
			user, err := svc.CurrentUser(r.Context(), cookie.Value)
			if err != nil {
				httpx.Error(w, r, log, err)
				return
			}
			ctx := context.WithValue(r.Context(), userContextKey, user)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}