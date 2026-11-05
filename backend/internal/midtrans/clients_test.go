package midtrans

import (
	"context"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestVerifySignature(t *testing.T) {
	orderID, statusCode, grossAmount, serverKey := "order-123", "200", "10000.00", "server-secret"
	sum := sha512.Sum512([]byte(orderID + statusCode + grossAmount + serverKey))
	validSignature := hex.EncodeToString(sum[:])

	if !VerifySignature(orderID, statusCode, grossAmount, serverKey, validSignature) {
		t.Fatal("VerifySignature menolak tanda tangan yang valid")
	}
	if VerifySignature(orderID, statusCode, grossAmount, serverKey, validSignature[:len(validSignature)-1]+"0") {
		t.Fatal("VerifySignature menerima tanda tangan yang salah")
	}
	if VerifySignature(orderID, statusCode, grossAmount, serverKey, "") {
		t.Fatal("VerifySignature menerima tanda tangan kosong")
	}
}

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
		_, _ = w.Write([]byte(`{"order_id":"test-order","actions":[{"name":"generate-qr-code","url":"https://example.test/qr.png"}]}`))
	}))
	defer server.Close()

	client := &Client{httpClient: &http.Client{Timeout: time.Second}, baseOverride: server.URL}
	result, err := client.ChargeQRIS(context.Background(), "test-key", false, "test-order", 10000)
	if err != nil {
		t.Fatalf("ChargeQRIS() error = %v", err)
	}
	if result.QRCodeURL != "https://example.test/qr.png" {
		t.Fatalf("QRCodeURL = %q, want the QR code action URL", result.QRCodeURL)
	}
}

func TestChargeQRISRejectsResponseWithoutQR(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"order_id":"test-order","actions":[]}`))
	}))
	defer server.Close()

	client := &Client{httpClient: &http.Client{Timeout: time.Second}, baseOverride: server.URL}
	if _, err := client.ChargeQRIS(context.Background(), "test-key", false, "test-order", 10000); err == nil {
		t.Fatal("ChargeQRIS() unexpectedly accepted a response without a QR code URL")
	}
}
