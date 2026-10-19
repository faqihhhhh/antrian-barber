package identity

import (
	"strings"

	"kapsflow/internal/httpx"
)

// NormalizeUsername returns a lowercase username suitable for storage.
func NormalizeUsername(raw string) (string, error) {
	username := strings.ToLower(strings.TrimSpace(raw))
	if len(username) < 3 || len(username) > 24 {
		return "", httpx.BadRequest("username_tidak_valid", "Username harus berisi 3 sampai 24 karakter", nil)
	}
	for i, char := range username {
		if (char >= 'a' && char <= 'z') || (i > 0 && char >= '0' && char <= '9') || (i > 0 && char == '_') {
			continue
		}
		return "", httpx.BadRequest("username_tidak_valid", "Username harus diawali huruf dan hanya berisi huruf kecil, angka, atau garis bawah", nil)
	}
	return username, nil
}
