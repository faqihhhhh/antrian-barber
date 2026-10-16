package queue

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"time"

	crand "crypto/rand"
	mrand "math/rand/v2"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	db "kapsflow/internal/db"
	"kapsflow/internal/dbx"
	"kapsflow/internal/httpx"
	"kapsflow/internal/midtrans"
	"kapsflow/internal/notification"
	"kapsflow/internal/pgerr"
	"kapsflow/internal/profile"
	"kapsflow/internal/realtime"
	"kapsflow/internal/rls"
)

type Service struct {
	fallback       *db.Queries
	pool           *pgxpool.Pool
	profileSvc     *profile.Service
	midtransClient *midtrans.Client
	hub            *realtime.Hub
	notifySvc      *notification.Service
	log            *slog.Logger
}

// TicketResponse berisi data tiket yang diperlukan layar staf, tanpa kolom internal database.
type TicketResponse struct {
	ID            uuid.UUID `json:"id"`
	TicketNumber  int32     `json:"ticket_number"`
	QueuePosition int32     `json:"queue_position"`
	Channel       string    `json:"channel"`
	CustomerName  string    `json:"customer_name"`
	MatchCode     string    `json:"match_code"`
	Status        string    `json:"status"`
}

// QueueSessionResponse hanya memuat data sesi yang dipakai layar operasional.
type QueueSessionResponse struct {
	ID          uuid.UUID          `json:"id"`
	OutletID    uuid.UUID          `json:"outlet_id"`
	SessionDate string             `json:"session_date"`
	MaxQuota    int32              `json:"max_quota"`
	UsedQuota   int32              `json:"used_quota"`
	Status      string             `json:"status"`
	CreatedAt   pgtype.Timestamptz `json:"created_at"`
	UpdatedAt   pgtype.Timestamptz `json:"updated_at"`
}

type KapsterStateResponse struct {
	MembershipID    uuid.UUID  `json:"membership_id"`
	Status          string     `json:"status"`
	CurrentTicketID *uuid.UUID `json:"current_ticket_id"`
}

// PendingManualPaymentResponse memuat informasi yang admin perlukan untuk mencocokkan DP.
type PendingManualPaymentResponse struct {
	TicketID     uuid.UUID `json:"ticket_id"`
	TicketNumber int32     `json:"ticket_number"`
	CustomerName string    `json:"customer_name"`
	MatchCode    string    `json:"match_code"`
	Method       string    `json:"method"`
	AmountRupiah int64     `json:"amount_rupiah"`
	UniqueCode   *int16    `json:"unique_code"`
	ExpiresAt    time.Time `json:"expires_at"`
}

func queueSessionResponse(session db.QueueSession) QueueSessionResponse {
	date := ""
	if session.SessionDate.Valid {
		date = session.SessionDate.Time.Format("2006-01-02")
	}
	return QueueSessionResponse{
		ID: session.ID, OutletID: session.OutletID, SessionDate: date,
		MaxQuota: session.MaxQuota, UsedQuota: session.UsedQuota, Status: session.Status,
		CreatedAt: session.CreatedAt, UpdatedAt: session.UpdatedAt,
	}
}

func ticketResponse(ticket db.Ticket) TicketResponse {
	response := TicketResponse{
		ID: ticket.ID, TicketNumber: ticket.TicketNumber, QueuePosition: ticket.QueuePosition,
		Channel: ticket.Channel, Status: ticket.Status,
	}
	if ticket.CustomerName.Valid {
		response.CustomerName = ticket.CustomerName.String
	}
	if ticket.MatchCode.Valid {
		response.MatchCode = ticket.MatchCode.String
	}
	return response
}

