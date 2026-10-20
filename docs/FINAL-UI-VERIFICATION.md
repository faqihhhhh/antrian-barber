# Laporan verifikasi akhir UI fase 1–11

Tanggal verifikasi: 20 Oktober 2026. Verifikasi browser dijalankan dengan API tiruan lokal. Hasil mentah seluruh skrip ada di [`scripts/verify/out/final.json`](../scripts/verify/out/final.json), dan inventaris rinci font/kontras ada di [`scripts/verify/out/baseline.json`](../scripts/verify/out/baseline.json).

## Hasil otomatis

Semua 17 berkas `scripts/verify/*.mjs` selesai dengan status **PASS**, termasuk pemeriksaan aksesibilitas, admin, booking, konten, identitas, tanggal invalid, login, navigasi, responsif, kapster, tiket, unit format, inventaris, serta perekaman before/after. `inventory.mjs` mencatat **0** teks di bawah 12px dan **0** teks berkontras di bawah 4,5:1 pada setiap halaman dan viewport yang diinventarisasi. Axe tidak menemukan pelanggaran berdampak serius/kritis pada halaman yang diperiksa; fokus keyboard pada `/masuk` berupa outline solid 2px.

| Perintah | Hasil |
|---|---|
| `cd website && npm run build` | PASS — Astro membangun 3 halaman statis |
| `cd frontend && npm run build` | PASS — TypeScript dan Vite selesai |
| `cd frontend && npm run lint` | PASS — oxlint tanpa temuan |
| Backend | Tidak dijalankan — fase ini tidak mengubah backend |

## Perbandingan screenshot

Semua pasangan standar memakai viewport 390×844 dan 1440×900. Before tersimpan di `frontend/ui-review/before/`; after di `frontend/ui-review/after/` dengan awalan `final-`. Gambar after tambahan untuk status spesifik tiket, kapster, dan navigasi ada di direktori yang sama. Pasangan standar dipakai untuk menilai halaman dan layout; screenshot status khusus hanya menguji status yang disebut.

| Halaman | Ukuran | Before → after | Perubahan yang terlihat | Status |
|---|---|---|---|---|
| Website utama | 390, 1440 | `before-website-home-*` → `final-website-home-*` | Identitas monokrom dan logo glyph, teks lebih terbaca, tiga langkah pemesanan, bukti/harga dan demo; hero mobile mengikuti tinggi konten | PASS |
| Syarat | 390, 1440 | `before-website-syarat-*` → `final-website-syarat-*` | Logo, favicon/metadata dan warna halaman selaras identitas aplikasi | PASS |
| Privasi | 390, 1440 | `before-website-privasi-*` → `final-website-privasi-*` | Logo, favicon/metadata dan warna halaman selaras identitas aplikasi | PASS |
| Masuk mitra/pelanggan | 390, 1440 | `before-app-masuk-*` → `final-app-masuk-*` | Toggle pilihan ruang dihapus; deskripsi menjelaskan pengguna mitra; mode pelanggan tetap memakai rute khusus | PASS |
| Outlet pelanggan | 390, 1440 | `before-app-outlet-contoh-barber-*` → `final-app-outlet-contoh-barber-*` | Form responsif dua kolom di desktop; pilihan tanggal invalid disembunyikan; nama tersimpan saat login | PASS |
| Tiket pelanggan | 390, 1440 | `before-app-tiket-waiting-*` → `final-app-tiket-waiting-*` | Ringkasan posisi mendahului notifikasi; langkah aktif memakai teks yang jelas. Status waiting/called/completed juga punya screenshot 390px | PASS |
| Kapster | 390, 1440 | `before-app-kapster-*` → `final-app-kapster-*` | Nama pelanggan menjadi fokus utama; indikator koneksi konsisten; teks polling dihilangkan | PASS |
| Admin | 390, 1440 | `before-app-admin-kelola-*` → `final-app-admin-kelola-*` | Konfirmasi DP naik ke 600px pertama; buka sesi aktif tertutup dalam disclosure yang dapat diakses keyboard | PASS |
| Navigasi ruang admin/kapster/pelanggan | 390 | `before-app-*` → `final-app-*` per skenario | Satu bar navigasi bawah; pemilih workspace tersedia untuk banyak workspace | PASS |
| Navigasi ruang owner | 390 | Before owner tidak tersedia → `nav-owner-390.png` | After dan uji interaksi terlihat; tidak ada gambar awal owner yang bisa dibandingkan | Belum diverifikasi secara visual |

Screenshot uji tambahan ada di `frontend/ui-review/after/`: `login-mitra-*`, `login-pelanggan-*`, `booking-outlet-*`, `admin-*`, `kapster-busy-390.png`, `kapster-idle-390.png`, `ticket-waiting-390.png`, `ticket-called-390.png`, `ticket-completed-390.png`, serta `nav-*-390.png`.

## Belum diverifikasi

- Belum diverifikasi dengan backend dan database asli pada fase ini. Pemeriksaan alur browser menggunakan respons API tiruan; data tenant, pembayaran, izin, dan transaksi produksi tidak disentuh.
- Belum diverifikasi pembayaran QRIS/Midtrans langsung, push notification pada perangkat nyata, atau penerimaan notifikasi saat aplikasi ditutup.
- Screenshot membuktikan tampilan pada viewport dan fixture yang tercantum, bukan seluruh ukuran layar, browser, isi data, atau seluruh kombinasi status produksi.
- Perbandingan visual khusus navigasi ruang owner belum bisa dilakukan karena tidak ada screenshot before owner; uji navigasi setelah perubahan tetap lulus.
- Build website menghasilkan situs statis lokal. Domain publik, metadata `og:url`, pengiriman email, dan konfigurasi deploy tidak diuji dari jaringan publik.
- Riwayat Git berisi commit fitur sebelum perubahan UI ini, tetapi perubahan UI fase 1–11 yang sedang ada di worktree belum terbagi menjadi satu commit per fase. Membuat commit per fase terpisah tidak dapat dibuktikan aman dari snapshot worktree gabungan; perubahan tidak saya commit satu per satu secara spekulatif.

## Checklist pemilik

Checklist browser langkah demi langkah untuk akun dan backend lokal tersedia di [`docs/CHECKLIST-UI.md`](CHECKLIST-UI.md). Jalankan alur backend asli sesuai data uji pada `docs/TESTING.md` sebelum rilis.
