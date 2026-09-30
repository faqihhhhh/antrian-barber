package tenant

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
)

func Routes(svc *Service, log *slog.Logger) http.Handler {
	h := NewHandlers(svc, log)
	r := chi.NewRouter()

	r.Post("/", h.CreateTenant)
	r.Get("/", h.ListTenants)
	r.Post("/{tenantID}/outlets", h.CreateOutlet)
	r.Get("/{tenantID}/outlets", h.ListOutlets)

	return r
}