package config

import (
	"fmt"
	"os"
)

type Config struct {
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
}

func Load() (Config, error) {
	cfg := Config{
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