# Frontend (React + TypeScript)

## Tumpukan

Vite 8 (butuh Node 20.19+ atau 22.12+), React 19, TypeScript, Tailwind CSS 4 (plugin
`@tailwindcss/vite`, `@import "tailwindcss"` di `src/index.css`), React Router 8 (paket
`react-router`, mode deklaratif dengan `BrowserRouter`), TanStack Query 5 (`isPending`, bukan
`isLoading`), `openapi-fetch` + `openapi-typescript`. Lint dengan oxlint.

`.npmrc` berisi `legacy-peer-deps=true` karena `openapi-typescript` 7 belum menyatakan cocok
dengan TypeScript 6. Jangan dihapus.

## Satu origin, tanpa CORS

Di pengembangan, Vite meneruskan `/v1` ke `http://localhost:8080`. Klien API memakai
`window.location.origin` sebagai `baseUrl`, jadi cookie sesi aman dan tidak ada CORS. Di produksi
frontend dan API harus tetap satu domain (reverse proxy). Jangan menambah header CORS.

## Kontrak API

`api/openapi.yaml` adalah sumber kebenaran. Setiap endpoint yang dipakai layar harus ada di sana.
`npm run gen:api` menghasilkan `src/api/schema.d.ts`. Panggilan API memakai `api.GET/POST(...)`
dari `src/api/client.ts` (bertipe penuh). Error API dibungkus `ApiError` dan ditampilkan lewat
`messageOf(err)`. Jangan membuat tipe respons manual kalau sudah ada di `components['schemas']`.

## Struktur `src/`

```
api/         client.ts, schema.d.ts (hasil generate, jangan diedit)
auth/        useMe (['me']), RequireLogin, useResendVerification
components/  ui.tsx (Button, LinkButton, Field, Alert, Spinner, AuthLayout), TicketStub,
             PaymentPanel, ReviewForm, QueueNow
hooks/       useQueueStream (SSE), useMyTickets, usePollWhileActive, useNow
lib/         format.ts (rupiah, tanggal, estimasi), storage.ts (localStorage aman)
pages/       satu file per layar
```

Rute saat ini: `/masuk`, `/daftar`, `/verifikasi-email`, `/lupa-password`, `/atur-ulang-password`,
`/` (Beranda, perlu login), `/b/:slug` (halaman outlet publik), `/tiket` dan `/tiket/:ticketId`
(perlu login). Halaman yang butuh login dibungkus `RequireLogin`, yang menyimpan alamat tujuan
(termasuk query string) agar kembali setelah masuk.

## Aturan kode

- `tsconfig` memakai `erasableSyntaxOnly`: jangan memakai `enum`, `namespace`, atau parameter
  property di constructor.
- Status server di TanStack Query, status layar di `useState`. Jangan menyalin data server ke state.
- Setelah logout panggil `queryClient.clear()` supaya akun berikutnya tidak melihat data lama.
- `localStorage` hanya untuk kenyamanan (nama pelanggan, outlet terakhir) lewat `lib/storage.ts`
  yang aman terhadap error. Jangan menyimpan data penting di sana.
- Realtime: `EventSource` lewat `useQueueStream`. Selalu sediakan cadangan polling, karena koneksi
  SSE bisa putus.
- Tanggal dari API (`2026-10-14`) adalah tanggal lokal outlet. Tampilkan lewat `lib/format.ts`
  (dibaca sebagai UTC) supaya tidak bergeser hari.
- Input teks memakai ukuran 16px (`text-base`) supaya iPhone tidak memperbesar layar.

## Desain

Mobile first (pelanggan memakai HP). Palet `stone` Tailwind, satu warna tegas: kartu gelap
`stone-900` untuk hal yang paling penting (nomor antrian, jumlah antrian). Hijau hanya untuk
"giliran Anda" dan indikator langsung, amber hanya untuk bintang penilaian. Sudut membulat besar
(`rounded-3xl` kartu, `rounded-xl` tombol dan input). Fokus keyboard harus terlihat. Gerak hanya
sebagai jawaban atas aksi pengguna.

Teks antarmuka: bahasa Indonesia sederhana, kalimat aktif, tombol berisi kata kerja ("Pesan dan
bayar DP", bukan "Kirim"). Pesan error menjelaskan apa yang salah dan apa yang bisa dilakukan, tanpa
meminta maaf. Satu aksi memakai satu nama di seluruh alur.

## Pengujian layar

Sebelum menyerahkan layar baru: `npm run build` bersih dan `npm run lint` tanpa temuan. Uji tampilan
dengan Chromium tanpa kepala (Playwright) terhadap API tiruan (`page.route`) dan `EventSource` tiruan,
lalu ambil tangkapan layar ukuran HP (390x844). Terakhir, pemilik menjalankan checklist browser
terhadap backend asli.
