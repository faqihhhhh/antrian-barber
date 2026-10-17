package config

import "testing"

func TestLoadSentryDSNIsOptional(t *testing.T) {
	t.Setenv("APP_DATABASE_URL", "postgres://app:pass@localhost/db")
	t.Setenv("ENCRYPTION_KEY", "test-key")
	t.Setenv("VAPID_PUBLIC_KEY", "public")
	t.Setenv("VAPID_PRIVATE_KEY", "private")
	t.Setenv("APP_ENV", "development")
	t.Setenv("DEV_AUTO_VERIFY", "false")
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

func TestLoadDevAutoVerifyEnvironmentGuard(t *testing.T) {
	t.Setenv("APP_DATABASE_URL", "postgres://app:pass@localhost/db")
	t.Setenv("ENCRYPTION_KEY", "test-key")
	t.Setenv("VAPID_PUBLIC_KEY", "public")
	t.Setenv("VAPID_PRIVATE_KEY", "private")

	cases := []struct {
		name       string
		appEnv     string
		autoVerify string
		wantError  bool
	}{
		{name: "development mengizinkan auto verify", appEnv: "development", autoVerify: "true"},
		{name: "production menolak auto verify", appEnv: "production", autoVerify: "true", wantError: true},
		{name: "production mengizinkan verifikasi normal", appEnv: "production", autoVerify: "false"},
		{name: "environment tidak dikenal ditolak", appEnv: "staging", autoVerify: "false", wantError: true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("APP_ENV", tc.appEnv)
			t.Setenv("DEV_AUTO_VERIFY", tc.autoVerify)
			_, err := Load()
			if (err != nil) != tc.wantError {
				t.Fatalf("Load() error = %v, wantError = %v", err, tc.wantError)
			}
		})
	}
}
