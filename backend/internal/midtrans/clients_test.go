package midtrans

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestChargeQRISUsesFiveMinuteExpiry(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v2/charge" {
			t.Errorf("request = %s %s, want POST /v2/charge", r.Method, r.URL.Path)
		}
		var body struct {
			CustomExpiry struct {
				Duration int    `json:"expiry_duration"`
				Unit     string `json:"unit"`
			} `json:"custom_expiry"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode request body: %v", err)
		}
		if body.CustomExpiry.Duration != 5 || body.CustomExpiry.Unit != "minute" {
			t.Errorf("custom expiry = %d %s, want 5 minute", body.CustomExpiry.Duration, body.CustomExpiry.Unit)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"order_id":"test-order","actions":[]}`))
	}))
	defer server.Close()

	client := &Client{httpClient: &http.Client{Timeout: time.Second}, baseOverride: server.URL}
	if _, err := client.ChargeQRIS(context.Background(), "test-key", false, "test-order", 10000); err != nil {
		t.Fatalf("ChargeQRIS() error = %v", err)
	}
}
