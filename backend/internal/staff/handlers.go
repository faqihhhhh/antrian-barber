package staff

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"kapsflow/internal/httpx"
)

type Handlers struct {
	svc *Service
	log *slog.Logger
}

func NewHandlers(svc *Service, log *slog.Logger) *Handlers {
	return &Handlers{svc: svc, log: log}
}

type inviteStaffRequest struct {
	Email     string   `json:"email"`
	Password  string   `json:"password"`
	Username  string   `json:"username"`
	Roles     []string `json:"roles"`
	OutletIDs []string `json:"outlet_ids"`
}

func (h *Handlers) InviteStaff(w http.ResponseWriter, r *http.Request) {
	tenantID, err := uuid.Parse(chi.URLParam(r, "tenantID"))
	if err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("tenant_id_tidak_valid", "ID tenant tidak valid", err))
		return
	}

	var req inviteStaffRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("body_tidak_valid", "Format request tidak valid", err))
		return
	}

	outletIDs := make([]uuid.UUID, 0, len(req.OutletIDs))
	for _, raw := range req.OutletIDs {
		id, err := uuid.Parse(raw)
		if err != nil {
			httpx.Error(w, r, h.log, httpx.BadRequest("outlet_id_tidak_valid", "ID outlet tidak valid: "+raw, err))
			return
		}
		outletIDs = append(outletIDs, id)
	}

	membership, err := h.svc.InviteStaff(r.Context(), tenantID, InviteInput{
		Email: req.Email, Password: req.Password, Username: req.Username, Roles: req.Roles, OutletIDs: outletIDs,
	})
	if err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, membership)
}

func (h *Handlers) ListStaff(w http.ResponseWriter, r *http.Request) {
	tenantID, err := uuid.Parse(chi.URLParam(r, "tenantID"))
	if err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("tenant_id_tidak_valid", "ID tenant tidak valid", err))
		return
	}
	staffList, err := h.svc.ListStaff(r.Context(), tenantID)
	if err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, staffList)
}
