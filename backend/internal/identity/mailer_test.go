package identity

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"
)

func TestConsoleMailerDoesNotLogRecipientOrEmailBody(t *testing.T) {
	var output bytes.Buffer
	mailer := &consoleMailer{log: slog.New(slog.NewTextHandler(&output, nil))}
	if err := mailer.Send(context.Background(), "pelanggan@example.test", "Verifikasi email", "token-rahasia-untuk-reset"); err != nil {
		t.Fatalf("Send() error = %v", err)
	}
	logged := output.String()
	for _, sensitiveValue := range []string{"pelanggan@example.test", "token-rahasia-untuk-reset"} {
		if strings.Contains(logged, sensitiveValue) {
			t.Fatalf("log memuat data email yang tidak boleh dicatat: %q", sensitiveValue)
		}
	}
	if !strings.Contains(logged, "Verifikasi email") {
		t.Fatalf("log tidak memuat subject untuk membantu pengembangan: %s", logged)
	}
}
