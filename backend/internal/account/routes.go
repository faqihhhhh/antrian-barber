package account

import (
	"log/slog"

	"github.com/go-chi/chi/v5"
)

func RegisterRoutes(r chi.Router, svc *Service, log *slog.Logger) {
	h := NewHandlers(svc, log)
	r.Get("/", h.Me)
	r.Put("/display_name", h.SetDisplayName)
	r.Put("/password", h.ChangePassword)
}
