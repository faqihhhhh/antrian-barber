package config

import (
	"fmt"
	"os"
)

type Config struct {
	Port           string
	AppDatabaseURL string
	ResendAPIKey   string
	EmailFrom      string
	PublicBaseURL  string
	EncryptionKey  string
}

func Load() (Config, error) {
	cfg := Config{
		Port:           getenv("PORT", "8080"),
		AppDatabaseURL: os.Getenv("APP_DATABASE_URL"),
		ResendAPIKey:   os.Getenv("RESEND_API_KEY"),
		EmailFrom:      getenv("EMAIL_FROM", "onboarding@resend.dev"),
		PublicBaseURL:  getenv("PUBLIC_BASE_URL", "http://localhost:8080"),
		EncryptionKey:  os.Getenv("ENCRYPTION_KEY"),
	}
	if cfg.AppDatabaseURL == "" {
		return Config{}, fmt.Errorf("APP_DATABASE_URL wajib diisi")
	}
	if cfg.EncryptionKey == "" {
		return Config{}, fmt.Errorf("ENCRYPTION_KEY wajib diisi")
	}
	return cfg, nil
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}