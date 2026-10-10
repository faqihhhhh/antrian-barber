package jobs

import (
	"context"
	"log/slog"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"

	"kapsflow/internal/billing"
	"kapsflow/internal/queue"
)

// MaxAttempts 1: job periodik tidak perlu di-retry bertumpuk, karena putaran
// berikutnya otomatis mengerjakan hal yang sama (semua job idempoten).

type ExpirePaymentsArgs struct{}

func (ExpirePaymentsArgs) Kind() string                  { return "expire_stale_payments" }
func (ExpirePaymentsArgs) InsertOpts() river.InsertOpts { return river.InsertOpts{MaxAttempts: 1} }

type ExpirePaymentsWorker struct {
	river.WorkerDefaults[ExpirePaymentsArgs]
	queueSvc *queue.Service
	log      *slog.Logger
}

func (w *ExpirePaymentsWorker) Work(ctx context.Context, job *river.Job[ExpirePaymentsArgs]) error {
	n, err := w.queueSvc.ExpireStalePayments(ctx)
	if err != nil {
		return err
	}
	if n > 0 {
		w.log.Info("pesanan kedaluwarsa dibatalkan", "jumlah", n)
	}
	return nil
}

type ExpireInvoicesArgs struct{}

func (ExpireInvoicesArgs) Kind() string                  { return "expire_stale_invoices" }
func (ExpireInvoicesArgs) InsertOpts() river.InsertOpts { return river.InsertOpts{MaxAttempts: 1} }

type ExpireInvoicesWorker struct {
	river.WorkerDefaults[ExpireInvoicesArgs]
	billingSvc *billing.Service
	log        *slog.Logger
}

func (w *ExpireInvoicesWorker) Work(ctx context.Context, job *river.Job[ExpireInvoicesArgs]) error {
	n, err := w.billingSvc.ExpireStaleInvoices(ctx)
	if err != nil {
		return err
	}
	if n > 0 {
		w.log.Info("invoice langganan kedaluwarsa", "jumlah", n)
	}
	return nil
}

type RenewalRemindersArgs struct{}

func (RenewalRemindersArgs) Kind() string                  { return "send_renewal_reminders" }
func (RenewalRemindersArgs) InsertOpts() river.InsertOpts { return river.InsertOpts{MaxAttempts: 1} }

type RenewalRemindersWorker struct {
	river.WorkerDefaults[RenewalRemindersArgs]
	billingSvc *billing.Service
	log        *slog.Logger
}

func (w *RenewalRemindersWorker) Work(ctx context.Context, job *river.Job[RenewalRemindersArgs]) error {
	n, err := w.billingSvc.SendRenewalReminders(ctx)
	if err != nil {
		return err
	}
	if n > 0 {
		w.log.Info("pengingat perpanjangan terkirim", "jumlah", n)
	}
	return nil
}

func every(d time.Duration, args river.JobArgs) *river.PeriodicJob {
	return river.NewPeriodicJob(
		river.PeriodicInterval(d),
		func() (river.JobArgs, *river.InsertOpts) { return args, nil },
		&river.PeriodicJobOpts{RunOnStart: true},
	)
}

func NewClient(pool *pgxpool.Pool, log *slog.Logger, queueSvc *queue.Service, billingSvc *billing.Service) (*river.Client[pgx.Tx], error) {
	workers := river.NewWorkers()
	river.AddWorker(workers, &ExpirePaymentsWorker{queueSvc: queueSvc, log: log})
	river.AddWorker(workers, &ExpireInvoicesWorker{billingSvc: billingSvc, log: log})
	river.AddWorker(workers, &RenewalRemindersWorker{billingSvc: billingSvc, log: log})

	// Log internal River hanya WARN ke atas; log kita sendiri tetap INFO.
	riverLog := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelWarn}))

	return river.NewClient(riverpgxv5.New(pool), &river.Config{
		Logger: riverLog,
		Queues: map[string]river.QueueConfig{
			river.QueueDefault: {MaxWorkers: 5},
		},
		Workers:         workers,
		SoftStopTimeout: 10 * time.Second,
		// Reindexer menjalankan REINDEX INDEX CONCURRENTLY yang butuh kepemilikan
		// indeks, sedangkan kapsflow_app bukan pemilik. Dimatikan.
		ReindexerSchedule: river.NeverSchedule(),
		PeriodicJobs: []*river.PeriodicJob{
			every(1*time.Minute, ExpirePaymentsArgs{}),
			every(10*time.Minute, ExpireInvoicesArgs{}),
			every(1*time.Hour, RenewalRemindersArgs{}),
		},
	})
}