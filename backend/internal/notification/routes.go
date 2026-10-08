package notification

import (
	"log/slog"

	"github.com/go-chi/chi/v5"
)

func RegisterRoutes(r chi.Router, svc *Service, log *slog.Logger) {
	h := NewHandlers(svc, log)
	r.Get("/push/public-key", h.GetPublicKey)
	r.Post("/push/subscribe", h.Subscribe)
	r.Post("/push/unsubscribe", h.Unsubscribe)
}