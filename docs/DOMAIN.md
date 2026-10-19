# Aturan bisnis dan model data

Sumber kebenaran perilaku produk. Kalau kode dan dokumen ini berbeda, selidiki dulu mana yang benar,
lalu perbaiki yang salah. Jangan diam-diam mengubah salah satunya.

## Peran dan hak

| Peran | Kunci | Boleh |
|---|---|---|
| Pemilik SaaS | `users.is_platform_admin` | Semua tenant, tagihan langganan, statistik platform (MRR, ARR, ARPA, churn) |
| Owner | `memberships.roles` memuat `owner` | Mengatur bisnis, outlet, staf, harga DP, pembayaran, langganan, statistik, ulasan |
| Admin | `admin` | Konfirmasi DP manual, tambah tiket offline, kelola sesi antrian di outlet penugasannya |
| Kapster | `kapster` | Menekan siap, memanggil, memulai, menyelesaikan, melewati tiket di outlet penugasannya |
| Pembeli | pengguna biasa tanpa keanggotaan | Memesan, membayar DP, melihat tiket sendiri, memberi ulasan |

Satu pengguna bisa punya beberapa keanggotaan dan satu keanggotaan bisa punya beberapa peran.
Hak per peran **harus diperiksa di service**, RLS hanya memastikan keanggotaan tenant.

## Entitas utama

- `users` menyimpan email, password, dan `username` unik untuk sapaan profil. Username 3–24
  karakter, diawali huruf, hanya memakai huruf, angka, dan garis bawah. Akun lama boleh belum
  memiliki username dan dapat mengaturnya dari Beranda.
- `tenants` (bisnis), `outlets` (cabang: `slug` unik, `timezone`, `address`, `dp_price_rupiah`,
  `default_duration_minutes`), `memberships` (pengguna di tenant, `roles[]`, penugasan outlet).
- `tenant_profiles`: kunci Midtrans terenkripsi, `midtrans_is_production`, gambar QRIS manual
  (`manual_qris_image`, `_content_type`, `_updated_at`), status onboarding.
- `plans`, `subscriptions`, `invoices`, `subscription_reminders`: langganan tenant ke platform.
- `queue_sessions`: satu per outlet per tanggal lokal. `max_quota`, `used_quota`, `next_ticket_number`,
  status `open` atau `closed`.
- `tickets`: `ticket_number`, `queue_position`, `status`, `match_code`, `customer_name` (maks 60),
  `customer_user_id` (kosong untuk tiket offline), `turn_notified_at`.
- `ticket_payments`: `method` (`midtrans` atau `manual`), `status` (`pending`, `paid`, `failed`),
  `amount_rupiah`, `unique_code`, `midtrans_order_id`, `qr_code_url`, `expires_at`, `confirmed_by`.
- `ticket_events` (jejak kejadian tiket), kapster state (siap atau sibuk), `reviews`,
  `push_subscriptions`, `sessions` (sesi login), `tokens` (verifikasi email, reset sandi).

## Langganan tenant

Status: `belum_berlangganan`, `aktif`, `masa_tenggang`, `baca_saja`. Endpoint menulis milik tenant
dijaga middleware `requireActive`. Pelanggan tidak dihukum oleh status langganan owner, kecuali
pemesanan online baru ditutup (`accepting_bookings=false`, alasan `langganan_tidak_aktif`).
Tagihan langganan dibayar manual ke platform dan dikonfirmasi pemilik SaaS
(`POST /invoices/{invoiceID}/confirm`). Nominal tagihan unik supaya bisa dicocokkan.
Owner hanya bisa membuat satu tagihan pending per bisnis. Tagihan perpanjangan baru boleh dibuat
dalam 7 hari sebelum akhir periode aktif. Tagihan berlaku 24 jam, dihitung memakai waktu database.
Tagihan yang sudah dikonfirmasi menyimpan rentang periode yang ditambahkan untuk audit.
Saat konfirmasi, periode mulai dari waktu pembayaran database atau akhir periode aktif (mana yang
lebih akhir), lalu ditambah satu bulan atau satu tahun. Rentang yang diberikan dicatat di invoice
agar riwayat perpanjangan bisa diaudit.
Pengingat perpanjangan dikirim sekali per periode (`subscription_reminders`).

## Pemesanan online (`BookOnline`)

Urutan pemeriksaan dan kode errornya:

