package identity

import (
	"strings"
	"unicode/utf8"

	"kapsflow/internal/httpx"
)

// NormalizeDisplayName trims and validates a human-readable name.
func NormalizeDisplayName(raw string) (string, error) {
	displayName := strings.TrimSpace(raw)
	length := utf8.RuneCountInString(displayName)
	if !utf8.ValidString(displayName) || length < 1 || length > 60 {
		return "", httpx.BadRequest("display_name_tidak_valid", "Nama panggilan harus berisi 1 sampai 60 karakter", nil)
	}
	return displayName, nil
}
