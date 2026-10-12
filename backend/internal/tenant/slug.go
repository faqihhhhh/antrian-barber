package tenant

import (
	"crypto/rand"
	"strings"
)

const slugSuffixAlphabet = "abcdefghjkmnpqrstuvwxyz23456789"

// slugify mengubah nama outlet menjadi bagian alamat publik: huruf kecil, angka,
// dan tanda hubung. Nama yang tidak punya huruf atau angka jadi "outlet".
func slugify(name string) string {
	var b strings.Builder
	lastDash := true // supaya tidak diawali "-"
	for _, r := range strings.ToLower(name) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			lastDash = false
		} else if !lastDash {
			b.WriteByte('-')
			lastDash = true
		}
	}
	s := strings.TrimRight(b.String(), "-")
	if len(s) > 40 {
		s = strings.TrimRight(s[:40], "-")
	}
	if s == "" {
		s = "outlet"
	}
	return s
}

func randomSuffix(n int) (string, error) {
	raw := make([]byte, n)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	out := make([]byte, n)
	for i, v := range raw {
		out[i] = slugSuffixAlphabet[int(v)%len(slugSuffixAlphabet)]
	}
	return string(out), nil
}