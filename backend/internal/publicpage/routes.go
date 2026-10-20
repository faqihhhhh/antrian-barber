package publicpage

import (
	"log/slog"

	"github.com/go-chi/chi/v5"
)

// Dipasang di grup /v1/public: tanpa login.
func RegisterRoutes(r chi.Router, svc *Service, log *slog.Logger) {
	h := NewHandlers(svc, log)
	r.Get("/outlets", h.ListOutletDirectory)
	r.Get("/outlets/{slug}", h.GetOutlet)
}
