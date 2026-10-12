package profile

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
)

func RegisterRoutes(r chi.Router, svc *Service, log *slog.Logger, requireActive func(http.Handler) http.Handler) {
	h := NewHandlers(svc, log)
	r.Get("/{tenantID}/profile", h.GetProfile)
	r.With(requireActive).Post("/{tenantID}/profile/midtrans", h.SetMidtrans)
	r.With(requireActive).Post("/{tenantID}/profile/skip-midtrans", h.SkipMidtrans)
	r.With(requireActive).Put("/{tenantID}/profile/manual-qris", h.SetManualQRIS)
}