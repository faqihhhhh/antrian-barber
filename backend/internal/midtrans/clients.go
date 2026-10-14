package midtrans

import (
	"bytes"
	"context"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
	"os"
)

type Client struct {
	httpClient   *http.Client
	baseOverride string
}

func NewClient() *Client {
	return &Client{
		httpClient:   &http.Client{Timeout: 15 * time.Second},
		baseOverride: os.Getenv("MIDTRANS_BASE_URL_OVERRIDE"),
	}
}
// baseURL otomatis sandbox kalau server key diawali "SB-", produksi kalau
// tidak — mengikuti konvensi penamaan kunci Midtrans sendiri.
func baseURL(isProduction bool) string {
	if isProduction {
		return "https://api.midtrans.com"
	}
	return "https://api.sandbox.midtrans.com"
}

// base memilih alamat API Midtrans. MIDTRANS_BASE_URL_OVERRIDE hanya untuk tes
// lokal dengan Midtrans tiruan (tanpa garis miring di akhir). JANGAN diisi di produksi.
func (c *Client) base(isProduction bool) string {
	if c.baseOverride != "" {
		return c.baseOverride
	}
	return baseURL(isProduction)
}

type ChargeResult struct {
	OrderID       string
	TransactionID string
	QRCodeURL     string
}
func (c *Client) ChargeQRIS(ctx context.Context, serverKey string, isProduction bool, orderID string, amountRupiah int64) (*ChargeResult, error) {

	body, _ := json.Marshal(map[string]any{
		"payment_type": "qris",
		"transaction_details": map[string]any{
			"order_id":     orderID,
			"gross_amount": amountRupiah,
		},
		"qris": map[string]any{"acquirer": "gopay"},
		"custom_expiry": map[string]any{
			"expiry_duration": 30,
			"unit":            "minute",
		},
	})

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base(isProduction)+"/v2/charge", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.SetBasicAuth(serverKey, "")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("menghubungi midtrans: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)

	var parsed struct {
		OrderID       string `json:"order_id"`
		TransactionID string `json:"transaction_id"`
		StatusMessage string `json:"status_message"`
		Actions       []struct {
			Name string `json:"name"`
			URL  string `json:"url"`
		} `json:"actions"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, fmt.Errorf("membaca respons midtrans: %w (raw: %s)", err, string(raw))
	}
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("midtrans menolak charge: %s", parsed.StatusMessage)
	}

	result := &ChargeResult{OrderID: parsed.OrderID, TransactionID: parsed.TransactionID}
	for _, a := range parsed.Actions {
		if a.Name == "generate-qr-code" {
			result.QRCodeURL = a.URL
		}
	}
	return result, nil
}

type StatusResult struct {
	TransactionStatus string
	FraudStatus       string
}

func (c *Client) CheckStatus(ctx context.Context, serverKey string, isProduction bool, orderID string) (*StatusResult, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base(isProduction)+"/v2/"+orderID+"/status", nil)
	if err != nil {
		return nil, err
	}
	req.SetBasicAuth(serverKey, "")
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("menghubungi midtrans: %w", err)
	}
	defer resp.Body.Close()

	var parsed struct {
		TransactionStatus string `json:"transaction_status"`
		FraudStatus       string `json:"fraud_status"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return nil, fmt.Errorf("membaca status midtrans: %w", err)
	}
	return &StatusResult{TransactionStatus: parsed.TransactionStatus, FraudStatus: parsed.FraudStatus}, nil
}

// VerifySignature mengecek tanda tangan notifikasi webhook Midtrans:
// SHA512(order_id + status_code + gross_amount + ServerKey).
func VerifySignature(orderID, statusCode, grossAmount, serverKey, signature string) bool {
	sum := sha512.Sum512([]byte(orderID + statusCode + grossAmount + serverKey))
	return hex.EncodeToString(sum[:]) == signature
}

func IsPaid(transactionStatus, fraudStatus string) bool {
	if transactionStatus == "settlement" {
		return true
	}
	return transactionStatus == "capture" && fraudStatus == "accept"
}

func IsFailed(transactionStatus string) bool {
	switch transactionStatus {
	case "expire", "cancel", "deny", "failure":
		return true
	}
	return false
}