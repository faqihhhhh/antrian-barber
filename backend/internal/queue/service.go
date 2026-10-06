package queue

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	db "kapsflow/internal/db"
	"kapsflow/internal/dbx"
	"kapsflow/internal/httpx"
	"kapsflow/internal/pgerr"
	"kapsflow/internal/rls"

	crand "crypto/rand"
	mrand "math/rand/v2"

	"kapsflow/internal/midtrans"
	"kapsflow/internal/profile"
)


type Service struct {
	fallback       *db.Queries
	pool           *pgxpool.Pool
	profileSvc     *profile.Service
	midtransClient *midtrans.Client
}

func NewService(pool *pgxpool.Pool, profileSvc *profile.Service, midtransClient *midtrans.Client) *Service {
	return &Service{fallback: db.New(pool), pool: pool, profileSvc: profileSvc, midtransClient: midtransClient}
}

func (s *Service) queries(ctx context.Context) *db.Queries {
	if tx, ok := rls.TxFromContext(ctx); ok {
		return db.New(tx)
	}
	return s.fallback
}

func (s *Service) requireAdmin(ctx context.Context, q *db.Queries, tenantID, userID uuid.UUID) (db.Membership, error) {
	m, err := q.GetMembershipForUserAndTenant(ctx, db.GetMembershipForUserAndTenantParams{TenantID: tenantID, UserID: userID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return db.Membership{}, httpx.Forbidden("bukan_anggota_tenant", "Anda bukan anggota bisnis ini", nil)
		}
		return db.Membership{}, httpx.Internal(fmt.Errorf("ambil membership: %w", err))
	}
	if !slices.Contains(m.Roles, "admin") && !slices.Contains(m.Roles, "owner") {
		return db.Membership{}, httpx.Forbidden("bukan_admin_tenant", "Hanya admin atau owner yang bisa melakukan aksi ini", nil)
	}
	return m, nil
}

func (s *Service) requireKapster(ctx context.Context, q *db.Queries, tenantID, userID uuid.UUID) (db.Membership, error) {
	m, err := q.GetMembershipForUserAndTenant(ctx, db.GetMembershipForUserAndTenantParams{TenantID: tenantID, UserID: userID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return db.Membership{}, httpx.Forbidden("bukan_anggota_tenant", "Anda bukan anggota bisnis ini", nil)
		}
		return db.Membership{}, httpx.Internal(fmt.Errorf("ambil membership: %w", err))
	}
	if !slices.Contains(m.Roles, "kapster") {
		return db.Membership{}, httpx.Forbidden("bukan_kapster", "Hanya kapster yang bisa melakukan aksi ini", nil)
	}
	return m, nil
}

// --- Admin: sesi antrian & tiket offline ---

func (s *Service) OpenQueueSession(ctx context.Context, tenantID, outletID, userID uuid.UUID, sessionDate time.Time, maxQuota int32) (db.QueueSession, error) {
	q := s.queries(ctx)
	if _, err := s.requireAdmin(ctx, q, tenantID, userID); err != nil {
		return db.QueueSession{}, err
	}
	if maxQuota <= 0 {
		return db.QueueSession{}, httpx.BadRequest("kuota_tidak_valid", "Kuota maksimal harus lebih dari 0", nil)
	}
	session, err := q.CreateQueueSession(ctx, db.CreateQueueSessionParams{
		TenantID: tenantID, OutletID: outletID,
		SessionDate: pgtype.Date{Time: sessionDate, Valid: true},
		MaxQuota:    maxQuota, CreatedBy: userID,
	})
	if err != nil {
		if pgerr.IsUniqueViolation(err) {
			return db.QueueSession{}, httpx.Conflict("sesi_sudah_ada", "Sudah ada sesi antrian untuk outlet dan tanggal ini", nil)
		}
		return db.QueueSession{}, httpx.Internal(fmt.Errorf("membuat sesi antrian: %w", err))
	}
	return session, nil
}

