package tenant

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
)

// RegisterRoutes menambahkan rute modul tenant ke router yang sudah ada,
// supaya modul billing bisa berbagi prefix "/v1/tenants" yang sama.
func RegisterRoutes(r chi.Router, svc *Service, log *slog.Logger, requireActive func(http.Handler) http.Handler) {
	h := NewHandlers(svc, log)

	r.Post("/", h.CreateTenant)
	r.Get("/", h.ListTenants)
	r.With(requireActive).Post("/{tenantID}/outlets", h.CreateOutlet)
	r.Get("/{tenantID}/outlets", h.ListOutlets)
	r.With(requireActive).Patch("/{tenantID}/outlets/{outletID}/settings", h.UpdateOutletSettings)
}