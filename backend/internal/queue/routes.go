package queue

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"kapsflow/internal/billing"

	"kapsflow/internal/ratelimit"
)

func RegisterRoutes(r chi.Router, svc *Service, log *slog.Logger, pool *pgxpool.Pool, requireActive func(http.Handler) http.Handler) {
	h := NewHandlers(svc, log)
	bookingLimiter := ratelimit.New(5, time.Minute)

	r.With(requireActive).Post("/{tenantID}/outlets/{outletID}/queue-sessions", h.CreateQueueSession)
	r.Get("/{tenantID}/outlets/{outletID}/queue-sessions", h.ListQueueSessions)
	r.With(requireActive, bookingLimiter.MiddlewareWithError(log, "terlalu_banyak_pemesanan", "Terlalu banyak pemesanan. Coba lagi setelah satu menit.")).Post("/{tenantID}/outlets/{outletID}/book", h.BookOnline)

	r.With(requireActive).Post("/{tenantID}/queue-sessions/{sessionID}/increase-quota", h.IncreaseQuota)
	r.With(requireActive).Post("/{tenantID}/queue-sessions/{sessionID}/close", h.CloseQueueSession)
	r.With(requireActive).Post("/{tenantID}/queue-sessions/{sessionID}/tickets", h.AddOfflineTicket)
	r.Get("/{tenantID}/queue-sessions/{sessionID}/tickets", h.ListTickets)
	r.Get("/{tenantID}/queue-sessions/{sessionID}/pending-manual-payments", h.ListPendingManualPayments)
	r.Get("/{tenantID}/queue-sessions/{sessionID}/kapster-states", h.ListKapsterStates)
	r.Get("/{tenantID}/queue-sessions/{sessionID}/awaiting-settlement", h.ListAwaitingSettlement)

	r.With(requireActive).Post("/{tenantID}/queue-sessions/{sessionID}/ready", h.Ready)
	r.Post("/{tenantID}/queue-sessions/{sessionID}/pause", h.Pause)
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
func RegisterWebhookRoutes(r chi.Router, svc *Service, billingSvc *billing.Service, log *slog.Logger, pool *pgxpool.Pool) {
	h := NewWebhookHandlers(svc, billingSvc, log, pool)
	r.Post("/midtrans", h.Midtrans)
}

// RegisterPublicRoutes TIDAK lewat identity.RequireAuth atau rls.Middleware
// — info agregat ini memang untuk siapa saja, bahkan yang belum punya akun.
func RegisterPublicRoutes(r chi.Router, svc *Service, log *slog.Logger) {
	h := NewHandlers(svc, log)
	r.Get("/queue-sessions/{sessionID}/stream", h.Stream)
}

// RegisterMeRoutes dipasang di grup /v1/me (sudah lewat login dan RLS).
func RegisterMeRoutes(r chi.Router, svc *Service, log *slog.Logger) {
	h := NewHandlers(svc, log)
	r.Get("/tickets", h.MyTickets)
	r.Get("/tickets/{ticketID}/qris-image", h.MyQRISImage)
}
