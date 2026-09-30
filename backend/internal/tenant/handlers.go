package tenant

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

type createTenantRequest struct {
	Name string `json:"name"`
}

func (h *Handlers) CreateTenant(w http.ResponseWriter, r *http.Request) {
	user, _ := identity.UserFromContext(r.Context())

	var req createTenantRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("body_tidak_valid", "Format request tidak valid", err))
		return
	}
	if req.Name == "" {
		httpx.Error(w, r, h.log, httpx.BadRequest("nama_wajib_diisi", "Nama bisnis wajib diisi", nil))
		return
	}

	t, err := h.svc.CreateTenant(r.Context(), user.ID, req.Name)
	if err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, t)
}

func (h *Handlers) ListTenants(w http.ResponseWriter, r *http.Request) {
	tenants, err := h.svc.ListTenants(r.Context())
	if err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, tenants)
}

type createOutletRequest struct {
	Name     string `json:"name"`
	Timezone string `json:"timezone"`
	Address  string `json:"address"`
}

func (h *Handlers) CreateOutlet(w http.ResponseWriter, r *http.Request) {
	tenantID, err := uuid.Parse(chi.URLParam(r, "tenantID"))
	if err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("tenant_id_tidak_valid", "ID tenant tidak valid", err))
		return
	}

	var req createOutletRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("body_tidak_valid", "Format request tidak valid", err))
		return
	}
	if req.Name == "" || req.Timezone == "" {
		httpx.Error(w, r, h.log, httpx.BadRequest("field_wajib_diisi", "Nama dan zona waktu wajib diisi", nil))
		return
	}

	outlet, err := h.svc.CreateOutlet(r.Context(), tenantID, req.Name, req.Timezone, req.Address)
	if err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, outlet)
}

func (h *Handlers) ListOutlets(w http.ResponseWriter, r *http.Request) {
	tenantID, err := uuid.Parse(chi.URLParam(r, "tenantID"))
	if err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("tenant_id_tidak_valid", "ID tenant tidak valid", err))
		return
	}
	outlets, err := h.svc.ListOutlets(r.Context(), tenantID)
	if err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, outlets)
}