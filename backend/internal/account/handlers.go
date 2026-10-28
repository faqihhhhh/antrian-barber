package account

import (
	"encoding/json"
	"log/slog"
	"net/http"

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

func (h *Handlers) SetDisplayName(w http.ResponseWriter, r *http.Request) {
	user, ok := identity.UserFromContext(r.Context())
	if !ok {
		httpx.Error(w, r, h.log, httpx.Unauthorized("belum_login", "Anda belum masuk", nil))
		return
	}
	var req struct {
		DisplayName string `json:"display_name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("body_tidak_valid", "Format request tidak valid", err))
		return
	}
	displayName, err := h.svc.SetDisplayName(r.Context(), user.ID, req.DisplayName)
	if err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]string{"display_name": displayName})
}

func (h *Handlers) SetMyWorkRoles(w http.ResponseWriter, r *http.Request) {
	user, ok := identity.UserFromContext(r.Context())
	if !ok {
		httpx.Error(w, r, h.log, httpx.Unauthorized("belum_login", "Anda belum masuk", nil))
		return
	}
	tenantID, err := uuid.Parse(chi.URLParam(r, "tenantID"))
	if err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("tenant_id_tidak_valid", "ID bisnis tidak valid", err))
		return
	}
	var req struct {
		Admin   bool `json:"admin"`
		Kapster bool `json:"kapster"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("body_tidak_valid", "Format request tidak valid", err))
		return
	}
	roles, err := h.svc.SetMyWorkRoles(r.Context(), tenantID, user.ID, req.Admin, req.Kapster)
	if err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string][]string{"roles": roles})
}

func (h *Handlers) ChangePassword(w http.ResponseWriter, r *http.Request) {
	user, ok := identity.UserFromContext(r.Context())
	if !ok {
		httpx.Error(w, r, h.log, httpx.Unauthorized("belum_login", "Anda belum masuk", nil))
		return
	}
	var req struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("body_tidak_valid", "Format request tidak valid", err))
		return
	}
	if err := h.svc.ChangePassword(r.Context(), user.ID, req.CurrentPassword, req.NewPassword); err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]string{"message": "Password berhasil diubah"})
}
