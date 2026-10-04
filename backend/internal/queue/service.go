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
)

type Service struct {
	fallback *db.Queries
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{fallback: db.New(pool)}
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