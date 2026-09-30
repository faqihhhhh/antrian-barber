package api

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"

	"kapsflow/internal/httpx"
	"kapsflow/internal/identity"
	"kapsflow/internal/rls"
	"kapsflow/internal/tenant"
)

func New(log *slog.Logger, pool *pgxpool.Pool, identitySvc *identity.Service, tenantSvc *tenant.Service) http.Handler {
	r := chi.NewRouter()

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

	r.Route("/v1/tenants", func(tr chi.Router) {
		tr.Use(identity.RequireAuth(identitySvc, log))
		tr.Use(rls.Middleware(pool, log))
		tr.Mount("/", tenant.Routes(tenantSvc, log))
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