func (s *Service) IncreaseQuota(ctx context.Context, tenantID, sessionID, userID uuid.UUID, by int32) (db.QueueSession, error) {
	q := s.queries(ctx)
	if _, err := s.requireAdmin(ctx, q, tenantID, userID); err != nil {
		return db.QueueSession{}, err
	}
	if by <= 0 {
		return db.QueueSession{}, httpx.BadRequest("jumlah_tidak_valid", "Jumlah tambahan kuota harus lebih dari 0", nil)
	}
	// MaxQuota di sini berarti JUMLAH TAMBAHAN, bukan total baru — lihat SQL-nya.
	session, err := q.IncreaseQueueQuota(ctx, db.IncreaseQueueQuotaParams{ID: sessionID, MaxQuota: by})
	if err != nil {
		return db.QueueSession{}, httpx.Internal(fmt.Errorf("menambah kuota: %w", err))
	}
	return session, nil
}

func (s *Service) AddOfflineTicket(ctx context.Context, tenantID, sessionID, userID uuid.UUID, customerName string) (db.Ticket, error) {
	q := s.queries(ctx)
	admin, err := s.requireAdmin(ctx, q, tenantID, userID)
	if err != nil {
		return db.Ticket{}, err
	}
	if customerName == "" {
		return db.Ticket{}, httpx.BadRequest("nama_wajib_diisi", "Nama pelanggan wajib diisi", nil)
	}

	num, err := q.ClaimNextTicketNumber(ctx, sessionID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return db.Ticket{}, httpx.Conflict("kuota_penuh", "Kuota antrian hari ini sudah penuh", nil)
		}
		return db.Ticket{}, httpx.Internal(fmt.Errorf("mengambil nomor tiket: %w", err))
	}

	ticket, err := q.CreateTicket(ctx, db.CreateTicketParams{
		TenantID: tenantID, QueueSessionID: sessionID,
		TicketNumber: num, QueuePosition: num,
		Channel:      "offline",
		CustomerName: pgtype.Text{String: customerName, Valid: true},
		MatchCode:    pgtype.Text{}, // offline tidak pakai kode
	})
	if err != nil {
		return db.Ticket{}, httpx.Internal(fmt.Errorf("membuat tiket: %w", err))
	}
	if err := q.CreateTicketEvent(ctx, db.CreateTicketEventParams{
		TenantID: tenantID, TicketID: ticket.ID, EventType: "created", ActorMembershipID: dbx.UUID(admin.ID),
	}); err != nil {
		return db.Ticket{}, httpx.Internal(fmt.Errorf("mencatat event dibuat: %w", err))
	}
	return ticket, nil
}

// --- Baca-baca ---

func (s *Service) ListQueueSessions(ctx context.Context, outletID uuid.UUID) ([]db.QueueSession, error) {
	sessions, err := s.queries(ctx).ListQueueSessionsByOutlet(ctx, outletID)
	if err != nil {
		return nil, httpx.Internal(fmt.Errorf("ambil daftar sesi: %w", err))
	}
	return httpx.NonNil(sessions), nil
}

func (s *Service) ListTickets(ctx context.Context, sessionID uuid.UUID) ([]db.Ticket, error) {
	tickets, err := s.queries(ctx).ListTicketsBySession(ctx, sessionID)
	if err != nil {
		return nil, httpx.Internal(fmt.Errorf("ambil daftar tiket: %w", err))
	}
	return httpx.NonNil(tickets), nil
}

func (s *Service) ListKapsterStates(ctx context.Context, sessionID uuid.UUID) ([]db.KapsterSessionState, error) {
	states, err := s.queries(ctx).ListKapsterStatesBySession(ctx, sessionID)
	if err != nil {
		return nil, httpx.Internal(fmt.Errorf("ambil status kapster: %w", err))
	}
	return httpx.NonNil(states), nil
}

// --- Kapster: siap, mulai, ganti, selesai ---

func (s *Service) claimTicket(ctx context.Context, q *db.Queries, tenantID, sessionID, membershipID uuid.UUID, ticket db.Ticket) error {
	if err := q.MarkTicketCalled(ctx, db.MarkTicketCalledParams{ID: ticket.ID, AssignedMembershipID: dbx.UUID(membershipID)}); err != nil {
		return httpx.Internal(fmt.Errorf("menandai tiket dipanggil: %w", err))
	}
	if err := q.CreateTicketEvent(ctx, db.CreateTicketEventParams{
		TenantID: tenantID, TicketID: ticket.ID, EventType: "called", ActorMembershipID: dbx.UUID(membershipID),
	}); err != nil {
		return httpx.Internal(fmt.Errorf("mencatat event dipanggil: %w", err))
	}
	_, err := q.UpsertKapsterSessionState(ctx, db.UpsertKapsterSessionStateParams{
		TenantID: tenantID, QueueSessionID: sessionID, MembershipID: membershipID,
		Status: "busy", CurrentTicketID: dbx.UUID(ticket.ID),
	})
	if err != nil {
		return httpx.Internal(fmt.Errorf("memperbarui status kapster: %w", err))
	}
	return nil
}

