package billing

import (
	"strings"
	"testing"
)

func TestPlatformQRISContentTypeUsesImageBytes(t *testing.T) {
	cases := []struct {
		name string
		data []byte
		want string
	}{
		{name: "png", data: []byte("\x89PNG\r\n\x1a\n"), want: "image/png"},
		{name: "jpeg", data: []byte{0xff, 0xd8, 0xff, 0xdb}, want: "image/jpeg"},
		{name: "webp", data: []byte("RIFF0000WEBPVP8 "), want: "image/webp"},
		{name: "teks ditolak", data: []byte("image/png"), want: ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := platformQRISContentType(tc.data); got != tc.want {
				t.Fatalf("platformQRISContentType() = %q, ingin %q", got, tc.want)
			}
		})
	}
}

func TestNormalizeTransferDetails(t *testing.T) {
	tests := []struct {
		name      string
		input     TransferDetails
		want      TransferDetails
		wantError string
	}{
		{name: "trim and accept bank", input: TransferDetails{RecipientName: "  PT Trimwait  ", BankName: " BCA ", BankAccount: " 123456 "}, want: TransferDetails{RecipientName: "PT Trimwait", BankName: "BCA", BankAccount: "123456"}},
		{name: "accept e-wallet only", input: TransferDetails{RecipientName: "Penerima", DanaNumber: "08123456789"}, want: TransferDetails{RecipientName: "Penerima", DanaNumber: "08123456789"}},
		{name: "empty clears all", input: TransferDetails{RecipientName: "Sisa nama"}, want: TransferDetails{}},
		{name: "bank fields paired", input: TransferDetails{RecipientName: "Penerima", BankName: "BCA"}, wantError: "rekening_tidak_lengkap"},
		{name: "recipient required", input: TransferDetails{GopayNumber: "08123456789"}, wantError: "nama_penerima_wajib"},
		{name: "length limited", input: TransferDetails{RecipientName: strings.Repeat("x", 101), DanaNumber: "08123456789"}, wantError: "data_transfer_tidak_valid"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, gotError := normalizeTransferDetails(test.input)
			if gotError != test.wantError {
				t.Fatalf("normalizeTransferDetails() error = %q, ingin %q", gotError, test.wantError)
			}
			if got != test.want {
				t.Fatalf("normalizeTransferDetails() = %#v, ingin %#v", got, test.want)
			}
		})
	}
}
