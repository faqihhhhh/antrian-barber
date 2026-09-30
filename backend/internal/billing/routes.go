package billing

import (
	"log/slog"

	"github.com/go-chi/chi/v5"
)

func RegisterPublicRoutes(r chi.Router, svc *Service, log *slog.Logger) {
	h := NewHandlers(svc, log)
	r.Get("/", h.ListPlans)
}

func RegisterTenantRoutes(r chi.Router, svc *Service, log *slog.Logger) {
	h := NewHandlers(svc, log)
	r.Post("/{tenantID}/subscribe", h.Subscribe)
	r.Get("/{tenantID}/subscription", h.GetSubscription)
	r.Get("/{tenantID}/invoices", h.ListInvoices)
}

func RegisterAdminRoutes(r chi.Router, svc *Service, log *slog.Logger) {
	h := NewHandlers(svc, log)
	r.Get("/invoices", h.ListPendingInvoicesAdmin)
	r.Post("/invoices/{invoiceID}/confirm", h.ConfirmInvoice)
}