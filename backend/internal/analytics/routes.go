package analytics

import (
	"log/slog"

	"github.com/go-chi/chi/v5"
)

// Hanya GET, jadi tidak memakai requireActive: laporan tetap bisa dibaca
// walau langganan sedang masa tenggang atau mode baca saja.
func RegisterTenantRoutes(r chi.Router, svc *Service, log *slog.Logger) {
	h := NewHandlers(svc, log)
	r.Get("/{tenantID}/stats/overview", h.Overview)
	r.Get("/{tenantID}/stats/kapsters", h.Kapsters)
}

// Dipasang di grup /v1/admin yang sudah memakai RequirePlatformAdmin.
func RegisterAdminRoutes(r chi.Router, svc *Service, log *slog.Logger) {
	h := NewHandlers(svc, log)
	r.Get("/stats", h.Platform)
}