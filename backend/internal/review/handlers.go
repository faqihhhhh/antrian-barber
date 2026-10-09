package review

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

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

func param(r *http.Request, name string) (uuid.UUID, error) {
	return uuid.Parse(chi.URLParam(r, name))
}

type submitRequest struct {
	Rating  int16  `json:"rating"`
	Comment string `json:"comment"`
}

func (h *Handlers) Submit(w http.ResponseWriter, r *http.Request) {
	tenantID, err := param(r, "tenantID")
	if err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("tenant_id_tidak_valid", "ID tenant tidak valid", err))
		return
	}
	ticketID, err := param(r, "ticketID")
	if err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("ticket_id_tidak_valid", "ID tiket tidak valid", err))
		return
	}
	var req submitRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("body_tidak_valid", "Format request tidak valid", err))
		return
	}
	user, _ := identity.UserFromContext(r.Context())

	rv, err := h.svc.Submit(r.Context(), tenantID, ticketID, user.ID, req.Rating, req.Comment)
	if err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, rv)
}

func (h *Handlers) GetOwn(w http.ResponseWriter, r *http.Request) {
	ticketID, err := param(r, "ticketID")
	if err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("ticket_id_tidak_valid", "ID tiket tidak valid", err))
		return
	}
	rv, err := h.svc.GetOwn(r.Context(), ticketID)
	if err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, rv)
}

func (h *Handlers) List(w http.ResponseWriter, r *http.Request) {
	tenantID, err := param(r, "tenantID")
	if err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("tenant_id_tidak_valid", "ID tenant tidak valid", err))
		return
	}
	var kapsterID *uuid.UUID
	if raw := r.URL.Query().Get("kapster_id"); raw != "" {
		id, err := uuid.Parse(raw)
		if err != nil {
			httpx.Error(w, r, h.log, httpx.BadRequest("kapster_id_tidak_valid", "ID kapster tidak valid", err))
			return
		}
		kapsterID = &id
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	user, _ := identity.UserFromContext(r.Context())

	items, err := h.svc.List(r.Context(), tenantID, user.ID, kapsterID, int32(limit), int32(offset))
	if err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, items)
}

func (h *Handlers) Summary(w http.ResponseWriter, r *http.Request) {
	tenantID, err := param(r, "tenantID")
	if err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("tenant_id_tidak_valid", "ID tenant tidak valid", err))
		return
	}
	user, _ := identity.UserFromContext(r.Context())

	items, err := h.svc.Summary(r.Context(), tenantID, user.ID)
	if err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, items)
}