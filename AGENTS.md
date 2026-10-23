# Trimwait: panduan untuk agen coding

Baca file ini sebelum mengubah apa pun. Aturan yang hanya berlaku di satu bagian kode ada di
`backend/AGENTS.md` dan `frontend/AGENTS.md`. Aturan bisnis ada di `docs/DOMAIN.md`, cara menguji
di `docs/TESTING.md`, status pekerjaan di `docs/ROADMAP.md`. Buka file itu saat tugasnya menyentuh bidangnya.

## Produk

Trimwait adalah SaaS antrian untuk barbershop dan salon, dijual ke pemilik usaha (tenant).

- Pemilik SaaS (platform admin): mengelola tenant, langganan, dan melihat MRR/ARR.
- Owner: pemilik barbershop. Mengatur outlet, staf, harga DP, pembayaran, dan melihat statistik.
- Staf: `admin` (konfirmasi DP, kelola antrian) dan `kapster` (memanggil dan melayani).
- Pembeli (pelanggan): memesan antrian online lewat tautan atau QR outlet, membayar DP lewat QRIS,
  memantau giliran, lalu memberi penilaian.

Prioritas: keuntungan dan kepuasan pelanggan. Kode dan database harus mudah diubah, karena produk
ini akan dijual. Pengembangnya satu orang dengan modal terbatas, jadi pilih solusi sederhana yang
murah dijalankan (satu VPS, satu database) dan hindari infrastruktur yang belum dibutuhkan.

## Cara bekerja dengan pemilik proyek

Pemilik memakai pola "semi vibe coding": agen menulis kode, tetapi pemilik harus tetap paham
aplikasinya. Karena itu:

1. Kerjakan satu langkah kecil per giliran. Jangan menumpuk satu fase penuh dalam satu jawaban.
2. Setiap perubahan datang dengan: perintah terminal, path file lengkap, kode utuh yang siap
   disalin (bukan potongan "dst"), dan tes yang membuktikannya (`curl`, skrip PASS/FAIL, atau
   checklist browser).
3. Jangan bertanya kalau ada pilihan bawaan yang masuk akal. Pilih, sebutkan pilihannya, lanjut.
   Pemilik meminta fokus ke pengujian, bukan ke tanya jawab.
4. Jangan menyatakan sesuatu lulus tanpa bukti. Tes harus bisa **gagal** pada kode yang salah:
   periksa apakah datanya benar-benar membedakan kode lama dari kode baru (contoh: tes siaran
   realtime baru bermakna setelah ada tiket milik orang lain di sesi yang sama).
5. Kalau sebuah penjelasan ternyata salah, katakan terang-terangan dan koreksi. Jangan diam-diam
   mengganti jawaban.
6. Bahasa: Indonesia sederhana untuk penjelasan, pesan error, dan teks antarmuka. Nama kode
   (fungsi, variabel, tabel, kolom) memakai bahasa Inggris kecuali yang sudah memakai Indonesia
   (kode error API, mis. `bukan_owner`).
7. Pemilik memakai Windows dengan WSL2 (Ubuntu). Semua perintah ditulis untuk bash di WSL,
   dari direktori `~/kapsflow`.
8. Sebelum menulis kode terhadap pustaka pihak ketiga, cek versi dan dokumentasi terbarunya.
   Jangan mengandalkan ingatan untuk API yang sering berubah.

## Struktur repo

```
kapsflow/
├── AGENTS.md  CLAUDE.md        panduan agen (CLAUDE.md hanya mengimpor AGENTS.md)
├── Makefile                    perintah harian
├── docker-compose.yml          PostgreSQL 17 (service: db)
├── .env                        rahasia lokal, TIDAK di-commit
├── api/openapi.yaml            kontrak API, ditulis bertahap per layar
├── backend/                    Go (lihat backend/AGENTS.md)
│   ├── cmd/api/main.go         titik masuk, merakit semua modul
│   ├── internal/<modul>/       satu modul per area bisnis
│   └── db/{migrations,queries} goose dan sqlc
├── frontend/                   React + TypeScript (lihat frontend/AGENTS.md)
└── docs/                       DOMAIN.md, TESTING.md, ROADMAP.md
```

## Perintah harian

Dari `~/kapsflow`:

| Perintah | Fungsi |
|---|---|
| `make db-up` / `make db-down` | Menyalakan / mematikan PostgreSQL |
| `make migrate-up` / `migrate-down` / `migrate-status` | Migrasi goose |
| `make migrate-new name=nama_migrasi` | Membuat file migrasi baru |
| `make sqlc-generate` | Membuat ulang kode Go dari `backend/db/queries/*.sql` |
| `make river-migrate` | Migrasi tabel antrian job River |
| `make dev` | Menjalankan API di `:8080` |
| `go build -C backend ./...` | Memeriksa backend dapat dikompilasi |
| `cd frontend && npm run dev` | Frontend di `:5173` (proxy `/v1` ke `:8080`) |
| `cd frontend && npm run gen:api` | Membuat `src/api/schema.d.ts` dari `api/openapi.yaml` |
| `cd frontend && npm run build` | Type-check + build produksi |
| `cd frontend && npm run lint` | oxlint |

