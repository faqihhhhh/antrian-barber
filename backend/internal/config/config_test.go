package config

import "testing"

func TestLoadSentryDSNIsOptional(t *testing.T) {
	t.Setenv("APP_DATABASE_URL", "postgres://app:pass@localhost/db")
	t.Setenv("ENCRYPTION_KEY", "test-key")
	t.Setenv("VAPID_PUBLIC_KEY", "public")
	t.Setenv("VAPID_PRIVATE_KEY", "private")
	t.Setenv("SENTRY_DSN", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.SentryDSN != "" {
		t.Fatalf("SentryDSN = %q, ingin kosong", cfg.SentryDSN)
	}

	t.Setenv("SENTRY_DSN", "https://public@example.test/1")
	cfg, err = Load()
	if err != nil {
		t.Fatalf("Load() dengan SENTRY_DSN error = %v", err)
	}
	if cfg.SentryDSN != "https://public@example.test/1" {
		t.Fatalf("SentryDSN = %q, ingin nilai dari environment", cfg.SentryDSN)
	}
}
