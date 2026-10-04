package queue

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

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

type createQueueSessionRequest struct {
	SessionDate string `json:"session_date"` // format: 2026-10-05
	MaxQuota    int32  `json:"max_quota"`
}

func (h *Handlers) CreateQueueSession(w http.ResponseWriter, r *http.Request) {
	tenantID, err := param(r, "tenantID")
	if err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("tenant_id_tidak_valid", "ID tenant tidak valid", err))
		return
	}
	outletID, err := param(r, "outletID")
	if err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("outlet_id_tidak_valid", "ID outlet tidak valid", err))
		return
	}
	var req createQueueSessionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("body_tidak_valid", "Format request tidak valid", err))
		return
	}
	date, err := time.Parse("2006-01-02", req.SessionDate)
	if err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("tanggal_tidak_valid", "Format tanggal harus YYYY-MM-DD", err))
		return
	}
	user, _ := identity.UserFromContext(r.Context())

	session, err := h.svc.OpenQueueSession(r.Context(), tenantID, outletID, user.ID, date, req.MaxQuota)
	if err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, session)
}

func (h *Handlers) ListQueueSessions(w http.ResponseWriter, r *http.Request) {
	outletID, err := param(r, "outletID")
	if err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("outlet_id_tidak_valid", "ID outlet tidak valid", err))
		return
	}
	sessions, err := h.svc.ListQueueSessions(r.Context(), outletID)
	if err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, sessions)
}

type increaseQuotaRequest struct {
	By int32 `json:"by"`
}

func (h *Handlers) IncreaseQuota(w http.ResponseWriter, r *http.Request) {
	tenantID, err := param(r, "tenantID")
	if err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("tenant_id_tidak_valid", "ID tenant tidak valid", err))
		return
	}
	sessionID, err := param(r, "sessionID")
	if err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("session_id_tidak_valid", "ID sesi tidak valid", err))
		return
	}
	var req increaseQuotaRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("body_tidak_valid", "Format request tidak valid", err))
		return
	}
	user, _ := identity.UserFromContext(r.Context())

	session, err := h.svc.IncreaseQuota(r.Context(), tenantID, sessionID, user.ID, req.By)
	if err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, session)
}

type addOfflineTicketRequest struct {
	CustomerName string `json:"customer_name"`
}

func (h *Handlers) AddOfflineTicket(w http.ResponseWriter, r *http.Request) {
	tenantID, err := param(r, "tenantID")
	if err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("tenant_id_tidak_valid", "ID tenant tidak valid", err))
		return
	}
	sessionID, err := param(r, "sessionID")
	if err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("session_id_tidak_valid", "ID sesi tidak valid", err))
		return
	}
	var req addOfflineTicketRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("body_tidak_valid", "Format request tidak valid", err))
		return
	}
	user, _ := identity.UserFromContext(r.Context())

	ticket, err := h.svc.AddOfflineTicket(r.Context(), tenantID, sessionID, user.ID, req.CustomerName)
	if err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, ticket)
}

func (h *Handlers) ListTickets(w http.ResponseWriter, r *http.Request) {
	sessionID, err := param(r, "sessionID")
	if err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("session_id_tidak_valid", "ID sesi tidak valid", err))
		return
	}
	tickets, err := h.svc.ListTickets(r.Context(), sessionID)
	if err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, tickets)
}

func (h *Handlers) ListKapsterStates(w http.ResponseWriter, r *http.Request) {
	sessionID, err := param(r, "sessionID")
	if err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("session_id_tidak_valid", "ID sesi tidak valid", err))
		return
	}
	states, err := h.svc.ListKapsterStates(r.Context(), sessionID)
	if err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, states)
}

func (h *Handlers) Ready(w http.ResponseWriter, r *http.Request) {
	tenantID, err := param(r, "tenantID")
	if err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("tenant_id_tidak_valid", "ID tenant tidak valid", err))
		return
	}
	sessionID, err := param(r, "sessionID")
	if err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("session_id_tidak_valid", "ID sesi tidak valid", err))
		return
	}
	user, _ := identity.UserFromContext(r.Context())

	ticket, err := h.svc.KapsterReady(r.Context(), tenantID, sessionID, user.ID)
	if err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	if ticket == nil {
		httpx.JSON(w, http.StatusOK, map[string]string{"message": "Siap — antrian masih kosong, menunggu pelanggan berikutnya"})
		return
	}
	httpx.JSON(w, http.StatusOK, ticket)
}

func (h *Handlers) Start(w http.ResponseWriter, r *http.Request) {
	tenantID, err := param(r, "tenantID")
	if err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("tenant_id_tidak_valid", "ID tenant tidak valid", err))
		return
	}
	sessionID, err := param(r, "sessionID")
	if err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("session_id_tidak_valid", "ID sesi tidak valid", err))
		return
	}
	user, _ := identity.UserFromContext(r.Context())

	if err := h.svc.KapsterStart(r.Context(), tenantID, sessionID, user.ID); err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]string{"message": "Pemotongan dimulai"})
}

func (h *Handlers) Skip(w http.ResponseWriter, r *http.Request) {
	tenantID, err := param(r, "tenantID")
	if err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("tenant_id_tidak_valid", "ID tenant tidak valid", err))
		return
	}
	sessionID, err := param(r, "sessionID")
	if err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("session_id_tidak_valid", "ID sesi tidak valid", err))
		return
	}
	user, _ := identity.UserFromContext(r.Context())

	ticket, err := h.svc.KapsterSkip(r.Context(), tenantID, sessionID, user.ID)
	if err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	if ticket == nil {
		httpx.JSON(w, http.StatusOK, map[string]string{"message": "Pelanggan dilewati — tidak ada pelanggan lain yang menunggu"})
		return
	}
	httpx.JSON(w, http.StatusOK, ticket)
}

func (h *Handlers) Complete(w http.ResponseWriter, r *http.Request) {
	tenantID, err := param(r, "tenantID")
	if err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("tenant_id_tidak_valid", "ID tenant tidak valid", err))
		return
	}
	sessionID, err := param(r, "sessionID")
	if err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("session_id_tidak_valid", "ID sesi tidak valid", err))
		return
	}
	user, _ := identity.UserFromContext(r.Context())

	if err := h.svc.KapsterComplete(r.Context(), tenantID, sessionID, user.ID); err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]string{"message": "Selesai — pelanggan masuk daftar konfirmasi pembayaran"})
}