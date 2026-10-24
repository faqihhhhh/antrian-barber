package queue

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"context"
	"github.com/jackc/pgx/v5/pgxpool"
	"kapsflow/internal/billing"
	"kapsflow/internal/httpx"
	"kapsflow/internal/identity"
	"kapsflow/internal/rls"
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

func (h *Handlers) CloseQueueSession(w http.ResponseWriter, r *http.Request) {
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
	session, err := h.svc.CloseQueueSession(r.Context(), tenantID, sessionID, user.ID)
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

func (h *Handlers) ListPendingManualPayments(w http.ResponseWriter, r *http.Request) {
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
	payments, err := h.svc.ListPendingManualPayments(r.Context(), tenantID, sessionID, user.ID)
	if err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, payments)
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

type bookOnlineRequest struct {
	SessionDate  string `json:"session_date"`
	CustomerName string `json:"customer_name"`
}

func (h *Handlers) BookOnline(w http.ResponseWriter, r *http.Request) {
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
	var req bookOnlineRequest
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

	result, err := h.svc.BookOnline(r.Context(), tenantID, outletID, user.ID, date, req.CustomerName)
	if err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, result)
}

func (h *Handlers) RecheckPayment(w http.ResponseWriter, r *http.Request) {
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
	payment, err := h.svc.RecheckPayment(r.Context(), tenantID, ticketID)
	if err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	// Hanya status. Baris database mentah tidak perlu sampai ke pelanggan.
	httpx.JSON(w, http.StatusOK, map[string]string{"status": payment.Status})
}

func (h *Handlers) ConfirmManualPayment(w http.ResponseWriter, r *http.Request) {
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
	user, _ := identity.UserFromContext(r.Context())
	if err := h.svc.ConfirmManualPayment(r.Context(), tenantID, ticketID, user.ID); err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]string{"message": "Pembayaran DP dikonfirmasi, tiket masuk antrian"})
}

func (h *Handlers) ListAwaitingSettlement(w http.ResponseWriter, r *http.Request) {
	sessionID, err := param(r, "sessionID")
	if err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("session_id_tidak_valid", "ID sesi tidak valid", err))
		return
	}
	tickets, err := h.svc.ListAwaitingSettlement(r.Context(), sessionID)
	if err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, tickets)
}

type confirmFinalPaymentRequest struct {
	TotalAmountRupiah int64 `json:"total_amount_rupiah"`
}

func (h *Handlers) ConfirmFinalPayment(w http.ResponseWriter, r *http.Request) {
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
	var req confirmFinalPaymentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("body_tidak_valid", "Format request tidak valid", err))
		return
	}
	user, _ := identity.UserFromContext(r.Context())
	if err := h.svc.ConfirmFinalPayment(r.Context(), tenantID, ticketID, user.ID, req.TotalAmountRupiah); err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]string{"message": "Pelunasan dikonfirmasi"})
}

// --- Webhook publik (tanpa autentikasi pengguna) ---

type WebhookHandlers struct {
	svc        *Service
	billingSvc *billing.Service
	log        *slog.Logger
	pool       *pgxpool.Pool
}

func NewWebhookHandlers(svc *Service, billingSvc *billing.Service, log *slog.Logger, pool *pgxpool.Pool) *WebhookHandlers {
	return &WebhookHandlers{svc: svc, billingSvc: billingSvc, log: log, pool: pool}
}

type midtransNotification struct {
	OrderID           string `json:"order_id"`
	StatusCode        string `json:"status_code"`
	GrossAmount       string `json:"gross_amount"`
	SignatureKey      string `json:"signature_key"`
	TransactionStatus string `json:"transaction_status"`
	FraudStatus       string `json:"fraud_status"`
}

func (h *WebhookHandlers) Midtrans(w http.ResponseWriter, r *http.Request) {
	var payload midtransNotification
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("body_tidak_valid", "Format notifikasi tidak valid", err))
		return
	}

	err := rls.RunAsSystem(r.Context(), h.pool, func(ctx context.Context) error {
		if strings.HasPrefix(payload.OrderID, "tw-sub-") {
			return h.billingSvc.ProcessMidtransWebhook(ctx, payload.OrderID, payload.StatusCode, payload.GrossAmount, payload.SignatureKey, payload.TransactionStatus, payload.FraudStatus)
		}
		return h.svc.ProcessMidtransWebhook(ctx, payload.OrderID, payload.StatusCode, payload.GrossAmount, payload.SignatureKey, payload.TransactionStatus, payload.FraudStatus)
	})
	if err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func writeSSEEvent(w http.ResponseWriter, v any) {
	payload, _ := json.Marshal(v)
	fmt.Fprintf(w, "data: %s\n\n", payload)
}

func (h *Handlers) Stream(w http.ResponseWriter, r *http.Request) {
	sessionID, err := param(r, "sessionID")
	if err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("session_id_tidak_valid", "ID sesi tidak valid", err))
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		httpx.Error(w, r, h.log, httpx.Internal(fmt.Errorf("streaming tidak didukung di lingkungan ini")))
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)

	ch := h.svc.SubscribeSnapshot(sessionID.String())
	defer h.svc.UnsubscribeSnapshot(sessionID.String(), ch)

	if snap, err := h.svc.GetPublicSnapshot(r.Context(), sessionID); err == nil {
		writeSSEEvent(w, snap)
		flusher.Flush()
	}

	ticker := time.NewTicker(25 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case payload, ok := <-ch:
			if !ok {
				return
			}
			fmt.Fprintf(w, "data: %s\n\n", payload)
			flusher.Flush()
		case <-ticker.C:
			fmt.Fprint(w, ": keep-alive\n\n")
			flusher.Flush()
		case <-r.Context().Done():
			return
		}
	}
}

func (h *Handlers) EstimateTicketWait(w http.ResponseWriter, r *http.Request) {
	ticketID, err := param(r, "ticketID")
	if err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("ticket_id_tidak_valid", "ID tiket tidak valid", err))
		return
	}
	result, err := h.svc.EstimateTicketWait(r.Context(), ticketID)
	if err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, result)
}

func (h *Handlers) MyTickets(w http.ResponseWriter, r *http.Request) {
	user, _ := identity.UserFromContext(r.Context())
	items, err := h.svc.MyTickets(r.Context(), user.ID)
	if err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, items)
}

func (h *Handlers) MyQRISImage(w http.ResponseWriter, r *http.Request) {
	ticketID, err := param(r, "ticketID")
	if err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("ticket_id_tidak_valid", "ID tiket tidak valid", err))
		return
	}
	contentType, data, err := h.svc.ManualQRISImage(r.Context(), ticketID)
	if err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}