// KapsterReady adalah efek tombol "siap". Mengembalikan nil (tanpa error)
// kalau antrian sedang kosong — itu kondisi normal, bukan kegagalan.
func (s *Service) KapsterReady(ctx context.Context, tenantID, sessionID, userID uuid.UUID) (*db.Ticket, error) {
	q := s.queries(ctx)
	membership, err := s.requireKapster(ctx, q, tenantID, userID)
	if err != nil {
		return nil, err
	}

	ticket, err := q.ClaimNextWaitingTicket(ctx, sessionID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			if _, upErr := q.UpsertKapsterSessionState(ctx, db.UpsertKapsterSessionStateParams{
				TenantID: tenantID, QueueSessionID: sessionID, MembershipID: membership.ID,
				Status: "ready", CurrentTicketID: pgtype.UUID{},
			}); upErr != nil {
				return nil, httpx.Internal(fmt.Errorf("memperbarui status kapster: %w", upErr))
			}
			return nil, nil
		}
		return nil, httpx.Internal(fmt.Errorf("mengambil tiket berikutnya: %w", err))
	}

	if err := s.claimTicket(ctx, q, tenantID, sessionID, membership.ID, ticket); err != nil {
		return nil, err
	}
	return &ticket, nil
}

func (s *Service) currentTicketID(state db.KapsterSessionState) (uuid.UUID, bool) {
	if !state.CurrentTicketID.Valid {
		return uuid.UUID{}, false
	}
	return uuid.UUID(state.CurrentTicketID.Bytes), true
}

func (s *Service) KapsterStart(ctx context.Context, tenantID, sessionID, userID uuid.UUID) error {
	q := s.queries(ctx)
	membership, err := s.requireKapster(ctx, q, tenantID, userID)
	if err != nil {
		return err
	}
	state, err := q.GetKapsterSessionState(ctx, db.GetKapsterSessionStateParams{QueueSessionID: sessionID, MembershipID: membership.ID})
	if err != nil {
		return httpx.Conflict("tidak_ada_tiket_aktif", "Tidak ada pelanggan yang sedang dipanggil", nil)
	}
	ticketID, ok := s.currentTicketID(state)
	if !ok {
		return httpx.Conflict("tidak_ada_tiket_aktif", "Tidak ada pelanggan yang sedang dipanggil", nil)
	}

	if err := q.MarkTicketInProgress(ctx, ticketID); err != nil {
		return httpx.Internal(fmt.Errorf("menandai tiket dimulai: %w", err))
	}
	if err := q.CreateTicketEvent(ctx, db.CreateTicketEventParams{
		TenantID: tenantID, TicketID: ticketID, EventType: "started", ActorMembershipID: dbx.UUID(membership.ID),
	}); err != nil {
		return httpx.Internal(fmt.Errorf("mencatat event dimulai: %w", err))
	}
	return nil
}