func NewService(pool *pgxpool.Pool, profileSvc *profile.Service, midtransClient *midtrans.Client, hub *realtime.Hub, notifySvc *notification.Service, log *slog.Logger) *Service {
	return &Service{fallback: db.New(pool), pool: pool, profileSvc: profileSvc, midtransClient: midtransClient, hub: hub, notifySvc: notifySvc, log: log}
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

func (s *Service) requireOutletAssignment(ctx context.Context, q *db.Queries, tenantID, outletID uuid.UUID, membership db.Membership) error {
	outlet, err := q.GetOutletByID(ctx, outletID)
	if errors.Is(err, pgx.ErrNoRows) {
		return httpx.NotFound("outlet_tidak_ditemukan", "Outlet tidak ditemukan", nil)
	}
	if err != nil {
		return httpx.Internal(fmt.Errorf("ambil outlet untuk pemeriksaan penugasan: %w", err))
	}
	if outlet.TenantID != tenantID {
		return httpx.NotFound("outlet_tidak_ditemukan", "Outlet tidak ditemukan", nil)
	}
	if slices.Contains(membership.Roles, "owner") {
		return nil
	}

	assigned, err := q.ListMembershipOutletIDs(ctx, membership.ID)
	if err != nil {
		return httpx.Internal(fmt.Errorf("ambil penugasan outlet: %w", err))
	}
	if !slices.Contains(assigned, outletID) {
		return httpx.Forbidden("outlet_tidak_ditugaskan", "Anda tidak ditugaskan di outlet ini", nil)
	}
	return nil
}

func (s *Service) requireSessionOutletAssignment(ctx context.Context, q *db.Queries, tenantID, sessionID uuid.UUID, membership db.Membership) error {
	session, err := q.GetQueueSessionByID(ctx, sessionID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && session.TenantID != tenantID) {
		return httpx.NotFound("sesi_tidak_ditemukan", "Sesi antrian tidak ditemukan", nil)
	}
	if err != nil {
		return httpx.Internal(fmt.Errorf("ambil sesi untuk pemeriksaan penugasan: %w", err))
	}
	return s.requireOutletAssignment(ctx, q, tenantID, session.OutletID, membership)
}

// --- Admin: sesi antrian & tiket offline ---

func (s *Service) OpenQueueSession(ctx context.Context, tenantID, outletID, userID uuid.UUID, sessionDate time.Time, maxQuota int32) (QueueSessionResponse, error) {
	q := s.queries(ctx)
	membership, err := s.requireAdmin(ctx, q, tenantID, userID)
	if err != nil {
		return QueueSessionResponse{}, err
	}
	if err := s.requireOutletAssignment(ctx, q, tenantID, outletID, membership); err != nil {
		return QueueSessionResponse{}, err
	}
	outlet, err := q.GetOutletByID(ctx, outletID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && outlet.TenantID != tenantID) {
		return QueueSessionResponse{}, httpx.NotFound("outlet_tidak_ditemukan", "Outlet tidak ditemukan", nil)
	}
	if err != nil {
		return QueueSessionResponse{}, httpx.Internal(fmt.Errorf("memeriksa tanggal sesi outlet: %w", err))
	}
	location, err := time.LoadLocation(outlet.Timezone)
	if err != nil {
		return QueueSessionResponse{}, httpx.Internal(fmt.Errorf("zona waktu outlet tidak valid: %w", err))
	}
	if sessionDate.Format("2006-01-02") < time.Now().In(location).Format("2006-01-02") {
		return QueueSessionResponse{}, httpx.BadRequest("tanggal_sudah_lewat", "Sesi baru tidak bisa dibuka untuk tanggal yang sudah lewat", nil)
	}
	if maxQuota <= 0 {
		return QueueSessionResponse{}, httpx.BadRequest("kuota_tidak_valid", "Kuota maksimal harus lebih dari 0", nil)
	}
	session, err := q.CreateQueueSession(ctx, db.CreateQueueSessionParams{
		TenantID: tenantID, OutletID: outletID,
		SessionDate: pgtype.Date{Time: sessionDate, Valid: true},
		MaxQuota:    maxQuota, CreatedBy: userID,
	})
	if err != nil {
		if pgerr.IsUniqueViolation(err) {
			return QueueSessionResponse{}, httpx.Conflict("sesi_sudah_ada", "Sudah ada sesi antrian untuk outlet dan tanggal ini", nil)
		}
		return QueueSessionResponse{}, httpx.Internal(fmt.Errorf("membuat sesi antrian: %w", err))
	}
	return queueSessionResponse(session), nil
}

func (s *Service) IncreaseQuota(ctx context.Context, tenantID, sessionID, userID uuid.UUID, by int32) (QueueSessionResponse, error) {
	q := s.queries(ctx)
	membership, err := s.requireAdmin(ctx, q, tenantID, userID)
	if err != nil {
		return QueueSessionResponse{}, err
	}
	if err := s.requireSessionOutletAssignment(ctx, q, tenantID, sessionID, membership); err != nil {
		return QueueSessionResponse{}, err
	}
	if by <= 0 {
		return QueueSessionResponse{}, httpx.BadRequest("jumlah_tidak_valid", "Jumlah tambahan kuota harus lebih dari 0", nil)
	}
	// MaxQuota di sini berarti JUMLAH TAMBAHAN, bukan total baru — lihat SQL-nya.
	session, err := q.IncreaseQueueQuota(ctx, db.IncreaseQueueQuotaParams{ID: sessionID, MaxQuota: by})
	if errors.Is(err, pgx.ErrNoRows) {
		return QueueSessionResponse{}, httpx.Conflict("sesi_sudah_ditutup", "Kuota tidak bisa ditambah karena sesi sudah ditutup", nil)
	}
	if err != nil {
		return QueueSessionResponse{}, httpx.Internal(fmt.Errorf("menambah kuota: %w", err))
	}
	return queueSessionResponse(session), nil
}

func (s *Service) CloseQueueSession(ctx context.Context, tenantID, sessionID, userID uuid.UUID) (QueueSessionResponse, error) {
	q := s.queries(ctx)
	membership, err := s.requireAdmin(ctx, q, tenantID, userID)
	if err != nil {
		return QueueSessionResponse{}, err
	}
	session, err := q.GetQueueSessionForUpdate(ctx, sessionID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && session.TenantID != tenantID) {
		return QueueSessionResponse{}, httpx.NotFound("sesi_tidak_ditemukan", "Sesi antrian tidak ditemukan", nil)
	}
	if err != nil {
		return QueueSessionResponse{}, httpx.Internal(fmt.Errorf("mengunci sesi antrian: %w", err))
	}
	if err := s.requireOutletAssignment(ctx, q, tenantID, session.OutletID, membership); err != nil {
		return QueueSessionResponse{}, err
	}
	if session.Status == "closed" {
		return QueueSessionResponse{}, httpx.Conflict("sesi_sudah_ditutup", "Sesi antrian ini sudah ditutup", nil)
	}
	activeCount, err := q.CountActiveTicketsInQueueSession(ctx, sessionID)
	if err != nil {
		return QueueSessionResponse{}, httpx.Internal(fmt.Errorf("memeriksa tiket aktif sesi: %w", err))
	}
	if activeCount > 0 {
		return QueueSessionResponse{}, httpx.Conflict("tiket_belum_selesai", "Selesaikan tiket yang menunggu, sedang dilayani, atau menunggu pembayaran sebelum menutup sesi", nil)
	}
	closedSession, err := q.CloseQueueSession(ctx, sessionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return QueueSessionResponse{}, httpx.Conflict("sesi_sudah_ditutup", "Sesi antrian ini sudah ditutup", nil)
	}
	if err != nil {
		return QueueSessionResponse{}, httpx.Internal(fmt.Errorf("menutup sesi antrian: %w", err))
	}
	s.broadcastSnapshot(ctx, q, sessionID)
	return queueSessionResponse(closedSession), nil
}

// ClosePastQueueSessions menutup sesi setelah tanggal lokal outlet terlewati.
// Tiket aktif tetap tersimpan dan bisa diselesaikan kapster; status closed
// hanya menghentikan pemesanan serta tiket baru.
func (s *Service) ClosePastQueueSessions(ctx context.Context) (int, error) {
	closedIDs := make([]uuid.UUID, 0)
	err := rls.RunAsSystem(ctx, s.pool, func(systemCtx context.Context) error {
		q := s.queries(systemCtx)
		ids, err := q.ClosePastQueueSessions(systemCtx)
		if err != nil {
			return fmt.Errorf("menutup sesi yang tanggalnya lewat: %w", err)
		}
		closedIDs = ids
		for _, sessionID := range ids {
			snapshot, snapshotErr := s.buildSnapshot(systemCtx, q, sessionID)
			if snapshotErr != nil {
				s.log.Error("gagal membangun snapshot sesi yang ditutup otomatis", "err", snapshotErr, "session_id", sessionID)
				continue
			}
			payload, _ := json.Marshal(snapshot)
			s.hub.Publish(sessionID.String(), payload)
		}
		return nil
	})
	if err != nil {
		return 0, httpx.Internal(err)
	}
	return len(closedIDs), nil
}

func (s *Service) AddOfflineTicket(ctx context.Context, tenantID, sessionID, userID uuid.UUID, customerName string) (TicketResponse, error) {
	q := s.queries(ctx)
	admin, err := s.requireAdmin(ctx, q, tenantID, userID)
	if err != nil {
		return TicketResponse{}, err
	}
	if err := s.requireSessionOutletAssignment(ctx, q, tenantID, sessionID, admin); err != nil {
		return TicketResponse{}, err
	}
	if customerName == "" {
		return TicketResponse{}, httpx.BadRequest("nama_wajib_diisi", "Nama pelanggan wajib diisi", nil)
	}

	num, err := q.ClaimNextTicketNumber(ctx, sessionID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			if session, sessionErr := q.GetQueueSessionByID(ctx, sessionID); sessionErr == nil && session.Status == "closed" {
				return TicketResponse{}, httpx.Conflict("sesi_sudah_ditutup", "Tiket baru tidak bisa ditambahkan karena sesi sudah ditutup", nil)
			}
			return TicketResponse{}, httpx.Conflict("kuota_penuh", "Kuota antrian hari ini sudah penuh", nil)
		}
		return TicketResponse{}, httpx.Internal(fmt.Errorf("mengambil nomor tiket: %w", err))
	}

	ticket, err := q.CreateTicket(ctx, db.CreateTicketParams{
		TenantID: tenantID, QueueSessionID: sessionID,
		TicketNumber: num, QueuePosition: num,
		Channel:      "offline",
		CustomerName: pgtype.Text{String: customerName, Valid: true},
		MatchCode:    pgtype.Text{}, // offline tidak pakai kode
	})
	if err != nil {
		return TicketResponse{}, httpx.Internal(fmt.Errorf("membuat tiket: %w", err))
	}
	if err := q.CreateTicketEvent(ctx, db.CreateTicketEventParams{
		TenantID: tenantID, TicketID: ticket.ID, EventType: "created", ActorMembershipID: dbx.UUID(admin.ID),
	}); err != nil {
		return TicketResponse{}, httpx.Internal(fmt.Errorf("mencatat event dibuat: %w", err))
	}
	s.broadcastSnapshot(ctx, q, sessionID)
	return ticketResponse(ticket), nil
}

