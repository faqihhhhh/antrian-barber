package analytics

import (
	"context"
	"errors"
	"fmt"
	"math"
	"slices"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	db "kapsflow/internal/db"
	"kapsflow/internal/dbx"
	"kapsflow/internal/httpx"
	"kapsflow/internal/rls"
)

const maxRangeDays = 93

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

func toDate(t time.Time) pgtype.Date { return pgtype.Date{Time: t, Valid: true} }
func round1(v float64) float64        { return math.Round(v*10) / 10 }
func round2(v float64) float64        { return math.Round(v*100) / 100 }

func ratioPct(num, den int64) *float64 {
	if den == 0 {
		return nil
	}
	v := round1(float64(num) / float64(den) * 100)
	return &v
}

func changePct(cur, prev int64) *float64 {
	if prev == 0 {
		return nil
	}
	v := round1(float64(cur-prev) / float64(prev) * 100)
	return &v
}

// --- Hak akses ---

type access struct {
	outletIDs map[uuid.UUID]bool // nil = semua outlet (owner)
}

func (a access) allows(outletID uuid.UUID) bool {
	return a.outletIDs == nil || a.outletIDs[outletID]
}

// resolveAccess: owner melihat semua outlet; admin hanya outlet yang
// ditugaskan padanya. ownerOnly=true menolak admin (statistik kapster).
func (s *Service) resolveAccess(ctx context.Context, q *db.Queries, tenantID, userID uuid.UUID, ownerOnly bool) (access, error) {
	m, err := q.GetMembershipForUserAndTenant(ctx, db.GetMembershipForUserAndTenantParams{TenantID: tenantID, UserID: userID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return access{}, httpx.Forbidden("bukan_anggota_tenant", "Anda bukan anggota bisnis ini", nil)
		}
		return access{}, httpx.Internal(fmt.Errorf("ambil membership: %w", err))
	}
	if slices.Contains(m.Roles, "owner") {
		return access{}, nil
	}
	if ownerOnly {
		return access{}, httpx.Forbidden("bukan_owner", "Hanya owner yang bisa melihat statistik kapster", nil)
	}
	if !slices.Contains(m.Roles, "admin") {
		return access{}, httpx.Forbidden("bukan_admin_tenant", "Statistik hanya untuk admin dan owner", nil)
	}
	ids, err := q.ListMembershipOutletIDs(ctx, m.ID)
	if err != nil {
		return access{}, httpx.Internal(fmt.Errorf("ambil outlet admin: %w", err))
	}
	set := make(map[uuid.UUID]bool, len(ids))
	for _, id := range ids {
		set[id] = true
	}
	return access{outletIDs: set}, nil
}

// --- Statistik outlet (admin dan owner) ---

type Totals struct {
	TicketsTotal      int64   `json:"tickets_total"`
	TicketsOnline     int64   `json:"tickets_online"`
	TicketsOffline    int64   `json:"tickets_offline"`
	TicketsCompleted  int64   `json:"tickets_completed"`
	TicketsCanceled   int64   `json:"tickets_canceled"`
	TicketsSettled    int64   `json:"tickets_settled"`
	RevenueRupiah     int64   `json:"revenue_rupiah"`
	DPUnsettledRupiah int64   `json:"dp_unsettled_rupiah"`
	AvgTicketRupiah   int64   `json:"avg_ticket_rupiah"`
	CompletionPct     float64 `json:"completion_pct"`
}

func (t *Totals) addRow(r db.StatsDailyByOutletRow) {
	t.TicketsTotal += r.TicketsTotal
	t.TicketsOnline += r.TicketsOnline
	t.TicketsOffline += r.TicketsOffline
	t.TicketsCompleted += r.TicketsCompleted
	t.TicketsCanceled += r.TicketsCanceled
	t.TicketsSettled += r.TicketsSettled
	t.RevenueRupiah += r.RevenueRupiah
	t.DPUnsettledRupiah += r.DpUnsettledRupiah
}

