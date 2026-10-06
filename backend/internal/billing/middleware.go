package billing

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"kapsflow/internal/httpx"
	"kapsflow/internal/identity"
)

// RequireActiveSubscription menolak permintaan pengubahan data (bukan GET)
// kalau tenant belum pernah berlangganan atau masa tenggangnya sudah habis.
func RequireActiveSubscription(svc *Service, log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method == http.MethodGet || r.Method == http.MethodHead {
				next.ServeHTTP(w, r)
				return
			}
			tenantID, err := uuid.Parse(chi.URLParam(r, "tenantID"))
			if err != nil {
				httpx.Error(w, r, log, httpx.BadRequest("tenant_id_tidak_valid", "ID tenant tidak valid", err))
				return
			}
			info, err := svc.GetStatusAsSystem(r.Context(), tenantID)
			if err != nil {
				httpx.Error(w, r, log, err)
				return
			}
			if info.Status == StatusReadOnly || info.Status == StatusNeverSubscribed {
				httpx.Error(w, r, log, httpx.PaymentRequired("berlangganan_diperlukan", "Bisnis ini perlu berlangganan aktif untuk melakukan perubahan", nil))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func RequirePlatformAdmin(svc *Service, log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user, ok := identity.UserFromContext(r.Context())
			if !ok {
				httpx.Error(w, r, log, httpx.Unauthorized("belum_login", "Anda belum masuk", nil))
				return
			}
			isAdmin, err := svc.IsPlatformAdmin(r.Context(), user.ID)
			if err != nil {
				httpx.Error(w, r, log, err)
				return
			}
			if !isAdmin {
				httpx.Error(w, r, log, httpx.Forbidden("bukan_admin", "Hanya pemilik SaaS yang bisa mengakses ini", nil))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}