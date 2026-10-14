# Backend (Go)

Modular monolith: satu binary (`cmd/api`), satu PostgreSQL. Go modul bernama `kapsflow`.

## Pustaka utama

chi (router), pgx/pgxpool, sqlc (kode dari SQL), goose (migrasi), River (job terjadwal),
slog (log JSON), webpush-go (Web Push). Hasil sqlc ada di `internal/db` (diimpor sebagai
`db "kapsflow/internal/db"`). `internal/dbx` berisi konversi kecil untuk tipe pgtype/uuid.

## Pola satu modul

Setiap modul di `internal/<nama>/` punya tiga file:

- `service.go`: aturan bisnis dan pemeriksaan peran. Satu-satunya tempat yang memanggil query.
- `handlers.go`: baca request, panggil service, tulis respons. Tanpa aturan bisnis.
- `routes.go`: `RegisterRoutes(r chi.Router, svc, log, ...)`.

Service memakai pola ini untuk mengakses database:

```go
func (s *Service) queries(ctx context.Context) *db.Queries {
	if tx, ok := rls.TxFromContext(ctx); ok {
		return db.New(tx) // di dalam request: memakai transaksi RLS milik request
	}
	return s.fallback // di luar request (job, tes)
}
```

## Error API

Pakai `internal/httpx`: `httpx.BadRequest(code, pesan, err)`, `NotFound`, `Unauthorized`, `Conflict`,
`Internal(err)`. Handler menulis lewat `httpx.Error(w, r, log, err)`. Bentuk respons error selalu
`{"error":{"code":"...","message":"..."}}`. Kode error memakai snake_case bahasa Indonesia
(`bukan_owner`, `tanggal_sudah_lewat`), pesan ditujukan ke pengguna akhir. `Internal` menyimpan
penyebab di log dan tidak membocorkannya ke klien. Slice kosong harus tampil `[]`, bukan `null`:
bungkus dengan `httpx.NonNil`.

## Database dan RLS

Dua role: `kapsflow` (superuser, hanya migrasi dan `psql` admin) dan `kapsflow_app`
(dipakai aplikasi lewat `APP_DATABASE_URL`).

Setiap request terautentikasi dibungkus `rls.Middleware`: satu transaksi per request, `app.user_id`
dipasang lewat `set_config('app.user_id', <uuid>, true)`, dan transaksi di-**commit hanya jika status
< 400** (error otomatis rollback). Fungsi bantu di SQL: `app_current_user_id()`,
`app_has_tenant_access(tenant_id)`, `app_is_tenant_owner(tenant_id)`, `app_is_system_user()`.

`rls.RunAsSystem(ctx, pool, func(c context.Context) error {...})` membuka transaksi terpisah sebagai
akun sistem `00000000-0000-0000-0000-000000000001` (ditandai platform admin). Pakai hanya di dalam
fungsi service, dan **setelah** pemanggil terbukti berhak. Kebutuhan umum: pelanggan (bukan anggota
tenant) perlu membaca atau mengubah data tenant (status langganan, kunci Midtrans, antrian orang
lain, siaran realtime). Pola ini sudah dipakai di `GetStatusAsSystem`, `GetDecryptedMidtransKeys`,
`PaymentMode`, `estimateAhead`, `GetOutletPage`, notifikasi push, dan penyelesaian pembayaran.

Fungsi `SECURITY DEFINER` untuk operasi yang harus atomik lintas hak: `claim_ticket_number_for_booking`
(ambil nomor tiket dan naikkan `used_quota`) dan `cancel_pending_ticket` (batalkan dan kembalikan kuota).

### Jebakan RLS yang sudah pernah terjadi

- `INSERT ... RETURNING` ikut kebijakan SELECT. Kalau pelaku tidak boleh membaca baris itu, error.
  Solusi: buat ID di Go, `INSERT` dengan `:exec`, lalu baca lewat jalur yang berhak.
- `SELECT ... FOR UPDATE` butuh kebijakan UPDATE (atau ALL) pada baris itu.
- `UPDATE` yang tidak mengenai baris karena RLS tidak error. Hasilnya 0 baris dan mudah terlewat.
  Periksa jumlah baris yang berubah.