func (t *Totals) finalize() {
	if t.TicketsSettled > 0 {
		t.AvgTicketRupiah = t.RevenueRupiah / t.TicketsSettled
	}
	if t.TicketsTotal > 0 {
		t.CompletionPct = round1(float64(t.TicketsCompleted) / float64(t.TicketsTotal) * 100)
	}
}

type DayPoint struct {
	Date             string `json:"date"`
	TicketsTotal     int64  `json:"tickets_total"`
	TicketsCompleted int64  `json:"tickets_completed"`
	RevenueRupiah    int64  `json:"revenue_rupiah"`
}

type OutletTotals struct {
	OutletID   uuid.UUID `json:"outlet_id"`
	OutletName string    `json:"outlet_name"`
	Totals     Totals    `json:"totals"`
}

type Timing struct {
	AvgServiceMinutes float64 `json:"avg_service_minutes"`
	AvgWaitMinutes    float64 `json:"avg_wait_minutes"`
	TicketsMeasured   int64   `json:"tickets_measured"`
}

type HourPoint struct {
	Hour           int   `json:"hour"`
	TicketsStarted int64 `json:"tickets_started"`
}

type Change struct {
	Customers *float64 `json:"customers"`
	Revenue   *float64 `json:"revenue"`
}

type OverviewResult struct {
	From      string         `json:"from"`
	To        string         `json:"to"`
	Totals    Totals         `json:"totals"`
	Previous  Totals         `json:"previous"`
	ChangePct Change         `json:"change_pct"`
	Daily     []DayPoint     `json:"daily"`
	ByOutlet  []OutletTotals `json:"by_outlet"`
	Timing    Timing         `json:"timing"`
	PeakHours []HourPoint    `json:"peak_hours"`
}

type aggregate struct {
	totals  Totals
	days    []DayPoint
	outlets []OutletTotals
}

func visible(acc access, filter *uuid.UUID, outletID uuid.UUID) bool {
	return acc.allows(outletID) && (filter == nil || *filter == outletID)
}

func aggregateRows(rows []db.StatsDailyByOutletRow, acc access, filter *uuid.UUID) aggregate {
	agg := aggregate{days: []DayPoint{}, outlets: []OutletTotals{}}
	outletIdx := map[uuid.UUID]int{}

	for _, r := range rows {
		if !visible(acc, filter, r.OutletID) {
			continue
		}
		agg.totals.addRow(r)

		date := r.SessionDate.Time.Format("2006-01-02")
		if n := len(agg.days); n == 0 || agg.days[n-1].Date != date {
			agg.days = append(agg.days, DayPoint{Date: date})
		}
		d := &agg.days[len(agg.days)-1]
		d.TicketsTotal += r.TicketsTotal
		d.TicketsCompleted += r.TicketsCompleted
		d.RevenueRupiah += r.RevenueRupiah

		idx, ok := outletIdx[r.OutletID]
		if !ok {
			agg.outlets = append(agg.outlets, OutletTotals{OutletID: r.OutletID, OutletName: r.OutletName})
			idx = len(agg.outlets) - 1
			outletIdx[r.OutletID] = idx
		}
		agg.outlets[idx].Totals.addRow(r)
	}

	agg.totals.finalize()
	for i := range agg.outlets {
		agg.outlets[i].Totals.finalize()
	}
	return agg
}

func aggregateTiming(rows []db.StatsTimingByOutletRow, acc access, filter *uuid.UUID) Timing {
	var service, wait float64
	var n int64
	for _, r := range rows {
		if !visible(acc, filter, r.OutletID) {
			continue
		}
		service += r.AvgServiceMinutes * float64(r.TicketsMeasured)
		wait += r.AvgWaitMinutes * float64(r.TicketsMeasured)
		n += r.TicketsMeasured
	}
	if n == 0 {
		return Timing{}
	}
	return Timing{
		AvgServiceMinutes: round1(service / float64(n)),
		AvgWaitMinutes:    round1(wait / float64(n)),
		TicketsMeasured:   n,
	}
}

