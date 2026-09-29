package config

import (
	"fmt"
	"os"
)

type Config struct {
	Port          string
	DatabaseURL   string
	ResendAPIKey  string
	EmailFrom     string
	PublicBaseURL string
}

func Load() (Config, error) {
	cfg := Config{
		Port:          getenv("PORT", "8080"),
		DatabaseURL:   os.Getenv("DATABASE_URL"),
		ResendAPIKey:  os.Getenv("RESEND_API_KEY"),
		EmailFrom:     getenv("EMAIL_FROM", "onboarding@resend.dev"),
		PublicBaseURL: getenv("PUBLIC_BASE_URL", "http://localhost:8080"),
	}
	if cfg.DatabaseURL == "" {
		return Config{}, fmt.Errorf("DATABASE_URL wajib diisi")
	}
	return cfg, nil
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}