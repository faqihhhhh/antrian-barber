package identity

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
)

// generateToken membuat token acak aman secara kriptografis (dikirim ke
// pengguna lewat email/cookie), 32 byte sebelum di-encode.
func generateToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("membaca random token: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// hashToken menghasilkan hash SHA-256 dari token mentah, inilah yang
// disimpan ke database — bukan token aslinya.
func hashToken(rawToken string) string {
	sum := sha256.Sum256([]byte(rawToken))
	return hex.EncodeToString(sum[:])
}