func aggregatePeakHours(rows []db.StatsPeakHoursRow, acc access, filter *uuid.UUID) []HourPoint {
	var counts [24]int64
	for _, r := range rows {
		if !visible(acc, filter, r.OutletID) {
			continue
		}
		if r.HourOfDay < 0 || r.HourOfDay > 23 {
			continue
		}
		counts[r.HourOfDay] += r.TicketsStarted
	}
	points := make([]HourPoint, 24)
	for h := 0; h < 24; h++ {
		points[h] = HourPoint{Hour: h, TicketsStarted: counts[h]}
	}
	return points
}

func (s *Service) Overview(ctx context.Context, tenantID, userID uuid.UUID, from, to time.Time, outletFilter *uuid.UUID) (OverviewResult, error) {
	q := s.queries(ctx)
	acc, err := s.resolveAccess(ctx, q, tenantID, userID, false)
	if err != nil {
		return OverviewResult{}, err
	}
	if outletFilter != nil && !acc.allows(*outletFilter) {
		return OverviewResult{}, httpx.Forbidden("outlet_tidak_diizinkan", "Anda tidak punya akses ke outlet ini", nil)
	}

	rows, err := q.StatsDailyByOutlet(ctx, db.StatsDailyByOutletParams{TenantID: tenantID, FromDate: toDate(from), ToDate: toDate(to)})
	if err != nil {
		return OverviewResult{}, httpx.Internal(fmt.Errorf("ambil statistik harian: %w", err))
	}
	cur := aggregateRows(rows, acc, outletFilter)

	// Periode pembanding: rentang sama panjang tepat sebelum periode ini.
	spanDays := int(to.Sub(from).Hours()/24) + 1
	prevTo := from.AddDate(0, 0, -1)
	prevFrom := prevTo.AddDate(0, 0, -(spanDays - 1))
	prevRows, err := q.StatsDailyByOutlet(ctx, db.StatsDailyByOutletParams{TenantID: tenantID, FromDate: toDate(prevFrom), ToDate: toDate(prevTo)})
	if err != nil {
		return OverviewResult{}, httpx.Internal(fmt.Errorf("ambil statistik periode sebelumnya: %w", err))
	}
	prev := aggregateRows(prevRows, acc, outletFilter)

	timingRows, err := q.StatsTimingByOutlet(ctx, db.StatsTimingByOutletParams{TenantID: tenantID, FromDate: toDate(from), ToDate: toDate(to)})
	if err != nil {
		return OverviewResult{}, httpx.Internal(fmt.Errorf("ambil statistik waktu: %w", err))
	}
	peakRows, err := q.StatsPeakHours(ctx, db.StatsPeakHoursParams{TenantID: tenantID, FromDate: toDate(from), ToDate: toDate(to)})
	if err != nil {
		return OverviewResult{}, httpx.Internal(fmt.Errorf("ambil statistik jam sibuk: %w", err))
	}

	return OverviewResult{
		From:     from.Format("2006-01-02"),
		To:       to.Format("2006-01-02"),
		Totals:   cur.totals,
		Previous: prev.totals,
		ChangePct: Change{
			Customers: changePct(cur.totals.TicketsCompleted, prev.totals.TicketsCompleted),
			Revenue:   changePct(cur.totals.RevenueRupiah, prev.totals.RevenueRupiah),
		},
		Daily:     cur.days,
		ByOutlet:  cur.outlets,
		Timing:    aggregateTiming(timingRows, acc, outletFilter),
		PeakHours: aggregatePeakHours(peakRows, acc, outletFilter),
	}, nil
}

// --- Statistik kapster (khusus owner) ---

type KapsterStat struct {
	MembershipID      uuid.UUID `json:"membership_id"`
	KapsterEmail      string    `json:"kapster_email"`
	TicketsCompleted  int64     `json:"tickets_completed"`
	RevenueRupiah     int64     `json:"revenue_rupiah"`
	AvgServiceMinutes float64   `json:"avg_service_minutes"`
	SkipCount         int64     `json:"skip_count"`
	SkipRatePct       float64   `json:"skip_rate_pct"`
	ReviewCount       int64     `json:"review_count"`
	AvgRating         float64   `json:"avg_rating"`
}