1. Langganan owner tidak aktif: 402 `berlangganan_diperlukan`.
2. Tanggal lewat menurut zona waktu outlet: `tanggal_sudah_lewat`.
3. Harga DP outlet belum diatur: `harga_dp_belum_diatur`. Belum ada metode bayar: `pembayaran_belum_diatur`.
4. Sesi tanggal itu tidak ada: `sesi_tidak_ditemukan`. Kuota penuh atau sesi tutup: `tidak_bisa_memesan`.
5. Pelanggan sudah punya pesanan belum dibayar di sesi itu: `masih_ada_pesanan_belum_dibayar`.
6. Nama lebih dari 60 karakter: `nama_terlalu_panjang`. Nama dirapikan (spasi di tepi dibuang).

Hasilnya tiket `pending_payment`, kode pencocokan 6 karakter (alfabet tanpa `0 O 1 I`), dan pembayaran
`pending` berlaku 30 menit. Nomor tiket diambil lewat `claim_ticket_number_for_booking`. Nomor tidak
pernah dipakai ulang (`next_ticket_number` hanya naik), sedangkan `used_quota` naik saat pesan dan turun
saat tiket `pending_payment` dibatalkan.

Mode pembayaran outlet (`profile.PaymentMode`): `midtrans` kalau kunci Midtrans terisi (didahulukan),
`manual` kalau hanya QRIS statis terisi, selain itu `none`.

- Midtrans: nominal = harga DP, QR dibuat Midtrans (`qr_code_url`), tiket aktif otomatis lewat
  webhook atau cek ulang.
- Manual: nominal = harga DP + kode unik 1..999, admin mencocokkan nominal lalu mengonfirmasi.
  Gambar QRIS hanya bisa diambil pemilik tiket selama pembayaran masih `pending`.

Pembayaran `pending` yang lewat `expires_at` dibatalkan job `ExpirePayments`: pembayaran `failed`,
tiket `canceled`, kuota kembali. Untuk Midtrans, job mengecek status dulu (bisa jadi sudah dibayar).

## Status tiket

`pending_payment` -> `waiting` (setelah DP lunas) -> `called` (kapster menekan siap) -> `in_progress`
-> `completed`. `canceled` bisa dari `pending_payment`. Tiket offline (tambah oleh admin) langsung `waiting`.
Antrian diurutkan `queue_position`. Kapster yang menekan "siap" saat masih sibuk tidak boleh
menghasilkan tiket yatim (ada guard `busy`).

Jika pelanggan belum hadir saat dipanggil, kapster dapat memilih "Ganti pelanggan". Tiket itu tetap
menunggu tetapi dipindah ke belakang seluruh antrean, lalu tiket menunggu terdepan berikutnya langsung
dipanggil. Posisi antrean baru selalu dialokasikan setelah posisi tertinggi yang sudah dipakai, agar
pemesanan baru tidak menyelip di depan pelanggan yang sudah dilewati. Dengan begitu beberapa pelanggan
yang tidak hadir tidak membuat antrean berputar di antara tiket yang sama.

Admin hanya dapat menutup sesi manual jika tidak ada tiket `pending_payment`, `waiting`, `called`, atau
`in_progress`. Job otomatis menutup sesi setelah tanggal lokal outlet lewat, agar pemesanan baru berhenti.
Tiket yang tersisa tetap dapat diselesaikan kapster pada sesi tertutup; admin tetap dapat mengonfirmasi
DP manual yang masih berlaku. Sesi baru tidak boleh dibuat untuk tanggal yang sudah lewat.

## Estimasi menunggu

Rata-rata jeda antar panggilan nyata kalau datanya ada, jika belum ada memakai
`default_duration_minutes`. Dibagi jumlah kapster aktif. Kalau tidak ada kapster aktif, tampilkan
"belum bisa dihitung", jangan mengarang angka. Layar pelanggan membulatkan ke atas per 5 menit.

## Penilaian

Hanya pemilik tiket, hanya tiket `completed`, satu kali per tiket, rating 1..5, komentar maksimal
1000 karakter. Kode error: `rating_tidak_valid`, `komentar_terlalu_panjang`, `tiket_belum_selesai`,
`sudah_memberi_ulasan`, `bukan_pemilik_tiket`.

## Notifikasi

Web Push (VAPID). Pelanggan diberi tahu **sekali per tiket** saat gilirannya hampir tiba
(`turn_notified_at` diklaim atomik lewat `ClaimTurnNotification`). Subscription yang dibalas 404 atau 410
oleh layanan push dihapus.

## Statistik

Dihitung langsung dari data transaksi, tidak ada tabel agregat. Hari = `session_date`. Jam sibuk memakai
`AT TIME ZONE outlets.timezone`.
