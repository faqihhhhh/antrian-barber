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
	r.Get("/{tenantID}/subscription/payment-options", h.GetOwnerPaymentOptions)
	r.Get("/{tenantID}/subscription/manual-qris", h.GetOwnerManualQRIS)
}

func RegisterAdminRoutes(r chi.Router, svc *Service, log *slog.Logger) {
	h := NewHandlers(svc, log)
	r.Put("/plans/{planCode}", h.UpdatePlanPrice)
	r.Get("/payment-settings", h.GetPlatformPaymentInfo)
	r.Get("/payment-settings/manual-qris/image", h.GetPlatformManualQRIS)
	r.Put("/payment-settings/manual-qris", h.SetPlatformManualQRIS)
	r.Delete("/payment-settings/manual-qris", h.DeletePlatformManualQRIS)
	r.Get("/invoices", h.ListPendingInvoicesAdmin)
	r.Post("/invoices/{invoiceID}/confirm", h.ConfirmInvoice)
}