func (s *Service) Kapsters(ctx context.Context, tenantID, userID uuid.UUID, from, to time.Time) ([]KapsterStat, error) {
	q := s.queries(ctx)
	if _, err := s.resolveAccess(ctx, q, tenantID, userID, true); err != nil {
		return nil, err
	}
	rows, err := q.StatsKapsterPerformance(ctx, db.StatsKapsterPerformanceParams{TenantID: tenantID, FromDate: toDate(from), ToDate: toDate(to)})
	if err != nil {
		return nil, httpx.Internal(fmt.Errorf("ambil statistik kapster: %w", err))
	}
	result := make([]KapsterStat, 0, len(rows))
	for _, r := range rows {
		st := KapsterStat{
			MembershipID:      r.MembershipID,
			KapsterEmail:      r.KapsterEmail,
			TicketsCompleted:  r.TicketsCompleted,
			RevenueRupiah:     r.RevenueRupiah,
			AvgServiceMinutes: round1(r.AvgServiceMinutes),
			SkipCount:         r.SkipCount,
			ReviewCount:       r.ReviewCount,
			AvgRating:         round2(r.AvgRating),
		}
		if calls := r.TicketsCompleted + r.SkipCount; calls > 0 {
			st.SkipRatePct = round1(float64(r.SkipCount) / float64(calls) * 100)
		}
		result = append(result, st)
	}
	return result, nil
}

// --- Statistik platform (khusus pemilik SaaS) ---

type PlatformTenants struct {
	Total               int64    `json:"total"`
	NeverSubscribed     int64    `json:"never_subscribed"`
	Active              int64    `json:"active"`
	Grace               int64    `json:"grace"`
	ReadOnly            int64    `json:"read_only"`
	Churned30d          int64    `json:"churned_30d"`
	ChurnRate30dPct     *float64 `json:"churn_rate_30d_pct"`
	EverPaid            int64    `json:"ever_paid"`
	ConversionPct       *float64 `json:"conversion_pct"`
	MidtransConfigured  int64    `json:"midtrans_configured"`
	OnboardingCompleted int64    `json:"onboarding_completed"`
	Outlets             int64    `json:"outlets"`
	Staff               int64    `json:"staff"`
	Users               int64    `json:"users"`
}

type PlatformRevenue struct {
	MRRRupiah  int64 `json:"mrr_rupiah"`
	ARRRupiah  int64 `json:"arr_rupiah"`
	ARPARupiah int64 `json:"arpa_rupiah"`
}

type PlatformBilling struct {
	PendingInvoices     int64 `json:"pending_invoices"`
	PendingAmountRupiah int64 `json:"pending_amount_rupiah"`
	Expiring7d          int64 `json:"expiring_7d"`
	Expiring7dRupiah    int64 `json:"expiring_7d_rupiah"`
}

type PlatformActivity struct {
	ActiveOutlets    int64 `json:"active_outlets"`
	TicketsCompleted int64 `json:"tickets_completed"`
	GMVRupiah        int64 `json:"gmv_rupiah"`
}

type MonthPoint struct {
	Month          string `json:"month"`
	TenantsCreated int64  `json:"tenants_created"`
	InvoicesPaid   int64  `json:"invoices_paid"`
	RevenueRupiah  int64  `json:"revenue_rupiah"`
}

type PlatformStats struct {
	Tenants  PlatformTenants  `json:"tenants"`
	Revenue  PlatformRevenue  `json:"revenue"`
	Billing  PlatformBilling  `json:"billing"`
	Activity PlatformActivity `json:"activity_30d"`
	Monthly  []MonthPoint     `json:"monthly"`
}

