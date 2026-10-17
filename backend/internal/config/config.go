package config

import (
	"fmt"
	"os"
)

type Config struct {
	AppEnv             string
	Port               string
	AppDatabaseURL     string
	ResendAPIKey       string
	EmailFrom          string
	PublicBaseURL      string
	EncryptionKey      string
	DevAutoVerifyEmail bool
	VAPIDPublicKey     string
	VAPIDPrivateKey    string
	VAPIDSubject       string
	AppBaseURL         string
	SentryDSN          string
}

func Load() (Config, error) {
	cfg := Config{
		AppEnv:             getenv("APP_ENV", "development"),
		Port:               getenv("PORT", "8080"),
		AppDatabaseURL:     os.Getenv("APP_DATABASE_URL"),
		ResendAPIKey:       os.Getenv("RESEND_API_KEY"),
		EmailFrom:          getenv("EMAIL_FROM", "onboarding@resend.dev"),
		PublicBaseURL:      getenv("PUBLIC_BASE_URL", "http://localhost:8080"),
		EncryptionKey:      os.Getenv("ENCRYPTION_KEY"),
		DevAutoVerifyEmail: os.Getenv("DEV_AUTO_VERIFY") == "true",
		VAPIDPublicKey:     os.Getenv("VAPID_PUBLIC_KEY"),
		VAPIDPrivateKey:    os.Getenv("VAPID_PRIVATE_KEY"),
		VAPIDSubject:       getenv("VAPID_SUBJECT", "mailto:admin@kapsflow.com"),
		AppBaseURL:         getenv("APP_BASE_URL", "http://localhost:5173"),
		SentryDSN:          os.Getenv("SENTRY_DSN"),
	}
	if cfg.AppEnv != "development" && cfg.AppEnv != "test" && cfg.AppEnv != "production" {
		return Config{}, fmt.Errorf("APP_ENV harus development, test, atau production")
	}
	if cfg.AppEnv == "production" && cfg.DevAutoVerifyEmail {
		return Config{}, fmt.Errorf("DEV_AUTO_VERIFY tidak boleh true saat APP_ENV=production")
	}
	if cfg.AppDatabaseURL == "" {
		return Config{}, fmt.Errorf("APP_DATABASE_URL wajib diisi")
	}
	if cfg.EncryptionKey == "" {
		return Config{}, fmt.Errorf("ENCRYPTION_KEY wajib diisi")
	}
	if cfg.VAPIDPublicKey == "" || cfg.VAPIDPrivateKey == "" {
		return Config{}, fmt.Errorf("VAPID_PUBLIC_KEY dan VAPID_PRIVATE_KEY wajib diisi")
	}
	return cfg, nil
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}