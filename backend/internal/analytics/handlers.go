package analytics

import (
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

// parseRange: default 30 hari terakhir. "Hari ini" memakai WIB sebagai
// patokan; tanggal di statistik adalah tanggal lokal outlet (session_date).
func parseRange(r *http.Request) (time.Time, time.Time, error) {
	wib := time.FixedZone("WIB", 7*60*60)
	now := time.Now().In(wib)
	to := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)

	if raw := r.URL.Query().Get("to"); raw != "" {
		parsed, err := time.Parse("2006-01-02", raw)
		if err != nil {
			return time.Time{}, time.Time{}, httpx.BadRequest("tanggal_tidak_valid", "Parameter to harus berformat YYYY-MM-DD", err)
		}
		to = parsed
	}
	from := to.AddDate(0, 0, -29)
	if raw := r.URL.Query().Get("from"); raw != "" {
		parsed, err := time.Parse("2006-01-02", raw)
		if err != nil {
			return time.Time{}, time.Time{}, httpx.BadRequest("tanggal_tidak_valid", "Parameter from harus berformat YYYY-MM-DD", err)
		}
		from = parsed
	}
	if from.After(to) {
		return time.Time{}, time.Time{}, httpx.BadRequest("rentang_tidak_valid", "Tanggal from tidak boleh setelah to", nil)
	}
	if int(to.Sub(from).Hours()/24)+1 > maxRangeDays {
		return time.Time{}, time.Time{}, httpx.BadRequest("rentang_terlalu_panjang", "Rentang maksimal 93 hari", nil)
	}
	return from, to, nil
}

func (h *Handlers) Overview(w http.ResponseWriter, r *http.Request) {
	tenantID, err := uuid.Parse(chi.URLParam(r, "tenantID"))
	if err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("tenant_id_tidak_valid", "ID tenant tidak valid", err))
		return
	}
	from, to, err := parseRange(r)
	if err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	var outletFilter *uuid.UUID
	if raw := r.URL.Query().Get("outlet_id"); raw != "" {
		id, err := uuid.Parse(raw)
		if err != nil {
			httpx.Error(w, r, h.log, httpx.BadRequest("outlet_id_tidak_valid", "ID outlet tidak valid", err))
			return
		}
		outletFilter = &id
	}
	user, _ := identity.UserFromContext(r.Context())

	result, err := h.svc.Overview(r.Context(), tenantID, user.ID, from, to, outletFilter)
	if err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, result)
}

func (h *Handlers) Kapsters(w http.ResponseWriter, r *http.Request) {
	tenantID, err := uuid.Parse(chi.URLParam(r, "tenantID"))
	if err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("tenant_id_tidak_valid", "ID tenant tidak valid", err))
		return
	}
	from, to, err := parseRange(r)
	if err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	user, _ := identity.UserFromContext(r.Context())

	items, err := h.svc.Kapsters(r.Context(), tenantID, user.ID, from, to)
	if err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"from":     from.Format("2006-01-02"),
		"to":       to.Format("2006-01-02"),
		"kapsters": items,
	})
}

func (h *Handlers) Platform(w http.ResponseWriter, r *http.Request) {
	stats, err := h.svc.Platform(r.Context())
	if err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusOK, stats)
}