## Konfigurasi (.env)

Hanya nama variabel. Jangan pernah menulis nilai rahasia ke repo, log, atau jawaban.

`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `DATABASE_URL` (role `kapsflow`, superuser, khusus migrasi),
`APP_DATABASE_URL` (role `kapsflow_app`, dipakai aplikasi), `PORT`, `APP_BASE_URL` (dasar tautan email,
bawaan `http://localhost:5173`), `ENCRYPTION_KEY` (AES-256-GCM untuk kunci Midtrans), `RESEND_API_KEY`,
`EMAIL_FROM`, `APP_ENV` (`development`, `test`, atau `production`), `DEV_AUTO_VERIFY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
Khusus tes: `MIDTRANS_BASE_URL_OVERRIDE` (mengarahkan klien Midtrans ke server tiruan; jangan diisi di produksi).

## Aturan yang tidak boleh dilanggar

1. **Aplikasi tidak boleh terhubung sebagai superuser.** Runtime memakai `APP_DATABASE_URL`
   (`kapsflow_app`, NOSUPERUSER NOBYPASSRLS). RLS tidak berlaku bagi superuser.
2. **Isolasi tenant dijaga RLS di database**, bukan hanya `WHERE tenant_id` di kode. Tabel baru
   wajib `ENABLE` dan `FORCE ROW LEVEL SECURITY` beserta kebijakannya. Detail dan jebakannya di
   `backend/AGENTS.md`.
3. **Setiap endpoint menulis memeriksa peran**, tidak cukup "anggota tenant ini". RLS hanya
   menjamin keanggotaan, bukan peran. Daftar celah yang belum ditutup ada di `docs/ROADMAP.md`
   (Fase 11d). Jangan membuat layar staf sebelum celah itu tertutup.
4. **Jangan kirim baris database mentah ke klien.** Buat struct respons sendiri. Contoh terlarang:
   `customer_user_id`, kolom terenkripsi, hash token.
5. **Rahasia**: kunci Midtrans disimpan terenkripsi dan tidak pernah dikembalikan lewat API atau
   ditulis ke log. Token sesi dan token verifikasi disimpan sebagai hash SHA-256.
6. **Uang memakai bilangan bulat rupiah** (`int64`), tidak pernah float.
7. **`DEV_AUTO_VERIFY` harus mati di produksi.** Aplikasi menolak startup jika `APP_ENV=production` dan variabel ini bernilai `true`. Begitu juga `MIDTRANS_BASE_URL_OVERRIDE`.
8. **Migrasi tidak mengedit migrasi lama yang sudah dijalankan.** Perubahan skema = migrasi baru.
9. **Jangan menambah dependensi besar** tanpa alasan tertulis. Jangan menambah Redis, Kafka, atau
   Kubernetes. Satu proses Go dan satu PostgreSQL cukup sampai ada bukti sebaliknya.
10. **Jangan melemahkan tes** supaya lulus. Kalau tes gagal, perbaiki kodenya atau jelaskan
    mengapa asumsi tesnya salah.

## Alur menambah fitur

1. Migrasi (`make migrate-new`) dengan RLS dan kebijakan. `make migrate-up`.
2. Query di `backend/db/queries/*.sql`. `make sqlc-generate`.
3. Service (aturan bisnis + pemeriksaan peran), lalu handler, lalu rute di `routes.go` modul itu,
   lalu sambungkan di `internal/api/router.go` dan `cmd/api/main.go` kalau modulnya baru.
4. Tambahkan endpoint ke `api/openapi.yaml`, lalu `npm run gen:api`.
5. Frontend memakai tipe hasil generate. `npm run build` harus bersih.
6. Tulis tes: skrip PASS/FAIL untuk backend, checklist browser untuk layar. Jalankan, lalu commit.

## Commit

Satu commit per langkah yang lulus tes. Format: `fase 11c-2: ringkasan singkat dalam bahasa Indonesia`.
Jangan commit `.env`, `cookies*.txt`, `node_modules`, `dist`.

## Peta modul backend (ringkas)

`identity` (daftar, masuk, sesi, email), `tenant` (bisnis, outlet), `billing` (paket, langganan,
tagihan), `profile` (profil bisnis, kunci Midtrans, QRIS manual), `staff` (undangan staf),
`queue` (sesi antrian, tiket, pembayaran DP, kapster), `publicpage` (halaman outlet publik),
`account` (`GET /v1/me`), `review` (penilaian), `analytics` (statistik), `notification` (Web Push),
`midtrans` (klien API), `webpush`, `realtime` (hub SSE), `jobs` (River), serta pustaka kecil
`rls`, `httpx`, `dbx`, `pgerr`, `cryptox`, `config`.
