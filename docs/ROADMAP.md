# Roadmap dan status

Perbarui file ini di setiap commit fase. Satu baris per fase.

## Selesai

| Fase | Isi |
|---|---|
| 0 sampai 6 | Fondasi (Go, PostgreSQL, migrasi), autentikasi, tenant dengan RLS, langganan dan tagihan, profil dan staf, antrian dasar (tiket offline, kapster), ulasan |
| 7 | Pemesanan online dan pembayaran DP (Midtrans dan manual) |
| 8 | Realtime SSE, estimasi menunggu, Web Push |
| 9 | Kuota yang kembali, job River (hangus, tagihan, pengingat) |
| 10 | Statistik tenant dan platform |
| 11a | Fondasi frontend, layar masuk, daftar, verifikasi email, lupa sandi, beranda; `GET /v1/me` |
| 11b | Halaman publik outlet (slug), Tiket saya, QRIS manual, estimasi untuk pelanggan |
| 11c-1 | `RecheckPayment` lewat jalur sistem, respons hanya status, Midtrans tiruan untuk tes |
| 11c-2 | Layar pelanggan: halaman outlet, pesan, bayar, tiket, penilaian |
| 11c-3 | Notifikasi push giliran di perangkat, service worker, manifest dan pemasangan PWA |
| 11d | Otorisasi owner/admin/kapster, penugasan outlet, DTO staf/antrian/kapster, kebijakan RLS pelanggan, dan matriks PASS/FAIL |

## Berikutnya (urutan wajib)

1. **12a** layar kapster (kontrak API dan pemantauan sesi/tiket sudah tersedia; aksi kapster dan uji browser masih perlu). **12b** layar admin (konfirmasi DP, tiket offline, buka/tutup sesi, kuota).
   **12c** layar owner (outlet, staf, harga DP, pembayaran, tautan dan QR outlet, langganan, statistik, ulasan).
   **12d** layar pemilik SaaS (tenant, MRR, ARR, churn).
2. **13** website profil (Astro), halaman syarat dan privasi, alur daftar owner sampai tiket pertama.
3. **14** pengerasan produksi: rate limit login dan pemesanan, header keamanan, backup database dengan uji
   restore, Sentry, `DEV_AUTO_VERIFY` mati, domain pengirim Resend terverifikasi.
4. **15** deploy: satu VPS, Docker, Caddy (HTTPS), CI sederhana, migrasi otomatis.
5. **16** uji coba dengan 1 sampai 2 barber sungguhan, perbaikan, lalu buka pendaftaran.

## Risiko dan utang yang diketahui

- Pembayaran Midtrans asli belum pernah selesai di sandbox (simulator membalas "Transaction is unsuccessful").
  Jalur diuji dengan Midtrans tiruan. Putuskan sebelum Fase 14: selesaikan lewat dukungan Midtrans, atau
  meluncur dulu hanya dengan QRIS manual.
- Resend belum punya domain terverifikasi: email ke selain pemilik akun gagal. Wajib sebelum deploy.
- Skrip verifikasi masih di `/tmp`. Pindahkan ke `scripts/verify/`.
- Dedupe pengingat perpanjangan belum terbukti oleh tes.
- Hub realtime di memori hanya benar untuk satu instance API.
- Belum ada tes unit Go. Aturan penting hanya dijaga skrip integrasi.

## Ide yang ditunda

- QRIS dinamis yang memuat nominal (mengurangi salah nominal pada mode manual). Menyentuh aturan QRIS.
