package ratelimit

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestLimiterWindowAndClientIsolation(t *testing.T) {
	limiter := New(2, time.Minute)
	now := time.Date(2026, 10, 17, 0, 0, 0, 0, time.UTC)

	for attempt := 0; attempt < 2; attempt++ {
		if allowed, _ := limiter.allowAt("192.0.2.1", now); !allowed {
			t.Fatalf("percobaan %d seharusnya diizinkan", attempt+1)
		}
	}
	if allowed, retry := limiter.allowAt("192.0.2.1", now); allowed || retry != time.Minute {
		t.Fatalf("batas tidak diterapkan: allowed=%v retry=%s", allowed, retry)
	}
	if allowed, _ := limiter.allowAt("192.0.2.2", now); !allowed {
		t.Fatal("alamat klien lain seharusnya memiliki batas terpisah")
	}
	if allowed, _ := limiter.allowAt("192.0.2.1", now.Add(time.Minute)); !allowed {
		t.Fatal("batas seharusnya pulih setelah jendela berakhir")
	}
}

func TestMiddlewareReturns429AfterLimit(t *testing.T) {
	limiter := New(1, time.Hour)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	calls := 0
	handler := limiter.Middleware(log)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		w.WriteHeader(http.StatusNoContent)
	}))

	for attempt := 0; attempt < 2; attempt++ {
		request := httptest.NewRequest(http.MethodPost, "/login", nil)
		request.RemoteAddr = "192.0.2.4:12345"
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if attempt == 0 && response.Code != http.StatusNoContent {
			t.Fatalf("permintaan pertama mendapat status %d", response.Code)
		}
		if attempt == 1 {
			if response.Code != http.StatusTooManyRequests {
				t.Fatalf("permintaan kedua mendapat status %d, ingin 429", response.Code)
			}
			if response.Header().Get("Retry-After") != "3600" {
				t.Fatalf("Retry-After = %q, ingin 3600", response.Header().Get("Retry-After"))
			}
			if !strings.Contains(response.Body.String(), "terlalu_banyak_percobaan") {
				t.Fatalf("kode error tidak ada pada respons: %s", response.Body.String())
			}
		}
	}
	if calls != 1 {
		t.Fatalf("handler berikutnya dipanggil %d kali, ingin 1", calls)
	}
}

func TestClientIPHandlesIPv6(t *testing.T) {
	if got := clientIP("[2001:db8::1]:8080"); got != "2001:db8::1" {
		t.Fatalf("clientIP() = %q", got)
	}
}
