package cryptox

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
)

// Box mengenkripsi/mendekripsi data sensitif (kunci Midtrans milik owner)
// dengan AES-256-GCM, memakai satu kunci master dari environment variable.
// Ini bukan pengganti KMS sungguhan, tapi cukup untuk skala sekarang:
// serangan yang dicegah adalah "database bocor tapi server aplikasi aman",
// bukan "server aplikasi itu sendiri disusupi".
type Box struct {
	gcm cipher.AEAD
}

func NewBox(masterKeyBase64 string) (*Box, error) {
	key, err := base64.StdEncoding.DecodeString(masterKeyBase64)
	if err != nil {
		return nil, fmt.Errorf("ENCRYPTION_KEY bukan base64 valid: %w", err)
	}
	if len(key) != 32 {
		return nil, fmt.Errorf("ENCRYPTION_KEY harus persis 32 byte setelah decode base64 (dapat %d byte)", len(key))
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &Box{gcm: gcm}, nil
}

func (b *Box) Encrypt(plaintext string) (string, error) {
	nonce := make([]byte, b.gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	ciphertext := b.gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.StdEncoding.EncodeToString(ciphertext), nil
}

func (b *Box) Decrypt(encoded string) (string, error) {
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", err
	}
	nonceSize := b.gcm.NonceSize()
	if len(data) < nonceSize {
		return "", errors.New("data terenkripsi tidak valid")
	}
	nonce, ciphertext := data[:nonceSize], data[nonceSize:]
	plaintext, err := b.gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", err
	}
	return string(plaintext), nil
}