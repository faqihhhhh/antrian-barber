package ratelimit

import (
	"log/slog"
	"math"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"kapsflow/internal/httpx"
)

const maxTrackedClients = 50000

type bucket struct {
	started time.Time
	count   int
}

// Limiter menyimpan penghitung tetap per kunci dalam memori satu proses API.
type Limiter struct {
	mu        sync.Mutex
	limit     int
	window    time.Duration
	clients   map[string]bucket
	nextSweep time.Time
}

func New(limit int, window time.Duration) *Limiter {
	if limit < 1 {
		limit = 1
	}
	if window <= 0 {
		window = time.Minute
	}
	return &Limiter{limit: limit, window: window, clients: make(map[string]bucket)}
}

func (l *Limiter) allowAt(key string, now time.Time) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()

	if !now.Before(l.nextSweep) {
		for client, current := range l.clients {
			if !now.Before(current.started.Add(l.window)) {
				delete(l.clients, client)
			}
		}
		l.nextSweep = now.Add(l.window)
	}

	current, ok := l.clients[key]
	if !ok && len(l.clients) >= maxTrackedClients {
		return false, l.nextSweep.Sub(now)
	}
	if !ok || !now.Before(current.started.Add(l.window)) {
		current = bucket{started: now}
	}
	if current.count >= l.limit {
		return false, current.started.Add(l.window).Sub(now)
	}
	current.count++
	l.clients[key] = current
	return true, 0
}

func clientIP(remoteAddr string) string {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err == nil {
		return host
	}
	remoteAddr = strings.Trim(remoteAddr, "[]")
	if remoteAddr == "" {
		return "unknown"
	}
	return remoteAddr
}

func (l *Limiter) Middleware(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			allowed, retryAfter := l.allowAt(clientIP(r.RemoteAddr), time.Now())
			if !allowed {
				seconds := int(math.Ceil(retryAfter.Seconds()))
				if seconds < 1 {
					seconds = 1
				}
				w.Header().Set("Retry-After", strconv.Itoa(seconds))
				httpx.Error(w, r, log, httpx.TooManyRequests(
					"terlalu_banyak_percobaan",
					"Terlalu banyak percobaan masuk. Coba lagi setelah beberapa saat.",
				))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
