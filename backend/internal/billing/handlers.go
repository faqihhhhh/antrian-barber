package billing

import (
	"encoding/json"
	"io"
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

func (h *Handlers) ListPlans(w http.ResponseWriter, r *http.Request) {
	plans, err := h.svc.ListPlans(r.Context())
	if err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, plans)
}

func (h *Handlers) UpdatePlanPrice(w http.ResponseWriter, r *http.Request) {
	var req struct {
		PriceRupiah int64 `json:"price_rupiah"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("body_tidak_valid", "Format request tidak valid", err))
		return
	}
	plan, err := h.svc.UpdatePlanPrice(r.Context(), chi.URLParam(r, "planCode"), req.PriceRupiah)
	if err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, plan)
}

type subscribeRequest struct {
	PlanCode      string `json:"plan_code"`
	PaymentMethod string `json:"payment_method"`
}

func (h *Handlers) Subscribe(w http.ResponseWriter, r *http.Request) {
	tenantID, err := uuid.Parse(chi.URLParam(r, "tenantID"))
	if err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("tenant_id_tidak_valid", "ID tenant tidak valid", err))
		return
	}
	var req subscribeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("body_tidak_valid", "Format request tidak valid", err))
		return
	}
	invoice, err := h.svc.Subscribe(r.Context(), tenantID, req.PlanCode, req.PaymentMethod)
	if err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, invoice)
}

func (h *Handlers) GetOwnerPaymentOptions(w http.ResponseWriter, r *http.Request) {
	tenantID, err := uuid.Parse(chi.URLParam(r, "tenantID"))
	if err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("tenant_id_tidak_valid", "ID tenant tidak valid", err))
		return
	}
	options, err := h.svc.OwnerPaymentOptions(r.Context(), tenantID)
	if err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, options)
}

func (h *Handlers) GetOwnerManualQRIS(w http.ResponseWriter, r *http.Request) {
	tenantID, err := uuid.Parse(chi.URLParam(r, "tenantID"))
	if err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("tenant_id_tidak_valid", "ID tenant tidak valid", err))
		return
	}
	data, contentType, err := h.svc.GetOwnerPlatformManualQRIS(r.Context(), tenantID)
	if err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "private, no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

func (h *Handlers) GetPlatformPaymentInfo(w http.ResponseWriter, r *http.Request) {
	info, err := h.svc.PlatformPaymentInfo(r.Context())
	if err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, info)
}

func (h *Handlers) SetPlatformManualQRIS(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxPlatformQRISBytes+1)
	data, err := io.ReadAll(r.Body)
	if err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("gambar_terlalu_besar", "Ukuran gambar QRIS maksimal 512 KB", err))
		return
	}
	if err := h.svc.SetPlatformManualQRIS(r.Context(), data); err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]string{"message": "QRIS manual platform tersimpan"})
}

func (h *Handlers) DeletePlatformManualQRIS(w http.ResponseWriter, r *http.Request) {
	if err := h.svc.ClearPlatformManualQRIS(r.Context()); err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]string{"message": "QRIS manual platform dihapus"})
}

func (h *Handlers) GetPlatformManualQRIS(w http.ResponseWriter, r *http.Request) {
	data, contentType, err := h.svc.GetPlatformManualQRIS(r.Context())
	if err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "private, no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

func (h *Handlers) GetSubscription(w http.ResponseWriter, r *http.Request) {
	tenantID, err := uuid.Parse(chi.URLParam(r, "tenantID"))
	if err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("tenant_id_tidak_valid", "ID tenant tidak valid", err))
		return
	}
	info, err := h.svc.GetOwnerStatus(r.Context(), tenantID)
	if err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, info)
}

func (h *Handlers) ListInvoices(w http.ResponseWriter, r *http.Request) {
	tenantID, err := uuid.Parse(chi.URLParam(r, "tenantID"))
	if err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("tenant_id_tidak_valid", "ID tenant tidak valid", err))
		return
	}
	invoices, err := h.svc.ListInvoices(r.Context(), tenantID)
	if err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, invoices)
}

func (h *Handlers) ListPendingInvoicesAdmin(w http.ResponseWriter, r *http.Request) {
	invoices, err := h.svc.ListPendingInvoices(r.Context())
	if err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, invoices)
}

func (h *Handlers) ConfirmInvoice(w http.ResponseWriter, r *http.Request) {
	invoiceID, err := uuid.Parse(chi.URLParam(r, "invoiceID"))
	if err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("invoice_id_tidak_valid", "ID invoice tidak valid", err))
		return
	}
	admin, _ := identity.UserFromContext(r.Context())

	if err := h.svc.ConfirmInvoicePayment(r.Context(), invoiceID, admin.ID); err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]string{"message": "Invoice dikonfirmasi lunas, langganan diperpanjang"})
}