// KapsterSkip adalah efek tombol "ganti pelanggan": tiket yang di-skip
// ditukar posisinya dengan tiket waiting berikutnya (mundur tepat 1
// antrian, sesuai spesifikasi), lalu kapster langsung mengklaim tiket baru.
func (s *Service) KapsterSkip(ctx context.Context, tenantID, sessionID, userID uuid.UUID) (*db.Ticket, error) {
	q := s.queries(ctx)
	membership, err := s.requireKapster(ctx, q, tenantID, userID)
	if err != nil {
		return nil, err
	}
	state, err := q.GetKapsterSessionState(ctx, db.GetKapsterSessionStateParams{QueueSessionID: sessionID, MembershipID: membership.ID})
	if err != nil {
		return nil, httpx.Conflict("tidak_ada_tiket_aktif", "Tidak ada pelanggan yang sedang dipanggil", nil)
	}
	currentTicketID, ok := s.currentTicketID(state)
	if !ok {
		return nil, httpx.Conflict("tidak_ada_tiket_aktif", "Tidak ada pelanggan yang sedang dipanggil", nil)
	}

	current, err := q.GetTicketForUpdate(ctx, currentTicketID)
	if err != nil {
		return nil, httpx.Internal(fmt.Errorf("mengunci tiket saat ini: %w", err))
	}

	next, err := q.NextWaitingTicketExcluding(ctx, db.NextWaitingTicketExcludingParams{QueueSessionID: sessionID, ID: currentTicketID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Tidak ada pelanggan lain menunggu — requeue di posisi semula.
			if err := q.RequeueTicket(ctx, currentTicketID); err != nil {
				return nil, httpx.Internal(fmt.Errorf("requeue tiket: %w", err))
			}
			if err := q.CreateTicketEvent(ctx, db.CreateTicketEventParams{
				TenantID: tenantID, TicketID: currentTicketID, EventType: "skipped", ActorMembershipID: dbx.UUID(membership.ID),
			}); err != nil {
				return nil, httpx.Internal(fmt.Errorf("mencatat event skip: %w", err))
			}
			if _, upErr := q.UpsertKapsterSessionState(ctx, db.UpsertKapsterSessionStateParams{
				TenantID: tenantID, QueueSessionID: sessionID, MembershipID: membership.ID,
				Status: "ready", CurrentTicketID: pgtype.UUID{},
			}); upErr != nil {
				return nil, httpx.Internal(fmt.Errorf("memperbarui status kapster: %w", upErr))
			}
			return nil, nil
		}
		return nil, httpx.Internal(fmt.Errorf("mencari tiket berikutnya: %w", err))
	}

	if err := q.SetTicketQueuePosition(ctx, db.SetTicketQueuePositionParams{ID: current.ID, QueuePosition: next.QueuePosition}); err != nil {
		return nil, httpx.Internal(fmt.Errorf("menukar posisi tiket: %w", err))
	}
	if err := q.SetTicketQueuePosition(ctx, db.SetTicketQueuePositionParams{ID: next.ID, QueuePosition: current.QueuePosition}); err != nil {
		return nil, httpx.Internal(fmt.Errorf("menukar posisi tiket: %w", err))
	}
	if err := q.RequeueTicket(ctx, current.ID); err != nil {
		return nil, httpx.Internal(fmt.Errorf("requeue tiket: %w", err))
	}
	if err := q.CreateTicketEvent(ctx, db.CreateTicketEventParams{
		TenantID: tenantID, TicketID: current.ID, EventType: "skipped", ActorMembershipID: dbx.UUID(membership.ID),
	}); err != nil {
		return nil, httpx.Internal(fmt.Errorf("mencatat event skip: %w", err))
	}

	if err := s.claimTicket(ctx, q, tenantID, sessionID, membership.ID, next); err != nil {
		return nil, err
	}
	return &next, nil
}

func (s *Service) KapsterComplete(ctx context.Context, tenantID, sessionID, userID uuid.UUID) error {
	q := s.queries(ctx)
	membership, err := s.requireKapster(ctx, q, tenantID, userID)
	if err != nil {
		return err
	}
	state, err := q.GetKapsterSessionState(ctx, db.GetKapsterSessionStateParams{QueueSessionID: sessionID, MembershipID: membership.ID})
	if err != nil {
		return httpx.Conflict("tidak_ada_tiket_aktif", "Tidak ada pelanggan yang sedang dikerjakan", nil)
	}
	ticketID, ok := s.currentTicketID(state)
	if !ok {
		return httpx.Conflict("tidak_ada_tiket_aktif", "Tidak ada pelanggan yang sedang dikerjakan", nil)
	}

	if err := q.MarkTicketCompleted(ctx, ticketID); err != nil {
		return httpx.Internal(fmt.Errorf("menandai tiket selesai: %w", err))
	}
	if err := q.CreateTicketEvent(ctx, db.CreateTicketEventParams{
		TenantID: tenantID, TicketID: ticketID, EventType: "completed", ActorMembershipID: dbx.UUID(membership.ID),
	}); err != nil {
		return httpx.Internal(fmt.Errorf("mencatat event selesai: %w", err))
	}
	_, err = q.UpsertKapsterSessionState(ctx, db.UpsertKapsterSessionStateParams{
		TenantID: tenantID, QueueSessionID: sessionID, MembershipID: membership.ID,
		Status: "idle", CurrentTicketID: pgtype.UUID{},
	})
	if err != nil {
		return httpx.Internal(fmt.Errorf("memperbarui status kapster: %w", err))
	}
	return nil
}

