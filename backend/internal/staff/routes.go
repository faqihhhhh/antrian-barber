package staff

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
)

func RegisterRoutes(r chi.Router, svc *Service, log *slog.Logger, requireActive func(http.Handler) http.Handler) {
	h := NewHandlers(svc, log)
	r.With(requireActive).Post("/{tenantID}/staff", h.InviteStaff)
	r.Get("/{tenantID}/staff", h.ListStaff)
}