- Satu statement error membatalkan seluruh transaksi (`25P02`). Untuk retry karena konflik unik
  pakai `INSERT ... ON CONFLICT DO NOTHING` dan cek `pgx.ErrNoRows`, bukan menangkap error unik.
- Siaran realtime dan notifikasi harus dibangun dengan hak sistem, kalau tidak hanya terlihat
  data milik pemicunya.
- Kebijakan pelanggan di `tickets` dan `ticket_payments` saat ini `FOR ALL` (pelanggan bisa
  mengubah barisnya sendiri di level SQL). Jangan bergantung pada itu. Rencananya dipangkas di Fase 11d.

## Migrasi

`backend/db/migrations/` (goose). Fungsi PL/pgSQL dibungkus `-- +goose StatementBegin/End`.
Migrasi `Down` wajib ada dan benar. Tabel baru: `ENABLE` dan `FORCE ROW LEVEL SECURITY`, kebijakan,
indeks untuk kolom yang dipakai `WHERE`. Constraint dan indeks unik parsial dipakai untuk
menjaga aturan bisnis di level data, mis. `idx_tickets_one_pending_per_customer`,
`idx_invoices_unique_pending_amount`, `idx_ticket_payments_unique_pending_amount`.

## sqlc

Query di `backend/db/queries/*.sql`, konfigurasi `backend/sqlc.yaml`. Setelah mengubah query atau
skema jalankan `make sqlc-generate`. Jangan mengedit file hasil generate.

## Autentikasi

Sesi memakai cookie httpOnly `kapsflow_session`, token disimpan sebagai hash SHA-256. Kata sandi
argon2id. Email lewat Resend, atau `consoleMailer` (mencetak ke log) kalau `RESEND_API_KEY` kosong.
`DEV_AUTO_VERIFY=true` melewati verifikasi email untuk pengembangan. `POST /register` selalu 202
dengan pesan yang sama supaya tidak membocorkan email yang sudah terdaftar. Token verifikasi staf
berlaku 7 hari.

## Pembayaran

- **Midtrans** (Core API, QRIS): kunci tenant dienkripsi AES-256-GCM (`ENCRYPTION_KEY`).
  Lingkungan sandbox atau produksi disimpan eksplisit di `midtrans_is_production`, jangan menebak
  dari awalan kunci. Webhook `POST /v1/webhooks/midtrans` tanpa login, dijaga tanda tangan
  SHA512(order_id + status_code + gross_amount + server_key). `RecheckPayment` menanyakan status
  langsung ke Midtrans. Penyelesaian pembayaran selalu lewat `rls.RunAsSystem`.
- **Manual**: QRIS statis milik owner (gambar maksimal 512 KB, jenis file dicek dari isinya),
  nominal unik per pesanan supaya admin bisa mencocokkan, dan admin menekan konfirmasi.
- `settlePaymentPaid` dan `settlePaymentFailed` idempoten: hasil 0 baris berarti sudah diproses.

## Realtime dan job

`internal/realtime.Hub` adalah pub/sub di memori untuk SSE
(`GET /v1/public/queue-sessions/{id}/stream`). **Batas yang diketahui:** hanya benar untuk satu
instance API. Kalau suatu hari butuh lebih dari satu instance, ganti ke PostgreSQL LISTEN/NOTIFY.
Job periodik (River): `ExpirePayments` tiap 1 menit, `ExpireInvoices` 10 menit, `RenewalReminders`
1 jam. Pool pgx `MaxConns = 20`. `ReindexerSchedule` dimatikan (`river.NeverSchedule()`).

## Konvensi

- Konteks: semua fungsi service menerima `ctx` sebagai argumen pertama.
- Log: `slog` dengan field terstruktur. Jangan log kata sandi, token, kunci, atau isi QRIS.
- Zona waktu: tanggal sesi antrian adalah tanggal lokal outlet (`outlets.timezone`), bukan tanggal server.
- Jangan menambah kolom tanpa memikirkan RLS dan indeksnya.
- Setelah mengubah service: `go build -C backend ./...` dan jalankan skrip verifikasi yang relevan.
