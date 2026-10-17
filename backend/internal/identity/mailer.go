package identity

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"
)

// Mailer adalah abstraksi pengiriman email. Ganti provider nanti (Brevo,
// SES, dst) cukup dengan implementasi baru dari interface ini — kode
// pemanggil (service.go) tidak perlu diubah.
type Mailer interface {
	Send(ctx context.Context, to, subject, htmlBody string) error
}

// consoleMailer menulis isi email ke log. Dipakai otomatis kalau
// RESEND_API_KEY kosong, supaya pengembangan lokal tidak memakai jatah
// kirim asli.
type consoleMailer struct {
	log *slog.Logger
}

func (m *consoleMailer) Send(_ context.Context, _ string, subject, _ string) error {
	m.log.Info("EMAIL (mode console, tidak benar-benar terkirim)", "subject", subject)
	return nil
}

type resendMailer struct {
	apiKey string
	from   string
	client *http.Client
}

func NewMailer(apiKey, from string, log *slog.Logger) Mailer {
	if apiKey == "" {
		return &consoleMailer{log: log}
	}
	return &resendMailer{apiKey: apiKey, from: from, client: &http.Client{Timeout: 10 * time.Second}}
}

func (m *resendMailer) Send(ctx context.Context, to, subject, htmlBody string) error {
	payload, err := json.Marshal(map[string]any{
		"from":    m.from,
		"to":      []string{to},
		"subject": subject,
		"html":    htmlBody,
	})
	if err != nil {
		return fmt.Errorf("membuat payload email: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.resend.com/emails", bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("membuat request ke resend: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+m.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := m.client.Do(req)
	if err != nil {
		return fmt.Errorf("mengirim request ke resend: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		return fmt.Errorf("resend membalas status %d", resp.StatusCode)
	}
	return nil
}