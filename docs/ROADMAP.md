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
| 12a | Layar kapster: pantau sesi/tiket dan aksi siap, mulai, lewati, selesai; sudah diperiksa pemilik di browser |
| 12b-1 | Endpoint daftar DP manual tertunda untuk admin, DTO aman, serta kontrak OpenAPI |
| 12b-2 | Layar admin untuk memilih outlet/sesi, melihat DP manual, dan mengonfirmasikannya |
| 12b-3 | Form tiket pelanggan datang langsung, daftar tiket sesi, dan batas kuota pada layar admin |
| 12b-4 | Kontrol penambahan kuota dari layar admin |
| 12b-5 | Form pembukaan sesi antrian baru dari layar admin |
| 12b-6 | Endpoint tutup sesi yang menolak jika masih ada DP atau tiket aktif, plus kontrol admin |
| 12b-7 | Tutup otomatis sesi lewat tanggal lokal; hentikan pesanan baru, tetapi izinkan antrean tersisa diselesaikan |
| 12c-1 | Layar owner untuk melihat outlet, mengubah harga DP dan durasi bawaan, serta membuka tautan outlet |
| 12c-2 | Layar owner untuk melihat staf dan mengundang admin/kapster dengan penugasan outlet |
| 12c-3 | Layar owner untuk memasang, mengganti, atau menghapus QRIS manual dan melihat status Midtrans |
| 12c-4 | Aksi salin tautan outlet publik dan buka halaman outlet dari layar owner |
| 12c-5 | Layar owner untuk ringkasan statistik tenant 30 hari terakhir |
| 12c-6 | Layar owner untuk ringkasan rating kapster dan daftar ulasan terbaru |
| 12c-7 | Layar owner untuk status langganan dan riwayat tagihan dengan DTO aman |
| 12c-8 | Hitung periode langganan dari waktu database dan catat rentang periode pada invoice |
| 12c-9 | Batasi tagihan pending satu per bisnis dan buka perpanjangan dalam jendela 7 hari |
| 12c-10 | Navigasi layar pengaturan owner dirapikan untuk ponsel; tautan pengaturan dapat digeser mendatar dan sudah diperiksa manual |
| 12d-1 | Layar pemilik SaaS: ringkasan tenant, MRR/ARR, churn, tagihan, aktivitas, dan tren 12 bulan |
| 13-1 | Website profil statis Astro dengan landing page responsif dan CTA menuju aplikasi |
| 13-2 | Draf halaman syarat penggunaan dan kebijakan privasi berdasarkan alur data aplikasi; detail operator dan retensi ditandai untuk dilengkapi sebelum publikasi |
| 13-3-1 | Onboarding owner membuat bisnis pertama dengan respons API DTO aman dan validasi nama |
| 13-3-2 | Pemilik dapat memilih paket dan membuat tagihan langganan dari layar Langganan |
| 13-3-3 | Pemilik membuat outlet pertama setelah langganan aktif; endpoint outlet memakai DTO aman dan kontrak OpenAPI |
| 13-3-4 | Onboarding owner mengarahkan tenant tanpa langganan ke tagihan dan menghubungkan outlet ke pembayaran DP serta meja admin |
| 13-3-5 | Skrip verifikasi API nyata membuka sesi, membuat booking pelanggan, mensimulasikan konfirmasi DP, memastikan tiket masuk antrean, lalu membersihkan data uji |
| 13-3-6 | Pemilik memeriksa alur onboarding dan booking di browser: pengaturan outlet, pembayaran/admin, buka sesi, booking pelanggan, dan konfirmasi tiket uji (semua PASS) |
| 14-1 | API menambahkan header keamanan `nosniff`, anti-frame, kebijakan referrer, dan pembatasan fitur browser; dilindungi tes unit |
| 14-2a | Login dibatasi 10 percobaan per alamat IP per menit; pelanggaran membalas 429 dan `Retry-After`, penghitung dibatasi di memori |
| 14-2b | Booking online dibatasi 5 permintaan per alamat IP per menit; permintaan berlebih membalas 429 dan `Retry-After` |
| 14-3 | Backup database format custom dan uji pemulihan ke database sementara; tabel publik sumber dan hasil restore sama-sama 27 |
| 14-4 | SDK Sentry opsional mengirim panic dan error HTTP 5xx dengan tag path dan method; aktif jika `SENTRY_DSN` diisi |
| 14-5a | Konfigurasi menolak startup pada `APP_ENV=production` jika `DEV_AUTO_VERIFY=true`; hanya menerima environment development/test/production |

## Berikutnya (urutan wajib)

1. **12b** layar admin (konfirmasi DP, tiket offline, buka/tutup sesi, kuota).
   **12c** layar owner (outlet, staf, harga DP, pembayaran, tautan dan QR outlet, langganan, statistik, ulasan).
   ~~**12d** layar pemilik SaaS (tenant, MRR, ARR, churn).~~ Selesai pada 12d-1.
2. **13** website profil (Astro), halaman syarat dan privasi, alur daftar owner sampai tiket pertama. Langkah 13-1 sampai 13-3-6 selesai.
3. **14** pengerasan produksi: rate limit login dan pemesanan, header keamanan, dan backup dengan uji
   restore, integrasi Sentry, dan guard `DEV_AUTO_VERIFY` selesai; berikutnya verifikasi domain pengirim Resend.
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
- Cakupan tes unit Go masih terbatas. Sebagian besar aturan penting hanya dijaga skrip integrasi.

## Ide yang ditunda

- QRIS dinamis yang memuat nominal (mengurangi salah nominal pada mode manual). Menyentuh aturan QRIS.
