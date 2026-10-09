package review

import (
	"log/slog"

	"github.com/go-chi/chi/v5"
)

// Tanpa requireActive: pelanggan tidak boleh dihukum oleh status langganan
// owner. Pembatasan siapa yang boleh membaca ada di service + RLS.
func RegisterRoutes(r chi.Router, svc *Service, log *slog.Logger) {
	h := NewHandlers(svc, log)
	r.Post("/{tenantID}/tickets/{ticketID}/review", h.Submit)
	r.Get("/{tenantID}/tickets/{ticketID}/review", h.GetOwn)
	r.Get("/{tenantID}/reviews", h.List)
	r.Get("/{tenantID}/reviews/summary", h.Summary)
}