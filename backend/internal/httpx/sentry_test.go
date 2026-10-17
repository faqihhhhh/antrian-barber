package httpx

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/getsentry/sentry-go"
)

type recordingTransport struct {
	events chan *sentry.Event
}

func (transport *recordingTransport) Configure(sentry.ClientOptions)        {}
func (transport *recordingTransport) Flush(time.Duration) bool              { return true }
func (transport *recordingTransport) FlushWithContext(context.Context) bool { return true }
func (transport *recordingTransport) Close()                                {}
func (transport *recordingTransport) SendEvent(event *sentry.Event) {
	transport.events <- event
}

func TestErrorCapturesServerFailureToSentry(t *testing.T) {
	transport := &recordingTransport{events: make(chan *sentry.Event, 1)}
	client, err := sentry.NewClient(sentry.ClientOptions{
		Dsn:       "https://public@example.test/1",
		Transport: transport,
	})
	if err != nil {
		t.Fatalf("NewClient() error = %v", err)
	}
	hub := sentry.NewHub(client, sentry.NewScope())
	ctx := sentry.SetHubOnContext(context.Background(), hub)
	request := httptest.NewRequest(http.MethodGet, "/v1/tes", nil).WithContext(ctx)
	response := httptest.NewRecorder()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))

	Error(response, request, log, Internal(errors.New("database unavailable")))
	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, ingin 500", response.Code)
	}
	if !hub.Flush(time.Second) {
		t.Fatal("event Sentry belum terkirim setelah flush")
	}
	select {
	case <-transport.events:
	case <-time.After(time.Second):
		t.Fatal("error 500 tidak dikirim ke transport Sentry")
	}
}

func TestRecovererCapturesPanicToSentry(t *testing.T) {
	transport := &recordingTransport{events: make(chan *sentry.Event, 1)}
	client, err := sentry.NewClient(sentry.ClientOptions{
		Dsn:       "https://public@example.test/1",
		Transport: transport,
	})
	if err != nil {
		t.Fatalf("NewClient() error = %v", err)
	}
	hub := sentry.NewHub(client, sentry.NewScope())
	ctx := sentry.SetHubOnContext(context.Background(), hub)
	request := httptest.NewRequest(http.MethodGet, "/v1/panic", nil).WithContext(ctx)
	response := httptest.NewRecorder()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	handler := Recoverer(log)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("test panic")
	}))

	handler.ServeHTTP(response, request)
	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, ingin 500", response.Code)
	}
	if !hub.Flush(time.Second) {
		t.Fatal("event Sentry belum terkirim setelah flush")
	}
	select {
	case <-transport.events:
	case <-time.After(time.Second):
		t.Fatal("panic tidak dikirim ke transport Sentry")
	}
}
