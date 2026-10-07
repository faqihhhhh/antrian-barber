package queue

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func RegisterRoutes(r chi.Router, svc *Service, log *slog.Logger, pool *pgxpool.Pool, requireActive func(http.Handler) http.Handler) {
	h := NewHandlers(svc, log)

	r.With(requireActive).Post("/{tenantID}/outlets/{outletID}/queue-sessions", h.CreateQueueSession)
	r.Get("/{tenantID}/outlets/{outletID}/queue-sessions", h.ListQueueSessions)
	r.With(requireActive).Post("/{tenantID}/outlets/{outletID}/book", h.BookOnline)

	r.With(requireActive).Post("/{tenantID}/queue-sessions/{sessionID}/increase-quota", h.IncreaseQuota)
	r.With(requireActive).Post("/{tenantID}/queue-sessions/{sessionID}/tickets", h.AddOfflineTicket)
	r.Get("/{tenantID}/queue-sessions/{sessionID}/tickets", h.ListTickets)
	r.Get("/{tenantID}/queue-sessions/{sessionID}/kapster-states", h.ListKapsterStates)
	r.Get("/{tenantID}/queue-sessions/{sessionID}/awaiting-settlement", h.ListAwaitingSettlement)

	r.With(requireActive).Post("/{tenantID}/queue-sessions/{sessionID}/ready", h.Ready)
	r.With(requireActive).Post("/{tenantID}/queue-sessions/{sessionID}/start", h.Start)
	r.With(requireActive).Post("/{tenantID}/queue-sessions/{sessionID}/skip", h.Skip)
	r.With(requireActive).Post("/{tenantID}/queue-sessions/{sessionID}/complete", h.Complete)

	r.Get("/{tenantID}/tickets/{ticketID}/estimate", h.EstimateTicketWait)
	r.Post("/{tenantID}/tickets/{ticketID}/recheck-payment", h.RecheckPayment)
	r.With(requireActive).Post("/{tenantID}/tickets/{ticketID}/confirm-manual-payment", h.ConfirmManualPayment)
	r.With(requireActive).Post("/{tenantID}/tickets/{ticketID}/confirm-final-payment", h.ConfirmFinalPayment)
}

// RegisterWebhookRoutes dipasang di luar grup /v1/tenants (tanpa
// identity.RequireAuth atau rls.Middleware) — Midtrans bukan pengguna yang
// login, otorisasinya lewat tanda tangan di dalam body, bukan cookie sesi.
func RegisterWebhookRoutes(r chi.Router, svc *Service, log *slog.Logger, pool *pgxpool.Pool) {
	h := NewWebhookHandlers(svc, log, pool)
	r.Post("/midtrans", h.Midtrans)
}

// RegisterPublicRoutes TIDAK lewat identity.RequireAuth atau rls.Middleware
// — info agregat ini memang untuk siapa saja, bahkan yang belum punya akun.
func RegisterPublicRoutes(r chi.Router, svc *Service, log *slog.Logger) {
	h := NewHandlers(svc, log)
	r.Get("/queue-sessions/{sessionID}/stream", h.Stream)
}