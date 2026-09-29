package identity

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
)

// Parameter argon2id sengaja moderat (bukan yang paling berat) karena
// server akan jalan di VPS kecil dengan RAM terbatas.
const (
	argonMemoryKB    = 64 * 1024 // 64 MB
	argonIterations  = 3
	argonParallelism = 2
	argonSaltLen     = 16
	argonKeyLen      = 32
)

// HashPassword menghasilkan satu string yang memuat parameter, salt, dan
// hash sekaligus: $argon2id$v=19$m=...,t=...,p=...$salt$hash
func HashPassword(password string) (string, error) {
	salt := make([]byte, argonSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("membaca random salt: %w", err)
	}

	hash := argon2.IDKey([]byte(password), salt, argonIterations, argonMemoryKB, argonParallelism, argonKeyLen)

	encoded := fmt.Sprintf("$argon2id$v=19$m=%d,t=%d,p=%d$%s$%s",
		argonMemoryKB, argonIterations, argonParallelism,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(hash),
	)
	return encoded, nil
}

var ErrPasswordMismatch = errors.New("password tidak cocok")

// VerifyPassword membandingkan password mentah dengan hash tersimpan, pakai
// perbandingan waktu-konstan supaya tahan timing attack.
func VerifyPassword(password, encoded string) error {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 {
		return errors.New("format hash tidak dikenali")
	}

	var mem, iter uint32
	var par uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &mem, &iter, &par); err != nil {
		return fmt.Errorf("membaca parameter hash: %w", err)
	}

	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return fmt.Errorf("membaca salt: %w", err)
	}
	wantHash, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return fmt.Errorf("membaca hash: %w", err)
	}

	gotHash := argon2.IDKey([]byte(password), salt, iter, mem, par, uint32(len(wantHash)))

	if subtle.ConstantTimeCompare(gotHash, wantHash) != 1 {
		return ErrPasswordMismatch
	}
	return nil
}