// --- Baca-baca ---

func (s *Service) ListQueueSessions(ctx context.Context, outletID uuid.UUID) ([]QueueSessionResponse, error) {
	sessions, err := s.queries(ctx).ListQueueSessionsByOutlet(ctx, outletID)
	if err != nil {
		return nil, httpx.Internal(fmt.Errorf("ambil daftar sesi: %w", err))
	}
	responses := make([]QueueSessionResponse, 0, len(sessions))
	for _, session := range sessions {
		responses = append(responses, queueSessionResponse(session))
	}
	return responses, nil
}

func (s *Service) ListTickets(ctx context.Context, sessionID uuid.UUID) ([]TicketResponse, error) {
	tickets, err := s.queries(ctx).ListTicketsBySession(ctx, sessionID)
	if err != nil {
		return nil, httpx.Internal(fmt.Errorf("ambil daftar tiket: %w", err))
	}
	responses := make([]TicketResponse, 0, len(tickets))
	for _, ticket := range tickets {
		responses = append(responses, ticketResponse(ticket))
	}
	return responses, nil
}

func (s *Service) ListPendingManualPayments(ctx context.Context, tenantID, sessionID, userID uuid.UUID) ([]PendingManualPaymentResponse, error) {
	q := s.queries(ctx)
	membership, err := s.requireAdmin(ctx, q, tenantID, userID)
	if err != nil {
		return nil, err
	}
	if err := s.requireSessionOutletAssignment(ctx, q, tenantID, sessionID, membership); err != nil {
		return nil, err
	}
	rows, err := q.ListPendingManualTicketPaymentsBySession(ctx, sessionID)
	if err != nil {
		return nil, httpx.Internal(fmt.Errorf("ambil pembayaran DP manual: %w", err))
	}
	responses := make([]PendingManualPaymentResponse, 0, len(rows))
	for _, row := range rows {
		response := PendingManualPaymentResponse{
			TicketID: row.TicketID, TicketNumber: row.TicketNumber, Method: row.Method,
			AmountRupiah: row.AmountRupiah, ExpiresAt: row.ExpiresAt.Time,
		}
		if row.CustomerName.Valid {
			response.CustomerName = row.CustomerName.String
		}
		if row.MatchCode.Valid {
			response.MatchCode = row.MatchCode.String
		}
		if row.UniqueCode.Valid {
			code := row.UniqueCode.Int16
			response.UniqueCode = &code
		}
		responses = append(responses, response)
	}
	return responses, nil
}

