package account

import (
	"log/slog"
	"net/http"

	"kapsflow/internal/httpx"
	"kapsflow/internal/identity"
)

type Handlers struct {
	svc *Service
	log *slog.Logger
}

func NewHandlers(svc *Service, log *slog.Logger) *Handlers {
	return &Handlers{svc: svc, log: log}
}

func (h *Handlers) Me(w http.ResponseWriter, r *http.Request) {
	user, ok := identity.UserFromContext(r.Context())
	if !ok {
		httpx.Error(w, r, h.log, httpx.Unauthorized("belum_login", "Anda belum masuk", nil))
		return
	}
	result, err := h.svc.GetContext(r.Context(), user)
	if err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, result)
}