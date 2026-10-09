package review

import (
	"context"
	"errors"
	"fmt"
	"math"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	db "kapsflow/internal/db"
	"kapsflow/internal/httpx"
	"kapsflow/internal/pgerr"
	"kapsflow/internal/rls"
)

const maxCommentRunes = 1000

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

// requireOwner memberi pesan 403 yang jelas ke frontend. RLS saja hanya
// akan membalas daftar kosong, dan itu membingungkan untuk admin/kapster.
func (s *Service) requireOwner(ctx context.Context, q *db.Queries, tenantID, userID uuid.UUID) error {
	m, err := q.GetMembershipForUserAndTenant(ctx, db.GetMembershipForUserAndTenantParams{TenantID: tenantID, UserID: userID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return httpx.Forbidden("bukan_anggota_tenant", "Anda bukan anggota bisnis ini", nil)
		}
		return httpx.Internal(fmt.Errorf("ambil membership: %w", err))
	}
	if !slices.Contains(m.Roles, "owner") {
		return httpx.Forbidden("bukan_owner", "Hanya owner yang bisa melihat rating dan komentar kapster", nil)
	}
	return nil
}

// Submit dipanggil pelanggan. Semua syarat dicek berurutan sebelum insert,
// dan constraint di database tetap menjadi jaring pengaman terakhir.
func (s *Service) Submit(ctx context.Context, tenantID, ticketID, userID uuid.UUID, rating int16, comment string) (db.Review, error) {
	if rating < 1 || rating > 5 {
		return db.Review{}, httpx.BadRequest("rating_tidak_valid", "Rating harus antara 1 sampai 5 bintang", nil)
	}
	comment = strings.TrimSpace(comment)
	if utf8.RuneCountInString(comment) > maxCommentRunes {
		return db.Review{}, httpx.BadRequest("komentar_terlalu_panjang", "Komentar maksimal 1000 karakter", nil)
	}

	q := s.queries(ctx)

	ticket, err := q.GetTicketByID(ctx, ticketID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return db.Review{}, httpx.NotFound("tiket_tidak_ditemukan", "Tiket tidak ditemukan", nil)
		}
		return db.Review{}, httpx.Internal(fmt.Errorf("ambil tiket: %w", err))
	}
	if ticket.TenantID != tenantID {
		return db.Review{}, httpx.NotFound("tiket_tidak_ditemukan", "Tiket tidak ditemukan", nil)
	}
	// Staf tenant juga lolos RLS untuk MELIHAT tiket, jadi pemilik tiket
	// harus dicek eksplisit di sini.
	if !ticket.CustomerUserID.Valid || uuid.UUID(ticket.CustomerUserID.Bytes) != userID {
		return db.Review{}, httpx.Forbidden("bukan_pemilik_tiket", "Hanya pemesan tiket ini yang bisa memberi rating", nil)
	}
	if ticket.Status != "completed" {
		return db.Review{}, httpx.Conflict("tiket_belum_selesai", "Rating baru bisa diberikan setelah pemotongan selesai", nil)
	}
	if !ticket.AssignedMembershipID.Valid {
		return db.Review{}, httpx.Conflict("kapster_tidak_tercatat", "Kapster untuk tiket ini tidak tercatat", nil)
	}

	rv, err := q.CreateReview(ctx, db.CreateReviewParams{
		TenantID:            tenantID,
		TicketID:            ticketID,
		KapsterMembershipID: uuid.UUID(ticket.AssignedMembershipID.Bytes),
		CustomerUserID:      userID,
		Rating:              rating,
		Comment:             pgtype.Text{String: comment, Valid: comment != ""},
	})
	if err != nil {
		if pgerr.IsUniqueViolation(err) {
			return db.Review{}, httpx.Conflict("sudah_memberi_ulasan", "Anda sudah memberi ulasan untuk tiket ini", nil)
		}
		return db.Review{}, httpx.Internal(fmt.Errorf("menyimpan ulasan: %w", err))
	}
	return rv, nil
}

