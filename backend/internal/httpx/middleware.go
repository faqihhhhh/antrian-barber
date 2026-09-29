package httpx

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5/middleware"
)

// RequestLogger mencatat tiap request: method, path, status, dan durasinya.
func RequestLogger(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)

			next.ServeHTTP(ww, r)

			log.Info("request",
				"method", r.Method,
				"path", r.URL.Path,
				"status", ww.Status(),
				"durasi_ms", time.Since(start).Milliseconds(),
				"request_id", middleware.GetReqID(r.Context()),
			)
		})
	}
}

// Recoverer menangkap panic di handler mana pun agar server tidak mati total,
// dan tetap membalas dengan JSON, bukan halaman kosong atau teks polos.
func Recoverer(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if rec := recover(); rec != nil {
					log.Error("panic tertangkap", "path", r.URL.Path, "panic", rec)
					JSON(w, http.StatusInternalServerError, map[string]any{
						"error": map[string]string{
							"code":    "internal_error",
							"message": "Terjadi kesalahan pada server, coba lagi nanti",
						},
					})
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}