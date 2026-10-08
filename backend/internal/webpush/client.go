package webpush

import (
	"encoding/json"
	"fmt"

	wp "github.com/SherClockHolmes/webpush-go"
)

type Client struct {
	publicKey  string
	privateKey string
	subject    string
}

func NewClient(publicKey, privateKey, subject string) *Client {
	return &Client{publicKey: publicKey, privateKey: privateKey, subject: subject}
}

func (c *Client) PublicKey() string { return c.publicKey }

type Subscription struct {
	Endpoint string
	P256dh   string
	Auth     string
}

type Payload struct {
	Title string `json:"title"`
	Body  string `json:"body"`
}

// Send mengirim satu notifikasi. Kalau browser/OS pelanggan sudah mencabut
// izin (umum terjadi — pengguna bisa matikan notifikasi kapan saja dari
// luar aplikasi kita), Midtrans eh maksudnya webpush akan membalas 404/410 —
// itu sinyal supaya subscription itu dihapus dari database kita, bukan
// dianggap error fatal.
func (c *Client) Send(sub Subscription, payload Payload) (gone bool, err error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return false, err
	}

	resp, err := wp.SendNotification(body, &wp.Subscription{
		Endpoint: sub.Endpoint,
		Keys:     wp.Keys{P256dh: sub.P256dh, Auth: sub.Auth},
	}, &wp.Options{
		Subscriber:      c.subject,
		VAPIDPublicKey:  c.publicKey,
		VAPIDPrivateKey: c.privateKey,
		TTL:             60,
	})
	if err != nil {
		return false, fmt.Errorf("mengirim web push: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == 404 || resp.StatusCode == 410 {
		return true, nil
	}
	if resp.StatusCode >= 300 {
		return false, fmt.Errorf("web push gagal, status %d", resp.StatusCode)
	}
	return false, nil
}