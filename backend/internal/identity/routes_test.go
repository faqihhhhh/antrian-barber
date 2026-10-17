package identity

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestLoginRouteRateLimit(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	handler := Routes(nil, log)
	for attempt := 1; attempt <= 11; attempt++ {
		request := httptest.NewRequest(http.MethodPost, "/login", strings.NewReader("{"))
		request.RemoteAddr = "192.0.2.10:12345"
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)

		if attempt <= 10 && response.Code != http.StatusBadRequest {
			t.Fatalf("percobaan %d mendapat status %d, ingin 400 dari body yang tidak valid", attempt, response.Code)
		}
		if attempt == 11 {
			if response.Code != http.StatusTooManyRequests {
				t.Fatalf("percobaan ke-11 mendapat status %d, ingin 429", response.Code)
			}
			if response.Header().Get("Retry-After") == "" {
				t.Fatal("respons 429 tidak menyertakan Retry-After")
			}
		}
	}
}