const paymentWindow = 30 * time.Minute

const matchCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // tanpa 0/O, 1/I/L yang mirip

func generateMatchCode() (string, error) {
	raw := make([]byte, 6)
	if _, err := crand.Read(raw); err != nil {
		return "", err
	}
	code := make([]byte, 6)
	for i, v := range raw {
		code[i] = matchCodeAlphabet[int(v)%len(matchCodeAlphabet)]
	}
	return string(code), nil
}

type BookingResult struct {
	Ticket        db.Ticket `json:"ticket"`
	PaymentMethod string    `json:"payment_method"`
	AmountRupiah  int64     `json:"amount_rupiah"`
	UniqueCode    int16     `json:"unique_code,omitempty"`
	QRCodeURL     string    `json:"qr_code_url,omitempty"`
}

// BookOnline adalah titik masuk pelanggan memesan tiket. Nomor tiket
// direbut lewat fungsi SECURITY DEFINER (claim_ticket_number_for_booking),
// bukan lewat UPDATE biasa — lihat catatan di chat soal kenapa.
func (s *Service) BookOnline(ctx context.Context, tenantID, outletID, customerUserID uuid.UUID, sessionDate time.Time) (*BookingResult, error) {
	q := s.queries(ctx)

	session, err := q.GetQueueSessionByOutletAndDate(ctx, db.GetQueueSessionByOutletAndDateParams{
		OutletID: outletID, SessionDate: pgtype.Date{Time: sessionDate, Valid: true},
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, httpx.NotFound("sesi_tidak_ditemukan", "Antrian untuk outlet dan tanggal ini belum dibuka", nil)
		}
		return nil, httpx.Internal(fmt.Errorf("ambil sesi antrian: %w", err))
	}

	num, err := q.ClaimTicketNumberForBooking(ctx, session.ID)
	if err != nil {
		return nil, httpx.Internal(fmt.Errorf("klaim nomor tiket: %w", err))
	}
	if num == -1 {
		return nil, httpx.Conflict("tidak_bisa_memesan", "Antrian sudah ditutup atau kuota sudah penuh", nil)
	}

	matchCode, err := generateMatchCode()
	if err != nil {
		return nil, httpx.Internal(err)
	}

	ticket, err := q.CreateOnlineTicket(ctx, db.CreateOnlineTicketParams{
		TenantID: tenantID, QueueSessionID: session.ID,
		TicketNumber: num, QueuePosition: num,
		MatchCode: pgtype.Text{String: matchCode, Valid: true},
		CustomerUserID: dbx.UUID(customerUserID),
	})
	if err != nil {
		return nil, httpx.Internal(fmt.Errorf("membuat tiket online: %w", err))
	}

	outlet, err := q.GetOutletByID(ctx, outletID)
	if err != nil {
		return nil, httpx.Internal(fmt.Errorf("ambil data outlet: %w", err))
	}
	serverKey, _, isProduction, configured, err := s.profileSvc.GetDecryptedMidtransKeys(ctx, tenantID)
	if err != nil {
		return nil, err
	}

	if configured {
		paymentID := uuid.New()
		charge, err := s.midtransClient.ChargeQRIS(ctx, serverKey, isProduction, paymentID.String(), outlet.DpPriceRupiah)
		if err != nil {
			return nil, httpx.Internal(fmt.Errorf("midtrans charge gagal: %w", err))
		}
		_, err = q.CreateTicketPayment(ctx, db.CreateTicketPaymentParams{
			ID: paymentID, TenantID: tenantID, TicketID: ticket.ID, CustomerUserID: dbx.UUID(customerUserID),
			Method: "midtrans", AmountRupiah: outlet.DpPriceRupiah,
			UniqueCode: pgtype.Int2{}, MidtransOrderID: pgtype.Text{String: charge.OrderID, Valid: true},
			ExpiresAt: dbx.TS(time.Now().Add(paymentWindow)),
		})
		if err != nil {
			return nil, httpx.Internal(fmt.Errorf("menyimpan pembayaran: %w", err))
		}
		return &BookingResult{Ticket: ticket, PaymentMethod: "midtrans", AmountRupiah: outlet.DpPriceRupiah, QRCodeURL: charge.QRCodeURL}, nil
	}

	// Mode manual: nominal unik per tenant, dikonfirmasi admin.
	for attempt := 0; attempt < 10; attempt++ {
		code := int16(1 + mrand.IntN(998))
		amount := outlet.DpPriceRupiah + int64(code)
		payment, err := q.CreateTicketPayment(ctx, db.CreateTicketPaymentParams{
			ID: uuid.New(), TenantID: tenantID, TicketID: ticket.ID, CustomerUserID: dbx.UUID(customerUserID),
			Method: "manual", AmountRupiah: amount,
			UniqueCode: pgtype.Int2{Int16: code, Valid: true}, MidtransOrderID: pgtype.Text{},
			ExpiresAt: dbx.TS(time.Now().Add(paymentWindow)),
		})
		if err == nil {
			_ = payment
			return &BookingResult{Ticket: ticket, PaymentMethod: "manual", AmountRupiah: amount, UniqueCode: code}, nil
		}
		if pgerr.IsUniqueViolation(err) {
			continue
		}
		return nil, httpx.Internal(fmt.Errorf("membuat pembayaran manual: %w", err))
	}
	return nil, httpx.Internal(fmt.Errorf("gagal menemukan nominal unik"))
}

