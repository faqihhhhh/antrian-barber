package billing

import (
	"context"
	"fmt"
	"html"
	"math"
	"strconv"
	"time"

	db "kapsflow/internal/db"
	"kapsflow/internal/rls"
)

// ExpireStaleInvoices menandai invoice pending yang lewat batas waktu sebagai
// expired, supaya nominal uniknya bebas dipakai lagi.
func (s *Service) ExpireStaleInvoices(ctx context.Context) (int64, error) {
	var n int64
	err := rls.RunAsSystem(ctx, s.pool, func(c context.Context) error {
		affected, qErr := s.queries(c).ExpireStaleInvoices(c)
		n = affected
		return qErr
	})
	return n, err
}

// SendRenewalReminders mengirim email H-7 atau H-3 ke owner. Satu langganan
// hanya mendapat satu email per periode per jenis: kalau sudah masuk 3 hari
// terakhir, yang dikirim H-3 saja, tidak dua email sekaligus.
func (s *Service) SendRenewalReminders(ctx context.Context) (int, error) {
	var rows []db.ListSubscriptionsEndingSoonRow
	err := rls.RunAsSystem(ctx, s.pool, func(c context.Context) error {
		result, qErr := s.queries(c).ListSubscriptionsEndingSoon(c)
		rows = result
		return qErr
	})
	if err != nil {
		return 0, fmt.Errorf("ambil langganan yang akan berakhir: %w", err)
	}

	sent := 0
	for _, row := range rows {
		periodEnd := row.CurrentPeriodEnd.Time
		kind, alreadySent := "h7", row.H7Sent
		if time.Until(periodEnd) <= 3*24*time.Hour {
			kind, alreadySent = "h3", row.H3Sent
		}
		if alreadySent {
			continue
		}
		ok, err := s.sendReminder(ctx, row, kind, periodEnd)
		if err != nil {
			s.log.Error("gagal memproses pengingat langganan", "err", err, "tenant_id", row.TenantID)
			continue
		}
		if ok {
			sent++
		}
	}
	return sent, nil
}

func (s *Service) sendReminder(ctx context.Context, row db.ListSubscriptionsEndingSoonRow, kind string, periodEnd time.Time) (bool, error) {
	var emails []string
	err := rls.RunAsSystem(ctx, s.pool, func(c context.Context) error {
		result, qErr := s.queries(c).ListOwnerEmailsByTenant(c, row.TenantID)
		emails = result
		return qErr
	})
	if err != nil {
		return false, fmt.Errorf("ambil email owner: %w", err)
	}
	if len(emails) == 0 {
		return false, fmt.Errorf("tenant %s tidak punya owner", row.TenantID)
	}

	daysLeft := int(math.Ceil(time.Until(periodEnd).Hours() / 24))
	subject := fmt.Sprintf("Langganan Trimwait %s berakhir %d hari lagi", row.TenantName, daysLeft)
	body := renewalReminderHTML(row.TenantName, row.PlanName, row.PriceRupiah, periodEnd, daysLeft)

	delivered := 0
	for _, to := range emails {
		if err := s.mailer.Send(ctx, to, subject, body); err != nil {
			s.log.Error("gagal kirim pengingat langganan", "err", err, "tenant_id", row.TenantID, "kind", kind)
			continue
		}
		delivered++
	}
	if delivered == 0 {
		return false, nil // belum tercatat, dicoba lagi di putaran berikutnya
	}

	err = rls.RunAsSystem(ctx, s.pool, func(c context.Context) error {
		return s.queries(c).RecordSubscriptionReminder(c, db.RecordSubscriptionReminderParams{
			TenantID: row.TenantID, PeriodEnd: row.CurrentPeriodEnd, Kind: kind,
		})
	})
	if err != nil {
		return false, fmt.Errorf("mencatat pengingat: %w", err)
	}
	return true, nil
}

func renewalReminderHTML(tenantName, planName string, price int64, periodEnd time.Time, daysLeft int) string {
	return fmt.Sprintf(`<div style="font-family:sans-serif;max-width:480px;margin:auto">
		<h2>Langganan Trimwait hampir berakhir</h2>
		<p>Langganan <b>%s</b> (paket %s) akan berakhir pada <b>%s</b>, sekitar %d hari lagi.</p>
		<p>Perpanjang sebelum tanggal itu supaya antrian tetap berjalan. Biaya perpanjangan: <b>%s</b>.</p>
		<p>Setelah berakhir ada masa tenggang 3 hari. Sesudahnya akun masuk mode baca saja: data tetap aman dan bisa dilihat, tetapi pemesanan baru dan operasional antrian terkunci.</p>
		<p>Masuk ke aplikasi Trimwait, buka menu Langganan, lalu buat tagihan perpanjangan.</p>
	</div>`, html.EscapeString(tenantName), html.EscapeString(planName), formatDateID(periodEnd), daysLeft, formatRupiah(price))
}

var monthsID = [...]string{"Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"}

func formatDateID(t time.Time) string {
	t = t.In(time.FixedZone("WIB", 7*60*60))
	return fmt.Sprintf("%d %s %d", t.Day(), monthsID[t.Month()-1], t.Year())
}

func formatRupiah(n int64) string {
	s := strconv.FormatInt(n, 10)
	out := make([]byte, 0, len(s)+len(s)/3)
	for i := 0; i < len(s); i++ {
		if i > 0 && (len(s)-i)%3 == 0 {
			out = append(out, '.')
		}
		out = append(out, s[i])
	}
	return "Rp" + string(out)
}