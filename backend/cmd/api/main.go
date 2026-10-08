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

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := pgxpool.New(ctx, cfg.AppDatabaseURL)
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
	identitySvc := identity.NewService(pool, mailer, log, cfg.PublicBaseURL, cfg.DevAutoVerifyEmail)
	tenantSvc := tenant.NewService(pool)
	billingSvc := billing.NewService(pool)
	profileSvc := profile.NewService(pool, box)
	staffSvc := staff.NewService(pool, identitySvc)
	midtransClient := midtrans.NewClient()
	hub := realtime.NewHub()
	webpushClient := webpush.NewClient(cfg.VAPIDPublicKey, cfg.VAPIDPrivateKey, cfg.VAPIDSubject)
	notifySvc := notification.NewService(pool, webpushClient, log)
	queueSvc := queue.NewService(pool, profileSvc, midtransClient, hub, notifySvc, log)

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           api.New(log, pool, identitySvc, tenantSvc, billingSvc, profileSvc, staffSvc, queueSvc, notifySvc),
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