// Platform dipanggil di belakang RequirePlatformAdmin. Tidak menyentuh tabel
// reviews, jadi isi ulasan dan komentar tidak pernah ikut terbaca.
func (s *Service) Platform(ctx context.Context) (PlatformStats, error) {
	q := s.queries(ctx)
	wib := time.FixedZone("WIB", 7*60*60)
	now := time.Now().In(wib)

	status, err := q.PlatformTenantStatusCounts(ctx)
	if err != nil {
		return PlatformStats{}, httpx.Internal(fmt.Errorf("status tenant: %w", err))
	}
	totals, err := q.PlatformTotals(ctx)
	if err != nil {
		return PlatformStats{}, httpx.Internal(fmt.Errorf("total platform: %w", err))
	}
	mrr, err := q.PlatformMRR(ctx)
	if err != nil {
		return PlatformStats{}, httpx.Internal(fmt.Errorf("mrr: %w", err))
	}
	billingQueue, err := q.PlatformBillingQueue(ctx)
	if err != nil {
		return PlatformStats{}, httpx.Internal(fmt.Errorf("antrian tagihan: %w", err))
	}

	firstOfMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, wib)
	since := firstOfMonth.AddDate(0, -11, 0)
	revenueRows, err := q.PlatformRevenueByMonth(ctx, dbx.TS(since))
	if err != nil {
		return PlatformStats{}, httpx.Internal(fmt.Errorf("pendapatan bulanan: %w", err))
	}
	signupRows, err := q.PlatformSignupsByMonth(ctx, dbx.TS(since))
	if err != nil {
		return PlatformStats{}, httpx.Internal(fmt.Errorf("pendaftar bulanan: %w", err))
	}

	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	activity, err := q.PlatformActivity(ctx, db.PlatformActivityParams{FromDate: toDate(today.AddDate(0, 0, -29)), ToDate: toDate(today)})
	if err != nil {
		return PlatformStats{}, httpx.Internal(fmt.Errorf("aktivitas platform: %w", err))
	}

	monthly := make([]MonthPoint, 0, 12)
	idx := map[string]int{}
	for i := 11; i >= 0; i-- {
		label := firstOfMonth.AddDate(0, -i, 0).Format("2006-01")
		idx[label] = len(monthly)
		monthly = append(monthly, MonthPoint{Month: label})
	}
	for _, r := range revenueRows {
		if i, ok := idx[r.Month]; ok {
			monthly[i].InvoicesPaid = r.InvoicesPaid
			monthly[i].RevenueRupiah = r.RevenueRupiah
		}
	}
	for _, r := range signupRows {
		if i, ok := idx[r.Month]; ok {
			monthly[i].TenantsCreated = r.TenantsCreated
		}
	}

	mrrRupiah := int64(math.Round(mrr))
	var arpa int64
	if status.Active > 0 {
		arpa = mrrRupiah / status.Active
	}

	return PlatformStats{
		Tenants: PlatformTenants{
			Total:               status.TotalTenants,
			NeverSubscribed:     status.NeverSubscribed,
			Active:              status.Active,
			Grace:               status.Grace,
			ReadOnly:            status.ReadOnly,
			Churned30d:          status.Churned30d,
			ChurnRate30dPct:     ratioPct(status.Churned30d, status.Active+status.Churned30d),
			EverPaid:            totals.EverPaid,
			ConversionPct:       ratioPct(totals.EverPaid, status.TotalTenants),
			MidtransConfigured:  totals.MidtransConfigured,
			OnboardingCompleted: totals.OnboardingCompleted,
			Outlets:             totals.OutletsTotal,
			Staff:               totals.StaffTotal,
			Users:               totals.UsersTotal,
		},
		Revenue: PlatformRevenue{MRRRupiah: mrrRupiah, ARRRupiah: mrrRupiah * 12, ARPARupiah: arpa},
		Billing: PlatformBilling{
			PendingInvoices:     billingQueue.PendingInvoices,
			PendingAmountRupiah: billingQueue.PendingAmountRupiah,
			Expiring7d:          billingQueue.Expiring7d,
			Expiring7dRupiah:    billingQueue.Expiring7dRupiah,
		},
		Activity: PlatformActivity{
			ActiveOutlets:    activity.ActiveOutlets,
			TicketsCompleted: activity.TicketsCompleted,
			GMVRupiah:        activity.GmvRupiah,
		},
		Monthly: monthly,
	}, nil
}