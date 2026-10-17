package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/getsentry/sentry-go"
	"github.com/jackc/pgx/v5/pgxpool"

	"kapsflow/internal/api"
	"kapsflow/internal/billing"
	"kapsflow/internal/config"
	"kapsflow/internal/cryptox"
	"kapsflow/internal/identity"
	"kapsflow/internal/profile"
	"kapsflow/internal/staff"
	"kapsflow/internal/tenant"
	"kapsflow/internal/queue"
	"kapsflow/internal/midtrans"
	"kapsflow/internal/realtime"
	"kapsflow/internal/notification"
	"kapsflow/internal/webpush"
	"kapsflow/internal/review"
	"kapsflow/internal/jobs"
	"kapsflow/internal/analytics"
	"kapsflow/internal/account"
	"kapsflow/internal/publicpage"
	_ "time/tzdata"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(log); err != nil {
		log.Error("server berhenti karena error", "err", err)
		os.Exit(1)
	}
}

func run(log *slog.Logger) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if cfg.SentryDSN != "" {
		if err := sentry.Init(sentry.ClientOptions{Dsn: cfg.SentryDSN}); err != nil {
			return err
		}
		defer sentry.Flush(2 * time.Second)
		log.Info("pemantauan error Sentry aktif")
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	poolCfg, err := pgxpool.ParseConfig(cfg.AppDatabaseURL)
	if err != nil {
		return err
	}
	// Eksplisit: River menahan beberapa koneksi (listener, worker), dan tiap
	// request RLS menahan satu koneksi selama request berjalan.
	poolCfg.MaxConns = 20
	pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
	if err != nil {
		return err
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		return err
	}

	box, err := cryptox.NewBox(cfg.EncryptionKey)
	if err != nil {
		return err
	}

	if cfg.DevAutoVerifyEmail {
		log.Warn("DEV_AUTO_VERIFY aktif — semua akun baru langsung terverifikasi tanpa email. JANGAN aktifkan ini di produksi.")
	}
	mailer := identity.NewMailer(cfg.ResendAPIKey, cfg.EmailFrom, log)
	identitySvc := identity.NewService(pool, mailer, log, cfg.AppBaseURL, cfg.DevAutoVerifyEmail)
	tenantSvc := tenant.NewService(pool)
	billingSvc := billing.NewService(pool, mailer, log)
	profileSvc := profile.NewService(pool, box)
	staffSvc := staff.NewService(pool, identitySvc)
	midtransClient := midtrans.NewClient()
	hub := realtime.NewHub()
	webpushClient := webpush.NewClient(cfg.VAPIDPublicKey, cfg.VAPIDPrivateKey, cfg.VAPIDSubject)
	notifySvc := notification.NewService(pool, webpushClient, log)
	queueSvc := queue.NewService(pool, profileSvc, midtransClient, hub, notifySvc, log)
	publicSvc := publicpage.NewService(pool, profileSvc, billingSvc, queueSvc)
	reviewSvc := review.NewService(pool)
	analyticsSvc := analytics.NewService(pool)
	accountSvc := account.NewService(pool, billingSvc)
	

	jobClient, err := jobs.NewClient(pool, log, queueSvc, billingSvc)
	if err != nil {
		return err
	}
	if err := jobClient.Start(ctx); err != nil {
		return err
	}
	defer func() {
		stopCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := jobClient.Stop(stopCtx); err != nil {
			log.Error("gagal menghentikan job runner", "err", err)
		}
	}()

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           api.New(log, pool, identitySvc, tenantSvc, billingSvc, profileSvc, staffSvc, queueSvc, notifySvc, reviewSvc, analyticsSvc, accountSvc, publicSvc),
		ReadHeaderTimeout: 5 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		log.Info("server jalan", "addr", srv.Addr)
		errCh <- srv.ListenAndServe()
	}()

	select {
	case err := <-errCh:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
		return nil
	case <-ctx.Done():
		log.Info("mematikan server dengan rapi...")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return srv.Shutdown(shutdownCtx)
	}
}