func (s *Service) ListKapsterStates(ctx context.Context, sessionID uuid.UUID) ([]KapsterStateResponse, error) {
	states, err := s.queries(ctx).ListKapsterStatesBySession(ctx, sessionID)
	if err != nil {
		return nil, httpx.Internal(fmt.Errorf("ambil status kapster: %w", err))
	}
	responses := make([]KapsterStateResponse, 0, len(states))
	for _, state := range states {
		response := KapsterStateResponse{MembershipID: state.MembershipID, Status: state.Status}
		if state.CurrentTicketID.Valid {
			currentTicketID := uuid.UUID(state.CurrentTicketID.Bytes)
			response.CurrentTicketID = &currentTicketID
		}
		responses = append(responses, response)
	}
	return responses, nil
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
func (s *Service) KapsterReady(ctx context.Context, tenantID, sessionID, userID uuid.UUID) (*TicketResponse, error) {
	q := s.queries(ctx)
	membership, err := s.requireKapster(ctx, q, tenantID, userID)
	if err != nil {
		return nil, err
	}
	if err := s.requireSessionOutletAssignment(ctx, q, tenantID, sessionID, membership); err != nil {
		return nil, err
	}

	state, stErr := q.GetKapsterSessionState(ctx, db.GetKapsterSessionStateParams{QueueSessionID: sessionID, MembershipID: membership.ID})
	if stErr == nil {
		if state.Status == "busy" {
			return nil, httpx.Conflict("masih_ada_pelanggan_aktif", "Selesaikan atau lewati pelanggan yang sedang ditangani sebelum menekan siap lagi", nil)
		}
	} else if !errors.Is(stErr, pgx.ErrNoRows) {
		return nil, httpx.Internal(fmt.Errorf("cek status kapster: %w", stErr))
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
			s.broadcastSnapshot(ctx, q, sessionID)
			return nil, nil
		}
		return nil, httpx.Internal(fmt.Errorf("mengambil tiket berikutnya: %w", err))
	}

	if err := s.claimTicket(ctx, q, tenantID, sessionID, membership.ID, ticket); err != nil {
		return nil, err
	}
	s.broadcastSnapshot(ctx, q, sessionID)
	response := ticketResponse(ticket)
	return &response, nil
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
	if err := s.requireSessionOutletAssignment(ctx, q, tenantID, sessionID, membership); err != nil {
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
func (s *Service) KapsterSkip(ctx context.Context, tenantID, sessionID, userID uuid.UUID) (*TicketResponse, error) {
	q := s.queries(ctx)
	membership, err := s.requireKapster(ctx, q, tenantID, userID)
	if err != nil {
		return nil, err
	}
	if err := s.requireSessionOutletAssignment(ctx, q, tenantID, sessionID, membership); err != nil {
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
			s.broadcastSnapshot(ctx, q, sessionID)
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
	s.broadcastSnapshot(ctx, q, sessionID)
	response := ticketResponse(next)
	return &response, nil
}

func (s *Service) KapsterComplete(ctx context.Context, tenantID, sessionID, userID uuid.UUID) error {
	q := s.queries(ctx)
	membership, err := s.requireKapster(ctx, q, tenantID, userID)
	if err != nil {
		return err
	}
	if err := s.requireSessionOutletAssignment(ctx, q, tenantID, sessionID, membership); err != nil {
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
	s.broadcastSnapshot(ctx, q, sessionID)
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
	TicketID      uuid.UUID `json:"ticket_id"`
	TicketNumber  int32     `json:"ticket_number"`
	MatchCode     string    `json:"match_code"`
	Status        string    `json:"status"`
	PaymentMethod string    `json:"payment_method"`
	AmountRupiah  int64     `json:"amount_rupiah"`
	UniqueCode    int16     `json:"unique_code,omitempty"`
	QRCodeURL     string    `json:"qr_code_url,omitempty"`
	ExpiresAt     time.Time `json:"expires_at"`
}

// BookOnline adalah titik masuk pelanggan memesan tiket. Nomor tiket
// direbut lewat fungsi SECURITY DEFINER (claim_ticket_number_for_booking),
// bukan lewat UPDATE biasa — lihat catatan di chat soal kenapa.
// BookOnline adalah titik masuk pelanggan memesan tiket. Semua pengecekan yang
// bisa gagal dilakukan SEBELUM nomor tiket direbut. Nomor direbut lewat fungsi
// SECURITY DEFINER (claim_ticket_number_for_booking), bukan UPDATE biasa.
func (s *Service) BookOnline(ctx context.Context, tenantID, outletID, customerUserID uuid.UUID, sessionDate time.Time, customerName string) (*BookingResult, error) {
	q := s.queries(ctx)

	customerName = strings.TrimSpace(customerName)
	if utf8.RuneCountInString(customerName) > 60 {
		return nil, httpx.BadRequest("nama_terlalu_panjang", "Nama maksimal 60 karakter", nil)
	}

	outlet, err := q.GetOutletByID(ctx, outletID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, httpx.NotFound("outlet_tidak_ditemukan", "Outlet tidak ditemukan", nil)
		}
		return nil, httpx.Internal(fmt.Errorf("ambil data outlet: %w", err))
	}
	if outlet.TenantID != tenantID {
		return nil, httpx.NotFound("outlet_tidak_ditemukan", "Outlet tidak ditemukan", nil)
	}
	if outlet.DpPriceRupiah <= 0 {
		return nil, httpx.Conflict("harga_dp_belum_diatur", "Harga DP outlet ini belum diatur oleh admin", nil)
	}

	// Tanggal "hari ini" mengikuti zona waktu outlet, bukan zona waktu server.
	loc, err := time.LoadLocation(outlet.Timezone)
	if err != nil {
		return nil, httpx.Internal(fmt.Errorf("zona waktu outlet tidak valid: %w", err))
	}
	if sessionDate.Format("2006-01-02") < time.Now().In(loc).Format("2006-01-02") {
		return nil, httpx.BadRequest("tanggal_sudah_lewat", "Tanggal antrian sudah lewat", nil)
	}

	mode, err := s.profileSvc.PaymentMode(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	if mode == "none" {
		return nil, httpx.Conflict("pembayaran_belum_diatur", "Outlet ini belum mengatur metode pembayaran DP", nil)
	}

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
		MatchCode:      pgtype.Text{String: matchCode, Valid: true},
		CustomerUserID: dbx.UUID(customerUserID),
		CustomerName:   pgtype.Text{String: customerName, Valid: customerName != ""},
	})
	if err != nil {
		if pgerr.IsUniqueViolationOn(err, "idx_tickets_one_pending_per_customer") {
			return nil, httpx.Conflict("masih_ada_pesanan_belum_dibayar", "Anda masih punya pesanan yang belum dibayar di antrian ini. Selesaikan pembayarannya, atau tunggu sampai pesanan itu hangus.", nil)
		}
		return nil, httpx.Internal(fmt.Errorf("membuat tiket online: %w", err))
	}

	expiresAt := time.Now().Add(paymentWindow)
	result := &BookingResult{
		TicketID: ticket.ID, TicketNumber: ticket.TicketNumber, MatchCode: matchCode,
		Status: ticket.Status, ExpiresAt: expiresAt,
	}

	if mode == "midtrans" {
		serverKey, _, isProduction, configured, err := s.profileSvc.GetDecryptedMidtransKeys(ctx, tenantID)
		if err != nil {
			return nil, err
		}
		if !configured {
			return nil, httpx.Internal(fmt.Errorf("mode midtrans tetapi kunci tidak ditemukan untuk tenant %s", tenantID))
		}
		paymentID := uuid.New()
		charge, err := s.midtransClient.ChargeQRIS(ctx, serverKey, isProduction, paymentID.String(), outlet.DpPriceRupiah)
		if err != nil {
			return nil, httpx.Internal(fmt.Errorf("midtrans charge gagal: %w", err))
		}
		_, err = q.CreateTicketPayment(ctx, db.CreateTicketPaymentParams{
			ID: paymentID, TenantID: tenantID, TicketID: ticket.ID, CustomerUserID: dbx.UUID(customerUserID),
			Method: "midtrans", AmountRupiah: outlet.DpPriceRupiah,
			UniqueCode:      pgtype.Int2{},
			MidtransOrderID: pgtype.Text{String: charge.OrderID, Valid: true},
			QrCodeUrl:       pgtype.Text{String: charge.QRCodeURL, Valid: charge.QRCodeURL != ""},
			ExpiresAt:       dbx.TS(expiresAt),
		})
		if err != nil {
			return nil, httpx.Internal(fmt.Errorf("menyimpan pembayaran: %w", err))
		}
		result.PaymentMethod, result.AmountRupiah, result.QRCodeURL = "midtrans", outlet.DpPriceRupiah, charge.QRCodeURL
		return result, nil
	}

	// Mode manual: nominal unik per tenant, dikonfirmasi admin.
	for attempt := 0; attempt < 10; attempt++ {
		code := int16(1 + mrand.IntN(998))
		amount := outlet.DpPriceRupiah + int64(code)
		_, err := q.CreateTicketPayment(ctx, db.CreateTicketPaymentParams{
			ID: uuid.New(), TenantID: tenantID, TicketID: ticket.ID, CustomerUserID: dbx.UUID(customerUserID),
			Method: "manual", AmountRupiah: amount,
			UniqueCode:      pgtype.Int2{Int16: code, Valid: true},
			MidtransOrderID: pgtype.Text{},
			QrCodeUrl:       pgtype.Text{},
			ExpiresAt:       dbx.TS(expiresAt),
		})
		if err == nil {
			result.PaymentMethod, result.AmountRupiah, result.UniqueCode = "manual", amount, code
			return result, nil
		}
		if errors.Is(err, pgx.ErrNoRows) {
			continue // nominal bentrok; ON CONFLICT DO NOTHING tidak membatalkan transaksi
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

	// Dibaca lewat transaksi pemanggil, jadi RLS yang memastikan pembayaran ini
	// milik pemanggil (atau staf tenant ini). Milik orang lain tidak terlihat.
	payment, err := q.GetTicketPaymentByTicketID(ctx, ticketID)
	if err != nil || payment.TenantID != tenantID {
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

	// Mengubah pembayaran dan tiket butuh hak sistem: pelanggan tidak punya hak
	// UPDATE lewat RLS, jadi tanpa ini perubahannya diam-diam 0 baris. Hak pemanggil
	// sudah dibuktikan oleh pembacaan di atas.
	switch {
	case midtrans.IsPaid(status.TransactionStatus, status.FraudStatus):
		err = rls.RunAsSystem(ctx, s.pool, func(c context.Context) error {
			return s.settlePaymentPaid(c, s.queries(c), payment)
		})
	case midtrans.IsFailed(status.TransactionStatus):
		err = rls.RunAsSystem(ctx, s.pool, func(c context.Context) error {
			return s.settlePaymentFailed(c, s.queries(c), payment)
		})
	}
	if err != nil {
		return db.TicketPayment{}, err
	}
	return q.GetTicketPaymentByTicketID(ctx, ticketID)
}

func (s *Service) settlePaymentPaid(ctx context.Context, q *db.Queries, payment db.TicketPayment) error {
	updated, err := q.MarkTicketPaymentPaid(ctx, db.MarkTicketPaymentPaidParams{ID: payment.ID, ConfirmedBy: pgtype.UUID{}})
	if err != nil {
		return httpx.Internal(fmt.Errorf("menandai pembayaran lunas: %w", err))
	}
	if updated == 0 {
		return nil // sudah diproses pihak lain (notifikasi ganda atau sudah dibatalkan)
	}
	if err := q.MarkTicketWaiting(ctx, payment.TicketID); err != nil {
		return httpx.Internal(fmt.Errorf("memasukkan tiket ke antrian: %w", err))
	}
	if ticket, tErr := q.GetTicketByID(ctx, payment.TicketID); tErr == nil {
		s.broadcastSnapshot(ctx, q, ticket.QueueSessionID)
	}
	return nil
}

func (s *Service) settlePaymentFailed(ctx context.Context, q *db.Queries, payment db.TicketPayment) error {
	updated, err := q.MarkTicketPaymentFailed(ctx, payment.ID)
	if err != nil {
		return httpx.Internal(fmt.Errorf("menandai pembayaran gagal: %w", err))
	}
	if updated == 0 {
		return nil // sudah diproses pihak lain
	}
	if _, err := q.CancelPendingTicket(ctx, payment.TicketID); err != nil {
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
	membership, err := s.requireAdmin(ctx, q, tenantID, adminUserID)
	if err != nil {
		return err
	}
	payment, err := q.GetTicketPaymentByTicketID(ctx, ticketID)
	if err != nil {
		return httpx.NotFound("pembayaran_tidak_ditemukan", "Pembayaran tidak ditemukan", nil)
	}
	ticket, err := q.GetTicketByID(ctx, ticketID)
	if err != nil || ticket.TenantID != tenantID {
		return httpx.NotFound("pembayaran_tidak_ditemukan", "Pembayaran tidak ditemukan", nil)
	}
	if err := s.requireSessionOutletAssignment(ctx, q, tenantID, ticket.QueueSessionID, membership); err != nil {
		return err
	}
	if payment.Method != "manual" {
		return httpx.BadRequest("bukan_pembayaran_manual", "Pembayaran ini bukan mode manual", nil)
	}
	switch payment.Status {
	case "paid":
		return httpx.Conflict("sudah_diproses", "Pembayaran ini sudah dikonfirmasi sebelumnya", nil)
	case "failed":
		return httpx.Conflict("pesanan_kedaluwarsa", "Pesanan ini sudah kedaluwarsa dan dibatalkan. Minta pelanggan memesan ulang, atau tambahkan sebagai pelanggan offline.", nil)
	}

	updated, err := q.MarkTicketPaymentPaid(ctx, db.MarkTicketPaymentPaidParams{ID: payment.ID, ConfirmedBy: dbx.UUID(adminUserID)})
	if err != nil {
		return httpx.Internal(fmt.Errorf("menandai pembayaran lunas: %w", err))
	}
	if updated == 0 {
		return httpx.Conflict("sudah_diproses", "Pembayaran ini baru saja diproses, muat ulang daftar pesanan", nil)
	}
	if err := q.MarkTicketWaiting(ctx, ticketID); err != nil {
		return httpx.Internal(fmt.Errorf("memasukkan tiket ke antrian: %w", err))
	}
	if ticket, tErr := q.GetTicketByID(ctx, ticketID); tErr == nil {
		s.broadcastSnapshot(ctx, q, ticket.QueueSessionID)
	}
	return nil
}

func (s *Service) ListAwaitingSettlement(ctx context.Context, sessionID uuid.UUID) ([]TicketResponse, error) {
	tickets, err := s.queries(ctx).ListTicketsAwaitingSettlement(ctx, sessionID)
	if err != nil {
		return nil, httpx.Internal(fmt.Errorf("ambil daftar penyelesaian pembayaran: %w", err))
	}
	responses := make([]TicketResponse, 0, len(tickets))
	for _, ticket := range tickets {
		responses = append(responses, ticketResponse(ticket))
	}
	return responses, nil
}

func (s *Service) ConfirmFinalPayment(ctx context.Context, tenantID, ticketID, adminUserID uuid.UUID, totalAmount int64) error {
	q := s.queries(ctx)
	if totalAmount <= 0 {
		return httpx.BadRequest("jumlah_tidak_valid", "Jumlah total pembayaran harus lebih dari 0", nil)
	}
	membership, err := s.requireAdmin(ctx, q, tenantID, adminUserID)
	if err != nil {
		return err
	}
	ticket, err := q.GetTicketByID(ctx, ticketID)
	if err != nil || ticket.TenantID != tenantID {
		return httpx.NotFound("tiket_tidak_ditemukan", "Tiket tidak ditemukan", nil)
	}
	if err := s.requireSessionOutletAssignment(ctx, q, tenantID, ticket.QueueSessionID, membership); err != nil {
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

// --- Realtime & estimasi waktu tunggu ---

type SessionSnapshot struct {
	SessionID            uuid.UUID `json:"session_id"`
	Status               string    `json:"status"`
	WaitingCount         int64     `json:"waiting_count"`
	ActiveKapsters       int64     `json:"active_kapsters"`
	EstimatedWaitMinutes float64   `json:"estimated_wait_minutes"`
	UpdatedAt            time.Time `json:"updated_at"`
}

func (s *Service) buildSnapshot(ctx context.Context, q *db.Queries, sessionID uuid.UUID) (SessionSnapshot, error) {
	session, err := q.GetQueueSessionByID(ctx, sessionID)
	if err != nil {
		return SessionSnapshot{}, err
	}
	waitingCount, err := q.CountWaitingInSession(ctx, sessionID)
	if err != nil {
		return SessionSnapshot{}, err
	}
	activeKapsters, err := q.CountActiveKapsters(ctx, sessionID)
	if err != nil {
		return SessionSnapshot{}, err
	}
	avgMinutes, err := q.GetAverageCallIntervalMinutes(ctx, session.OutletID)
	if err != nil {
		return SessionSnapshot{}, err
	}
	outlet, err := q.GetOutletByID(ctx, session.OutletID)
	if err != nil {
		return SessionSnapshot{}, err
	}

	perRound := float64(outlet.DefaultDurationMinutes)
	if avgMinutes >= 0 {
		perRound = avgMinutes
	}
	divisor := activeKapsters
	if divisor == 0 {
		divisor = 1
	}

	return SessionSnapshot{
		SessionID:            sessionID,
		Status:               session.Status,
		WaitingCount:         waitingCount,
		ActiveKapsters:       activeKapsters,
		EstimatedWaitMinutes: (float64(waitingCount) / float64(divisor)) * perRound,
		UpdatedAt:            time.Now(),
	}, nil
}

// broadcastSnapshot dipanggil dengan q dari transaksi yang SAMA dengan aksi
// yang baru saja selesai. Selain mendorong snapshot lewat SSE, ini juga
// titik tunggal untuk memicu push ke pelanggan yang gilirannya mendekat —
// dicek di sini supaya tidak perlu menduplikasi logika "siapa yang perlu
// diberi tahu" di tiap pemanggil (ready/skip/complete/confirm-payment).
func (s *Service) broadcastSnapshot(ctx context.Context, q *db.Queries, sessionID uuid.UUID) {
	snap, err := s.buildSnapshot(ctx, q, sessionID)
	if err != nil {
		s.log.Error("gagal membangun snapshot realtime", "err", err, "session_id", sessionID)
		return
	}
	payload, _ := json.Marshal(snap)
	s.hub.Publish(sessionID.String(), payload)

	s.notifyUpcomingCustomers(ctx, q, sessionID)
}

// notifyUpcomingCustomers mengirim push ke pelanggan dengan tiket online di
// posisi 1 atau 2 dari depan (dalam status waiting) — "giliran Anda
// sebentar lagi" sesuai spesifikasi awal. Dipanggil tiap kali status
// antrian berubah; mengirim push berulang untuk tiket yang sama tidak
// berbahaya (cuma dapat notifikasi dua kali kalau kebetulan dua event
// terjadi berdekatan), jadi tidak perlu tabel penanda "sudah diberi tahu".
func (s *Service) notifyUpcomingCustomers(ctx context.Context, q *db.Queries, sessionID uuid.UUID) {
	upcoming, err := q.ListUpcomingWaitingTickets(ctx, sessionID)
	if err != nil {
		s.log.Error("gagal ambil daftar tiket yang akan dipanggil", "err", err, "session_id", sessionID)
		return
	}
	s.log.Info("cek notifikasi giliran", "session_id", sessionID, "kandidat", len(upcoming))
	for _, t := range upcoming {
		if !t.CustomerUserID.Valid {
			continue // tiket offline, tidak punya akun untuk dikirimi push
		}
		// Klaim atomik: hanya satu pemanggil yang berhasil per tiket. Kalau
		// tidak ada baris yang berubah, tiket ini sudah pernah diberi tahu.
		if _, err := q.ClaimTurnNotification(ctx, t.ID); err != nil {
			if !errors.Is(err, pgx.ErrNoRows) {
				s.log.Error("gagal menandai notifikasi giliran", "err", err, "ticket_id", t.ID)
			}
			continue
		}
		customerID := uuid.UUID(t.CustomerUserID.Bytes)
		s.log.Info("mencoba kirim notifikasi giliran", "ticket_number", t.TicketNumber, "user_id", customerID)
		s.notifySvc.NotifyUser(ctx, customerID,
			"Giliran Anda sebentar lagi",
			fmt.Sprintf("Tiket nomor %d akan segera dipanggil, siap-siap ya!", t.TicketNumber))
	}
}

// GetPublicSnapshot dipakai endpoint SSE yang TIDAK terautentikasi. Lewat
// rls.RunAsSystem, SINGKAT (satu kali ambil data), bukan dipegang selama
// koneksi SSE-nya berlangsung.
func (s *Service) GetPublicSnapshot(ctx context.Context, sessionID uuid.UUID) (SessionSnapshot, error) {
	var snap SessionSnapshot
	err := rls.RunAsSystem(ctx, s.pool, func(sysCtx context.Context) error {
		result, bErr := s.buildSnapshot(sysCtx, s.queries(sysCtx), sessionID)
		snap = result
		return bErr
	})
	return snap, err
}

func (s *Service) SubscribeSnapshot(sessionID string) chan []byte {
	return s.hub.Subscribe(sessionID)
}

func (s *Service) UnsubscribeSnapshot(sessionID string, ch chan []byte) {
	s.hub.Unsubscribe(sessionID, ch)
}

type EstimateResult struct {
	TicketsAhead         int64   `json:"tickets_ahead"`
	ActiveKapsters       int64   `json:"active_kapsters"`
	EstimatedWaitMinutes float64 `json:"estimated_wait_minutes"`
}

// EstimateTicketWait adalah estimasi PERSONAL berdasarkan posisi tiket
// persis — beda dari GetPublicSnapshot yang agregat untuk siapa saja. Lewat
// RLS biasa: pelanggan cuma bisa menanyakan tiket miliknya sendiri.
// estimateAhead menghitung estimasi untuk satu posisi antrian. Sengaja lewat
// rls.RunAsSystem: pelanggan hanya boleh melihat tiketnya sendiri, jadi lewat
// RLS biasa antrean orang lain, kapster aktif, dan riwayat panggilan semuanya
// tersembunyi dan angkanya salah. Pemanggil WAJIB sudah memastikan tiketnya
// milik pemanggil (atau pemanggil adalah staf tenant) sebelum memanggil ini.
func (s *Service) estimateAhead(ctx context.Context, sessionID, outletID uuid.UUID, position int32) (EstimateResult, error) {
	var result EstimateResult
	err := rls.RunAsSystem(ctx, s.pool, func(c context.Context) error {
		q := s.queries(c)

		ahead, err := q.CountWaitingAheadOf(c, db.CountWaitingAheadOfParams{QueueSessionID: sessionID, QueuePosition: position})
		if err != nil {
			return fmt.Errorf("menghitung antrean di depan: %w", err)
		}
		activeKapsters, err := q.CountActiveKapsters(c, sessionID)
		if err != nil {
			return fmt.Errorf("menghitung kapster aktif: %w", err)
		}
		avgMinutes, err := q.GetAverageCallIntervalMinutes(c, outletID)
		if err != nil {
			return fmt.Errorf("menghitung rata-rata waktu: %w", err)
		}
		outlet, err := q.GetOutletByID(c, outletID)
		if err != nil {
			return fmt.Errorf("ambil data outlet: %w", err)
		}

		perRound := float64(outlet.DefaultDurationMinutes)
		if avgMinutes >= 0 {
			perRound = avgMinutes
		}
		divisor := activeKapsters
		if divisor == 0 {
			divisor = 1
		}
		result = EstimateResult{
			TicketsAhead:         ahead,
			ActiveKapsters:       activeKapsters,
			EstimatedWaitMinutes: (float64(ahead) / float64(divisor)) * perRound,
		}
		return nil
	})
	return result, err
}

func (s *Service) EstimateTicketWait(ctx context.Context, ticketID uuid.UUID) (EstimateResult, error) {
	q := s.queries(ctx)

	// RLS biasa di sini berfungsi sebagai otorisasi: pelanggan hanya bisa
	// menemukan tiketnya sendiri, staf hanya tiket tenant-nya.
	ticket, err := q.GetTicketByID(ctx, ticketID)
	if err != nil {
		return EstimateResult{}, httpx.NotFound("tiket_tidak_ditemukan", "Tiket tidak ditemukan", nil)
	}
	session, err := q.GetQueueSessionByID(ctx, ticket.QueueSessionID)
	if err != nil {
		return EstimateResult{}, httpx.Internal(fmt.Errorf("ambil sesi antrian: %w", err))
	}
	result, err := s.estimateAhead(ctx, ticket.QueueSessionID, session.OutletID, ticket.QueuePosition)
	if err != nil {
		return EstimateResult{}, httpx.Internal(err)
	}
	return result, nil
}

// --- Job terjadwal: pesanan kedaluwarsa ---

// ExpireStalePayments dipanggil River tiap menit. Mengembalikan jumlah
// pesanan yang benar-benar dibatalkan.
func (s *Service) ExpireStalePayments(ctx context.Context) (int, error) {
	var stale []db.TicketPayment
	err := rls.RunAsSystem(ctx, s.pool, func(c context.Context) error {
		rows, qErr := s.queries(c).ListExpiredPendingPayments(c)
		stale = rows
		return qErr
	})
	if err != nil {
		return 0, fmt.Errorf("ambil pembayaran kedaluwarsa: %w", err)
	}

	expired := 0
	for _, p := range stale {
		done, err := s.expireOne(ctx, p)
		if err != nil {
			s.log.Error("gagal memproses pembayaran kedaluwarsa", "err", err, "payment_id", p.ID)
			continue
		}
		if done {
			expired++
		}
	}
	return expired, nil
}

func (s *Service) expireOne(ctx context.Context, p db.TicketPayment) (bool, error) {
	if p.Method == "midtrans" {
		serverKey, _, isProduction, configured, err := s.profileSvc.GetDecryptedMidtransKeys(ctx, p.TenantID)
		if err != nil {
			return false, err
		}
		if !configured || !p.MidtransOrderID.Valid {
			return false, fmt.Errorf("kunci midtrans untuk tenant %s tidak tersedia", p.TenantID)
		}
		status, err := s.midtransClient.CheckStatus(ctx, serverKey, isProduction, p.MidtransOrderID.String)
		if err != nil {
			return false, err
		}
		if midtrans.IsPaid(status.TransactionStatus, status.FraudStatus) {
			// Pelanggan sebenarnya sudah bayar tapi webhook belum sampai.
			settleErr := rls.RunAsSystem(ctx, s.pool, func(c context.Context) error {
				return s.settlePaymentPaid(c, s.queries(c), p)
			})
			return false, settleErr
		}
		if !midtrans.IsFailed(status.TransactionStatus) {
			return false, nil // masih pending di Midtrans, biarkan Midtrans yang meng-expire
		}
	}

	canceled := false
	err := rls.RunAsSystem(ctx, s.pool, func(c context.Context) error {
		q := s.queries(c)
		updated, err := q.MarkTicketPaymentFailed(c, p.ID)
		if err != nil {
			return err
		}
		if updated == 0 {
			return nil // admin atau webhook mendahului kita
		}
		if _, err := q.CancelPendingTicket(c, p.TicketID); err != nil {
			return err
		}
		canceled = true
		return nil
	})
	return canceled, err
}

// --- Sisi pelanggan: tiket saya dan QRIS manual ---

type MyTicketPayment struct {
	Method       string    `json:"method"`
	Status       string    `json:"status"`
	AmountRupiah int64     `json:"amount_rupiah"`
	ExpiresAt    time.Time `json:"expires_at"`
	QRCodeURL    *string   `json:"qr_code_url"`
}

type MyTicket struct {
	TicketID       uuid.UUID        `json:"ticket_id"`
	TenantID       uuid.UUID        `json:"tenant_id"`
	OutletID       uuid.UUID        `json:"outlet_id"`
	OutletName     string           `json:"outlet_name"`
	OutletSlug     string           `json:"outlet_slug"`
	OutletTimezone string           `json:"outlet_timezone"`
	SessionID      uuid.UUID        `json:"session_id"`
	SessionDate    string           `json:"session_date"`
	TicketNumber   int32            `json:"ticket_number"`
	Status         string           `json:"status"`
	MatchCode      *string          `json:"match_code"`
	CustomerName   *string          `json:"customer_name"`
	Payment        *MyTicketPayment `json:"payment"`
	Estimate       *EstimateResult  `json:"estimate"`
	Reviewed       bool             `json:"reviewed"`
}

// MyTickets: tiket aktif dan yang selesai 7 hari terakhir milik pelanggan ini.
// Daftar tiketnya lewat RLS biasa (hanya tiket sendiri); estimasi tunggu
// dihitung lewat jalur sistem karena butuh melihat antrean orang lain.
func (s *Service) MyTickets(ctx context.Context, userID uuid.UUID) ([]MyTicket, error) {
	rows, err := s.queries(ctx).ListMyTickets(ctx, userID)
	if err != nil {
		return nil, httpx.Internal(fmt.Errorf("ambil tiket saya: %w", err))
	}

	result := make([]MyTicket, 0, len(rows))
	for _, r := range rows {
		item := MyTicket{
			TicketID: r.TicketID, TenantID: r.TenantID, OutletID: r.OutletID,
			OutletName: r.OutletName, OutletSlug: r.OutletSlug, OutletTimezone: r.OutletTimezone,
			SessionID: r.SessionID, SessionDate: r.SessionDate.Time.Format("2006-01-02"),
			TicketNumber: r.TicketNumber, Status: r.Status, Reviewed: r.Reviewed,
		}
		if r.MatchCode.Valid {
			v := r.MatchCode.String
			item.MatchCode = &v
		}
		if r.CustomerName.Valid {
			v := r.CustomerName.String
			item.CustomerName = &v
		}
		if r.PaymentMethod.Valid {
			p := &MyTicketPayment{
				Method:       r.PaymentMethod.String,
				Status:       r.PaymentStatus.String,
				AmountRupiah: r.AmountRupiah.Int64,
				ExpiresAt:    r.PaymentExpiresAt.Time,
			}
			if r.QrCodeUrl.Valid {
				v := r.QrCodeUrl.String
				p.QRCodeURL = &v
			}
			item.Payment = p
		}
		if r.Status == "waiting" {
			est, err := s.estimateAhead(ctx, r.SessionID, r.OutletID, r.QueuePosition)
			if err != nil {
				return nil, httpx.Internal(err)
			}
			item.Estimate = &est
		}
		result = append(result, item)
	}
	return result, nil
}

// ManualQRISImage mengembalikan gambar QRIS owner, HANYA untuk pemilik tiket
// yang pembayaran manualnya masih menunggu. Pemilik tiket dipastikan oleh RLS
// (GetTicketByID tidak menemukan tiket orang lain).
func (s *Service) ManualQRISImage(ctx context.Context, ticketID uuid.UUID) (string, []byte, error) {
	q := s.queries(ctx)
	ticket, err := q.GetTicketByID(ctx, ticketID)
	if err != nil {
		return "", nil, httpx.NotFound("qris_tidak_tersedia", "QRIS tidak tersedia", nil)
	}
	payment, err := q.GetTicketPaymentByTicketID(ctx, ticketID)
	if err != nil || payment.Method != "manual" || payment.Status != "pending" {
		return "", nil, httpx.NotFound("qris_tidak_tersedia", "QRIS tidak tersedia", nil)
	}
	data, contentType, ok, err := s.profileSvc.GetManualQRIS(ctx, ticket.TenantID)
	if err != nil {
		return "", nil, err
	}
	if !ok {
		return "", nil, httpx.NotFound("qris_tidak_tersedia", "QRIS tidak tersedia", nil)
	}
	return contentType, data, nil
}
