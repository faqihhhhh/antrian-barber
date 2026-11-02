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

func (h *Handlers) CreateInvitationLink(w http.ResponseWriter, r *http.Request) {
	tenantID, err := uuid.Parse(chi.URLParam(r, "tenantID"))
	if err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("tenant_id_tidak_valid", "ID tenant tidak valid", err))
		return
	}
	link, err := h.svc.CreateInvitationLink(r.Context(), tenantID)
	if err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, link)
}

func (h *Handlers) ListInvitationLinks(w http.ResponseWriter, r *http.Request) {
	tenantID, err := uuid.Parse(chi.URLParam(r, "tenantID"))
	if err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("tenant_id_tidak_valid", "ID tenant tidak valid", err))
		return
	}
	links, err := h.svc.ListInvitationLinks(r.Context(), tenantID)
	if err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, links)
}

func (h *Handlers) RevokeInvitationLink(w http.ResponseWriter, r *http.Request) {
	tenantID, err := uuid.Parse(chi.URLParam(r, "tenantID"))
	if err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("tenant_id_tidak_valid", "ID tenant tidak valid", err))
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "invitationID"))
	if err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("undangan_id_tidak_valid", "ID undangan tidak valid", err))
		return
	}
	if err := h.svc.RevokeInvitationLink(r.Context(), tenantID, id); err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]string{"message": "Link undangan dicabut"})
}

func (h *Handlers) LookupInvitation(w http.ResponseWriter, r *http.Request) {
	info, err := h.svc.LookupInvitation(r.Context(), r.URL.Query().Get("token"))
	if err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, info)
}

func (h *Handlers) ApplyForStaff(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("body_tidak_valid", "Format request tidak valid", err))
		return
	}
	application, err := h.svc.ApplyForStaff(r.Context(), req.Token)
	if err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, application)
}

func (h *Handlers) ListApplications(w http.ResponseWriter, r *http.Request) {
	tenantID, err := uuid.Parse(chi.URLParam(r, "tenantID"))
	if err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("tenant_id_tidak_valid", "ID tenant tidak valid", err))
		return
	}
	items, err := h.svc.ListPendingApplications(r.Context(), tenantID)
	if err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, items)
}

func (h *Handlers) ReviewApplication(w http.ResponseWriter, r *http.Request) {
	tenantID, err := uuid.Parse(chi.URLParam(r, "tenantID"))
	if err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("tenant_id_tidak_valid", "ID tenant tidak valid", err))
		return
	}
	applicationID, err := uuid.Parse(chi.URLParam(r, "applicationID"))
	if err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("pengajuan_id_tidak_valid", "ID pengajuan tidak valid", err))
		return
	}
	var req struct {
		Roles     []string `json:"roles"`
		OutletIDs []string `json:"outlet_ids"`
	}
	approve := chi.URLParam(r, "decision") == "approve"
	if approve {
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httpx.Error(w, r, h.log, httpx.BadRequest("body_tidak_valid", "Format request tidak valid", err))
			return
		}
	}
	outletIDs := make([]uuid.UUID, 0, len(req.OutletIDs))
	for _, raw := range req.OutletIDs {
		id, err := uuid.Parse(raw)
		if err != nil {
			httpx.Error(w, r, h.log, httpx.BadRequest("outlet_id_tidak_valid", "ID outlet tidak valid", err))
			return
		}
		outletIDs = append(outletIDs, id)
	}
	if err := h.svc.ReviewApplication(r.Context(), tenantID, applicationID, approve, req.Roles, outletIDs); err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	message := "Pengajuan ditolak"
	if approve {
		message = "Staf disetujui dan akses sudah diberikan"
	}
	httpx.JSON(w, http.StatusOK, map[string]string{"message": message})
}
