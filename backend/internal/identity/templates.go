package identity

import "fmt"

func verificationEmailHTML(verifyURL string) string {
	return fmt.Sprintf(`<div style="font-family:sans-serif;max-width:480px;margin:auto">
		<h2>Verifikasi email Anda</h2>
		<p>Terima kasih sudah mendaftar di Trimwait. Klik tombol di bawah untuk mengaktifkan akun Anda.</p>
		<p><a href="%s" style="background:#111827;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">Verifikasi Email</a></p>
		<p>Kalau tombol tidak berfungsi, salin tautan ini ke browser:<br>%s</p>
	</div>`, verifyURL, verifyURL)
}

func passwordResetEmailHTML(resetURL string) string {
	return fmt.Sprintf(`<div style="font-family:sans-serif;max-width:480px;margin:auto">
		<h2>Atur ulang password</h2>
		<p>Kami menerima permintaan atur ulang password akun Trimwait Anda. Tautan ini berlaku 1 jam.</p>
		<p><a href="%s" style="background:#111827;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">Atur Ulang Password</a></p>
		<p>Kalau Anda tidak meminta ini, abaikan email ini.</p>
	</div>`, resetURL)
}