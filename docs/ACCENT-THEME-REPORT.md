# Laporan tema monokrom dengan aksen indigo

## Pilihan warna

| Token | Nilai | Penggunaan |
|---|---|---|
| `accent` | `#4338CA` | Penanda indigo dan langkah aktif |
| `accent-ink` | `#3730A3` | Tautan/badge pada latar terang |
| `accent-soft` | `#EEF2FF` | Latar info dan badge |
| `accent-on-dark` | `#A5B4FC` | Label kecil pada permukaan gelap |
| `paper` | `#FAF7F2` | Latar aplikasi, website, dan `theme-color` |
| `ink-brand` | `#1C1917` | Tinta glyph brand dan latar CTA penutup website |

`ink-brand` ditambahkan sebagai token netral tambahan agar penggunaan #1C1917 mengikuti token dan lulus pemeriksaan identitas. Tombol utama tetap `bg-ink`. Warna hijau, amber, dan merah untuk status tidak diubah.

## Bukti sebelum perubahan

Perintah: `node scripts/verify/check-accent.mjs --capture-before`.

```text
FAIL Token --color-accent tersedia
PASS Tombol utama tetap memakai bg-ink
PASS Website tidak memakai amber lama
PASS Kontras aksen pada paper minimal 4,5:1 — 7.40:1
PASS Kontras aksen-on-dark pada ink minimal 4,5:1 — 8.77:1
FAIL Langkah tiket in_progress memakai warna aksen — teks rgb(23, 23, 23); bar rgb(23, 23, 23)
FAIL Langkah tiket in_progress memakai warna aksen — teks rgb(23, 23, 23); bar rgb(23, 23, 23)
3 pemeriksaan gagal: token belum ada dan warna langkah in_progress tidak sesuai pada dua ukuran layar.
```

Screenshot before disimpan untuk `/`, `/o/contoh-barber`, `/tiket/:id` berstatus `in_progress`, dan halaman admin (`/kelola/...`) di 390×844 serta 1440×900.

## Hasil sesudah perubahan

`node scripts/verify/check-accent.mjs` lulus semua pemeriksaan. Kontras terukur tetap 7.40:1 untuk `#4338CA` di atas paper dan 8.77:1 untuk `#A5B4FC` di atas `#1C1917`. Pada tiket `in_progress`, teks langkah aktif dan bar aktif terhitung `rgb(67, 56, 202)` pada kedua viewport.

Screenshot after dengan ukuran yang sama:

- Website `/`: `frontend/ui-review/after/after-website-home-{390,1440}.png`
- Outlet: `frontend/ui-review/after/after-app-outlet-contoh-barber-{390,1440}.png`
- Tiket `in_progress`: `frontend/ui-review/after/after-app-tiket-in-progress-{390,1440}.png`
- Admin: `frontend/ui-review/after/after-app-admin-kelola-{390,1440}.png`

Skrip regresi yang dijalankan: `check-identity`, `check-a11y`, `check-content`, `check-responsive`, `check-booking`, `check-invalid-date`, `check-ticket`, `check-admin`, `check-staff`, dan `inventory`. Semuanya lulus setelah dua ekspektasi tes disesuaikan: theme-color website mengikuti paper baru, dan status `completed` mempertahankan seluruh bar sebagai ink.

Build dan lint:

| Perintah | Hasil |
|---|---|
| `cd frontend && npm run build` | PASS — TypeScript dan Vite |
| `cd frontend && npm run lint` | PASS — oxlint tanpa temuan |
| `cd website && npm run build` | PASS — 3 halaman statis |

## File yang berubah

- `frontend/src/index.css`, `frontend/index.html`, `frontend/AGENTS.md`
- `frontend/src/components/ui.tsx`, `frontend/src/components/Logo.tsx`
- `frontend/src/pages/Outlet.tsx`, `Tiket.tsx`, `Admin.tsx`, `Kapster.tsx`
- `website/src/pages/index.astro`, `website/src/layouts/LegalLayout.astro`
- `scripts/verify/check-accent.mjs`, serta penyesuaian tes `check-identity.mjs` dan `check-ticket.mjs`
- `docs/ROADMAP.md` dan laporan ini

## Belum diverifikasi

- Screenshot dan interaksi dijalankan di Chromium desktop dengan fixture API tiruan. Tampilan di perangkat fisik, browser lain, dan skema warna paksa sistem operasi belum diuji.
- Perubahan ini tidak menguji alur API/database; tidak ada backend atau kontrak API yang diubah.
- Warna merah/hijau/amber yang ada untuk status dan peringatan tetap utuh; cakupan visual regressi untuk seluruh layar di luar halaman yang disebutkan tidak dijalankan.
