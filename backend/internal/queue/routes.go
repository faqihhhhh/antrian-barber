package queue

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
)

func RegisterRoutes(r chi.Router, svc *Service, log *slog.Logger, requireActive func(http.Handler) http.Handler) {
	h := NewHandlers(svc, log)

	r.With(requireActive).Post("/{tenantID}/outlets/{outletID}/queue-sessions", h.CreateQueueSession)
	r.Get("/{tenantID}/outlets/{outletID}/queue-sessions", h.ListQueueSessions)

	r.With(requireActive).Post("/{tenantID}/queue-sessions/{sessionID}/increase-quota", h.IncreaseQuota)
	r.With(requireActive).Post("/{tenantID}/queue-sessions/{sessionID}/tickets", h.AddOfflineTicket)
	r.Get("/{tenantID}/queue-sessions/{sessionID}/tickets", h.ListTickets)
	r.Get("/{tenantID}/queue-sessions/{sessionID}/kapster-states", h.ListKapsterStates)

	r.With(requireActive).Post("/{tenantID}/queue-sessions/{sessionID}/ready", h.Ready)
	r.With(requireActive).Post("/{tenantID}/queue-sessions/{sessionID}/start", h.Start)
	r.With(requireActive).Post("/{tenantID}/queue-sessions/{sessionID}/skip", h.Skip)
	r.With(requireActive).Post("/{tenantID}/queue-sessions/{sessionID}/complete", h.Complete)
}