// RecheckPayment dipanggil pelanggan (atau admin) untuk menanyakan ulang
// status ke Midtrans secara langsung — berguna untuk pengembangan lokal
// yang tidak punya URL publik untuk menerima webhook, dan juga jaring
// pengaman kalau webhook produksi suatu saat terlambat/hilang.
func (s *Service) RecheckPayment(ctx context.Context, tenantID, ticketID uuid.UUID) (db.TicketPayment, error) {
	q := s.queries(ctx)

	payment, err := q.GetTicketPaymentByTicketID(ctx, ticketID)
	if err != nil {
		return db.TicketPayment{}, httpx.NotFound("pembayaran_tidak_ditemukan", "Pembayaran tidak ditemukan", nil)
	}
	if payment.Method != "midtrans" || payment.Status != "pending" {
		return payment, nil
	}
	serverKey, _, isProduction, configured, err := s.profileSvc.GetDecryptedMidtransKeys(ctx, tenantID)
	if err != nil || !configured {
		return db.TicketPayment{}, httpx.Internal(fmt.Errorf("midtrans tidak terkonfigurasi untuk tenant ini"))
	}

	status, err := s.midtransClient.CheckStatus(ctx, serverKey, isProduction, payment.MidtransOrderID.String)
	if err != nil {
		return db.TicketPayment{}, httpx.Internal(fmt.Errorf("mengecek status midtrans: %w", err))
	}

	switch {
	case midtrans.IsPaid(status.TransactionStatus, status.FraudStatus):
		if err := s.settlePaymentPaid(ctx, q, payment); err != nil {
			return db.TicketPayment{}, err
		}
	case midtrans.IsFailed(status.TransactionStatus):
		if err := s.settlePaymentFailed(ctx, q, payment); err != nil {
			return db.TicketPayment{}, err
		}
	}
	return q.GetTicketPaymentByTicketID(ctx, ticketID)
}

func (s *Service) settlePaymentPaid(ctx context.Context, q *db.Queries, payment db.TicketPayment) error {
	if err := q.MarkTicketPaymentPaid(ctx, db.MarkTicketPaymentPaidParams{ID: payment.ID, ConfirmedBy: pgtype.UUID{}}); err != nil {
		return httpx.Internal(fmt.Errorf("menandai pembayaran lunas: %w", err))
	}
	if err := q.MarkTicketWaiting(ctx, payment.TicketID); err != nil {
		return httpx.Internal(fmt.Errorf("memasukkan tiket ke antrian: %w", err))
	}
	return nil
}

func (s *Service) settlePaymentFailed(ctx context.Context, q *db.Queries, payment db.TicketPayment) error {
	if err := q.MarkTicketPaymentFailed(ctx, payment.ID); err != nil {
		return httpx.Internal(fmt.Errorf("menandai pembayaran gagal: %w", err))
	}
	if err := q.CancelTicket(ctx, payment.TicketID); err != nil {
		return httpx.Internal(fmt.Errorf("membatalkan tiket: %w", err))
	}
	return nil
}

