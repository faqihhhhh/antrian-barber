package publicpage

import (
	"log/slog"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"kapsflow/internal/httpx"
)

type Handlers struct {
	svc *Service
	log *slog.Logger
}

func NewHandlers(svc *Service, log *slog.Logger) *Handlers {
	return &Handlers{svc: svc, log: log}
}

func (h *Handlers) GetOutlet(w http.ResponseWriter, r *http.Request) {
	slug := strings.ToLower(chi.URLParam(r, "slug"))
	page, err := h.svc.GetOutletPage(r.Context(), slug)
	if err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	httpx.JSON(w, http.StatusOK, page)
}

func (h *Handlers) ListOutletDirectory(w http.ResponseWriter, r *http.Request) {
	entries, err := h.svc.ListOutletDirectory(r.Context())
	if err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	w.Header().Set("Cache-Control", "public, max-age=60")
	httpx.JSON(w, http.StatusOK, entries)
}
