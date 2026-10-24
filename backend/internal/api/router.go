package api

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"

	"kapsflow/internal/account"
	"kapsflow/internal/analytics"
	"kapsflow/internal/billing"
	"kapsflow/internal/httpx"
	"kapsflow/internal/identity"
	"kapsflow/internal/notification"
	"kapsflow/internal/profile"
	"kapsflow/internal/publicpage"
	"kapsflow/internal/queue"
	"kapsflow/internal/review"
	"kapsflow/internal/rls"
	"kapsflow/internal/staff"
	"kapsflow/internal/tenant"
)

func New(
	log *slog.Logger,
	pool *pgxpool.Pool,
	identitySvc *identity.Service,
	tenantSvc *tenant.Service,
	billingSvc *billing.Service,
	profileSvc *profile.Service,
	staffSvc *staff.Service,
	queueSvc *queue.Service,
	notifySvc *notification.Service,
	reviewSvc *review.Service,
	analyticsSvc *analytics.Service,
	accountSvc *account.Service,
	publicSvc *publicpage.Service,
) http.Handler {
	r := chi.NewRouter()

	r.Use(securityHeaders)
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(httpx.Recoverer(log))
	r.Use(httpx.RequestLogger(log))

	r.NotFound(func(w http.ResponseWriter, req *http.Request) {
		httpx.Error(w, req, log, httpx.NotFound("route_not_found", "Alamat tidak ditemukan", nil))
	})
	r.MethodNotAllowed(func(w http.ResponseWriter, req *http.Request) {
		httpx.Error(w, req, log, httpx.BadRequest("method_not_allowed", "Metode tidak diizinkan untuk alamat ini", nil))
	})

	r.Get("/healthz", healthHandler(log, pool))
	r.Mount("/v1/auth", identity.Routes(identitySvc, log))
	r.Route("/v1/webhooks", func(wr chi.Router) {
		queue.RegisterWebhookRoutes(wr, queueSvc, billingSvc, log, pool)
	})

	r.Route("/v1/public", func(pr chi.Router) {
		queue.RegisterPublicRoutes(pr, queueSvc, log)
		publicpage.RegisterRoutes(pr, publicSvc, log)
	})

	r.Route("/v1/plans", func(pr chi.Router) {
		billing.RegisterPublicRoutes(pr, billingSvc, log)
	})

	r.Route("/v1/tenants", func(tr chi.Router) {
		tr.Use(identity.RequireAuth(identitySvc, log))
		tr.Use(rls.Middleware(pool, log))
		requireActive := billing.RequireActiveSubscription(billingSvc, log)
		tenant.RegisterRoutes(tr, tenantSvc, log, requireActive)
		billing.RegisterTenantRoutes(tr, billingSvc, log)
		profile.RegisterRoutes(tr, profileSvc, log, requireActive)
		staff.RegisterRoutes(tr, staffSvc, log, requireActive)
		queue.RegisterRoutes(tr, queueSvc, log, pool, requireActive)
		notification.RegisterRoutes(tr, notifySvc, log)
		review.RegisterRoutes(tr, reviewSvc, log)
		analytics.RegisterTenantRoutes(tr, analyticsSvc, log)
	})

	r.Route("/v1/admin", func(ar chi.Router) {
		ar.Use(identity.RequireAuth(identitySvc, log))
		ar.Use(rls.Middleware(pool, log))
		ar.Use(billing.RequirePlatformAdmin(billingSvc, log))
		billing.RegisterAdminRoutes(ar, billingSvc, log)
		analytics.RegisterAdminRoutes(ar, analyticsSvc, log)
	})

	r.Route("/v1/me", func(mr chi.Router) {
		mr.Use(identity.RequireAuth(identitySvc, log))
		mr.Use(rls.Middleware(pool, log))
		account.RegisterRoutes(mr, accountSvc, log)
		queue.RegisterMeRoutes(mr, queueSvc, log)
	})

	return r
}

func healthHandler(log *slog.Logger, pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := pool.Ping(ctx); err != nil {
			httpx.Error(w, r, log, httpx.ServiceUnavailable("db_unavailable", "Database tidak terhubung", err))
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]string{"status": "ok"})
	}
}
