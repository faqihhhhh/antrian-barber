package identity

import "testing"

func TestNormalizeDisplayNameAcceptsHumanNames(t *testing.T) {
	got, err := NormalizeDisplayName("  Pak Iteng  ")
	if err != nil {
		t.Fatalf("NormalizeDisplayName() error = %v", err)
	}
	if got != "Pak Iteng" {
		t.Fatalf("NormalizeDisplayName() = %q, want %q", got, "Pak Iteng")
	}
}

func TestNormalizeDisplayNameRejectsEmptyAndOverlongNames(t *testing.T) {
	for _, input := range []string{"   ", "1234567890123456789012345678901234567890123456789012345678901"} {
		if _, err := NormalizeDisplayName(input); err == nil {
			t.Errorf("NormalizeDisplayName(%q) succeeded, want validation error", input)
		}
	}
}
