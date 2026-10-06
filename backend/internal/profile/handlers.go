package profile

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

func (h *Handlers) GetProfile(w http.ResponseWriter, r *http.Request) {
	tenantID, err := uuid.Parse(chi.URLParam(r, "tenantID"))
	if err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("tenant_id_tidak_valid", "ID tenant tidak valid", err))
		return
	}
	info, err := h.svc.GetProfile(r.Context(), tenantID)
	if err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, info)
}

type setMidtransRequest struct {
	ServerKey    string `json:"server_key"`
	ClientKey    string `json:"client_key"`
	IsProduction bool   `json:"is_production"`
}

func (h *Handlers) SetMidtrans(w http.ResponseWriter, r *http.Request) {
	tenantID, err := uuid.Parse(chi.URLParam(r, "tenantID"))
	if err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("tenant_id_tidak_valid", "ID tenant tidak valid", err))
		return
	}
	var req setMidtransRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("body_tidak_valid", "Format request tidak valid", err))
		return
	}
		if err := h.svc.SetMidtransKeys(r.Context(), tenantID, req.ServerKey, req.ClientKey, req.IsProduction); err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]string{"message": "Kunci Midtrans tersimpan"})
}

func (h *Handlers) SkipMidtrans(w http.ResponseWriter, r *http.Request) {
	tenantID, err := uuid.Parse(chi.URLParam(r, "tenantID"))
	if err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("tenant_id_tidak_valid", "ID tenant tidak valid", err))
		return
	}
	if err := h.svc.SkipMidtransForNow(r.Context(), tenantID); err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]string{
		"message": "Baik, tim kami akan menghubungi Anda untuk memandu pembuatan akun Midtrans.",
	})
}