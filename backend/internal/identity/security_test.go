package identity

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestResetPasswordPageEscapesTokenAndDisablesCaching(t *testing.T) {
	h := NewHandlers(nil, slog.New(slog.NewTextHandler(io.Discard, nil)), false)
	req := httptest.NewRequest(http.MethodGet, "/reset-password?token=%22%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E", nil)
	response := httptest.NewRecorder()
	h.ResetPasswordPage(response, req)

	body := response.Body.String()
	if strings.Contains(body, `<script>alert(1)</script>`) {
		t.Fatal("token tampil sebagai elemen HTML aktif")
	}
	if !strings.Contains(body, `value="&#34;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"`) {
		t.Fatalf("token tidak di-escape dalam atribut HTML: %s", body)
	}
	if got := response.Header().Get("Cache-Control"); got != "no-store" {
		t.Errorf("Cache-Control = %q, ingin no-store", got)
	}
	if got := response.Header().Get("Referrer-Policy"); got != "no-referrer" {
		t.Errorf("Referrer-Policy = %q, ingin no-referrer", got)
	}
	if got := response.Header().Get("Content-Security-Policy"); got == "" {
		t.Error("Content-Security-Policy tidak disetel")
	}
}

func TestSessionCookieSecurityAttributes(t *testing.T) {
	cookie := sessionCookie("session-token", true)
	if !cookie.Secure || !cookie.HttpOnly || cookie.SameSite != http.SameSiteLaxMode {
		t.Fatalf("atribut cookie tidak aman: %+v", cookie)
	}
}

func TestPasswordResetRequestRateLimit(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	handler := Routes(nil, log, false)
	for attempt := 1; attempt <= 6; attempt++ {
		request := httptest.NewRequest(http.MethodPost, "/forgot-password", strings.NewReader("{"))
		request.RemoteAddr = "192.0.2.20:12345"
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)

		if attempt <= 5 && response.Code != http.StatusBadRequest {
			t.Fatalf("percobaan %d mendapat status %d, ingin 400 sebelum limit", attempt, response.Code)
		}
		if attempt == 6 {
			if response.Code != http.StatusTooManyRequests {
				t.Fatalf("percobaan ke-6 mendapat status %d, ingin 429", response.Code)
			}
			if response.Header().Get("Retry-After") == "" {
				t.Fatal("respons 429 tidak menyertakan Retry-After")
			}
		}
	}
}