// GetOwn: RLS yang membatasi — pelanggan hanya bisa melihat ulasannya
// sendiri, dan owner bisa melihat ulasan tenant-nya.
func (s *Service) GetOwn(ctx context.Context, ticketID uuid.UUID) (db.Review, error) {
	rv, err := s.queries(ctx).GetReviewByTicketID(ctx, ticketID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return db.Review{}, httpx.NotFound("ulasan_tidak_ditemukan", "Belum ada ulasan untuk tiket ini", nil)
		}
		return db.Review{}, httpx.Internal(fmt.Errorf("ambil ulasan: %w", err))
	}
	return rv, nil
}

// ReviewView sengaja TIDAK memuat identitas pelanggan.
type ReviewView struct {
	ID                  uuid.UUID `json:"id"`
	TicketID            uuid.UUID `json:"ticket_id"`
	KapsterMembershipID uuid.UUID `json:"kapster_membership_id"`
	KapsterEmail        string    `json:"kapster_email"`
	Rating              int16     `json:"rating"`
	Comment             *string   `json:"comment"`
	CreatedAt           time.Time `json:"created_at"`
}

func toView(id, ticketID, kapsterID uuid.UUID, email string, rating int16, comment pgtype.Text, createdAt pgtype.Timestamptz) ReviewView {
	v := ReviewView{ID: id, TicketID: ticketID, KapsterMembershipID: kapsterID, KapsterEmail: email, Rating: rating, CreatedAt: createdAt.Time}
	if comment.Valid {
		c := comment.String
		v.Comment = &c
	}
	return v
}

func (s *Service) List(ctx context.Context, tenantID, userID uuid.UUID, kapsterID *uuid.UUID, limit, offset int32) ([]ReviewView, error) {
	q := s.queries(ctx)
	if err := s.requireOwner(ctx, q, tenantID, userID); err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}

	views := make([]ReviewView, 0)
	if kapsterID == nil {
		rows, err := q.ListReviewsByTenant(ctx, db.ListReviewsByTenantParams{TenantID: tenantID, Limit: limit, Offset: offset})
		if err != nil {
			return nil, httpx.Internal(fmt.Errorf("ambil daftar ulasan: %w", err))
		}
		for _, r := range rows {
			views = append(views, toView(r.ID, r.TicketID, r.KapsterMembershipID, r.KapsterEmail, r.Rating, r.Comment, r.CreatedAt))
		}
		return views, nil
	}

	rows, err := q.ListReviewsByKapster(ctx, db.ListReviewsByKapsterParams{TenantID: tenantID, KapsterMembershipID: *kapsterID, Limit: limit, Offset: offset})
	if err != nil {
		return nil, httpx.Internal(fmt.Errorf("ambil daftar ulasan kapster: %w", err))
	}
	for _, r := range rows {
		views = append(views, toView(r.ID, r.TicketID, r.KapsterMembershipID, r.KapsterEmail, r.Rating, r.Comment, r.CreatedAt))
	}
	return views, nil
}

type KapsterSummary struct {
	MembershipID uuid.UUID `json:"membership_id"`
	KapsterEmail string    `json:"kapster_email"`
	ReviewCount  int64     `json:"review_count"`
	AvgRating    float64   `json:"avg_rating"`
}

func (s *Service) Summary(ctx context.Context, tenantID, userID uuid.UUID) ([]KapsterSummary, error) {
	q := s.queries(ctx)
	if err := s.requireOwner(ctx, q, tenantID, userID); err != nil {
		return nil, err
	}
	rows, err := q.GetReviewSummaryByTenant(ctx, tenantID)
	if err != nil {
		return nil, httpx.Internal(fmt.Errorf("ambil ringkasan ulasan: %w", err))
	}
	result := make([]KapsterSummary, 0, len(rows))
	for _, r := range rows {
		result = append(result, KapsterSummary{
			MembershipID: r.MembershipID,
			KapsterEmail: r.KapsterEmail,
			ReviewCount:  r.ReviewCount,
			AvgRating:    math.Round(r.AvgRating*100) / 100,
		})
	}
	return result, nil
}