// ProcessMidtransWebhook dipanggil dari handler yang sudah dibungkus
// rls.RunAsSystem — TIDAK ada pengguna login di baliknya, jadi fungsi ini
// sendiri yang memvalidasi tanda tangan sebelum mempercayai apa pun di body.
func (s *Service) ProcessMidtransWebhook(ctx context.Context, orderID, statusCode, grossAmount, signature, txStatus, fraudStatus string) error {
	q := s.queries(ctx)

	paymentID, err := uuid.Parse(orderID)
	if err != nil {
		return httpx.BadRequest("order_id_tidak_valid", "order_id tidak valid", err)
	}
	payment, err := q.GetTicketPaymentByID(ctx, paymentID)
	if err != nil {
		return httpx.NotFound("pembayaran_tidak_ditemukan", "Pembayaran tidak ditemukan", nil)
	}
	
	serverKey, _, _, configured, err := s.profileSvc.GetDecryptedMidtransKeys(ctx, payment.TenantID)
	if err != nil || !configured {
		return httpx.Internal(fmt.Errorf("midtrans tidak terkonfigurasi untuk tenant %s", payment.TenantID))
	}
	if !midtrans.VerifySignature(orderID, statusCode, grossAmount, serverKey, signature) {
		return httpx.Unauthorized("tanda_tangan_tidak_valid", "Tanda tangan notifikasi tidak valid", nil)
	}

	if payment.Status != "pending" {
		return nil // notifikasi duplikat, sudah diproses — abaikan dengan tenang
	}

	switch {
	case midtrans.IsPaid(txStatus, fraudStatus):
		return s.settlePaymentPaid(ctx, q, payment)
	case midtrans.IsFailed(txStatus):
		return s.settlePaymentFailed(ctx, q, payment)
	}
	return nil
}

// --- Admin: konfirmasi DP manual & pelunasan akhir ---

func (s *Service) ConfirmManualPayment(ctx context.Context, tenantID, ticketID, adminUserID uuid.UUID) error {
	q := s.queries(ctx)
	_, err := s.requireAdmin(ctx, q, tenantID, adminUserID)
	if err != nil {
		return err
	}
	payment, err := q.GetTicketPaymentByTicketID(ctx, ticketID)
	if err != nil {
		return httpx.NotFound("pembayaran_tidak_ditemukan", "Pembayaran tidak ditemukan", nil)
	}
	if payment.Method != "manual" {
		return httpx.BadRequest("bukan_pembayaran_manual", "Pembayaran ini bukan mode manual", nil)
	}
	if payment.Status != "pending" {
		return httpx.Conflict("sudah_diproses", "Pembayaran ini sudah diproses sebelumnya", nil)
	}
	if err := q.MarkTicketPaymentPaid(ctx, db.MarkTicketPaymentPaidParams{ID: payment.ID, ConfirmedBy: dbx.UUID(adminUserID)}); err != nil {
		return httpx.Internal(fmt.Errorf("menandai pembayaran lunas: %w", err))
	}
	if err := q.MarkTicketWaiting(ctx, ticketID); err != nil {
		return httpx.Internal(fmt.Errorf("memasukkan tiket ke antrian: %w", err))
	}
	return nil
}

func (s *Service) ListAwaitingSettlement(ctx context.Context, sessionID uuid.UUID) ([]db.Ticket, error) {
	tickets, err := s.queries(ctx).ListTicketsAwaitingSettlement(ctx, sessionID)
	if err != nil {
		return nil, httpx.Internal(fmt.Errorf("ambil daftar penyelesaian pembayaran: %w", err))
	}
	return httpx.NonNil(tickets), nil
}

func (s *Service) ConfirmFinalPayment(ctx context.Context, tenantID, ticketID, adminUserID uuid.UUID, totalAmount int64) error {
	q := s.queries(ctx)
	if totalAmount <= 0 {
		return httpx.BadRequest("jumlah_tidak_valid", "Jumlah total pembayaran harus lebih dari 0", nil)
	}
	_, err := s.requireAdmin(ctx, q, tenantID, adminUserID)
	if err != nil {
		return err
	}
	if err := q.ConfirmTicketFinalPayment(ctx, db.ConfirmTicketFinalPaymentParams{
		ID: ticketID, FinalAmountRupiah: pgtype.Int8{Int64: totalAmount, Valid: true},
		FinalPaymentConfirmedBy: dbx.UUID(adminUserID),
	}); err != nil {
		return httpx.Internal(fmt.Errorf("mengonfirmasi pelunasan: %w", err))
	}
	return nil
}