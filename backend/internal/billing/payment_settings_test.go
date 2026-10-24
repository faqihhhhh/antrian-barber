package billing

import "testing"

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
