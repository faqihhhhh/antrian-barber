package queue

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestBookOnlineRouteRateLimit(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	router := chi.NewRouter()
	RegisterRoutes(router, nil, log, nil, func(next http.Handler) http.Handler { return next })
	path := "/3159e203-02c0-49b0-8fe5-1e94ebbae2e1/outlets/3ae1bd6e-fb87-4963-9ef4-d93e998e03c6/book"

	for attempt := 1; attempt <= 6; attempt++ {
		request := httptest.NewRequest(http.MethodPost, path, strings.NewReader("{"))
		request.RemoteAddr = "192.0.2.25:12345"
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)

		if attempt < 6 && response.Code != http.StatusBadRequest {
			t.Fatalf("permintaan %d mendapat status %d, ingin 400 dari body tidak valid", attempt, response.Code)
		}
		if attempt == 6 {
			if response.Code != http.StatusTooManyRequests {
				t.Fatalf("permintaan ke-6 mendapat status %d, ingin 429", response.Code)
			}
			if response.Header().Get("Retry-After") == "" {
				t.Fatal("respons 429 tidak menyertakan Retry-After")
			}
			if !strings.Contains(response.Body.String(), "terlalu_banyak_pemesanan") {
				t.Fatalf("kode error pemesanan tidak ada: %s", response.Body.String())
			}
		}
	}
}
