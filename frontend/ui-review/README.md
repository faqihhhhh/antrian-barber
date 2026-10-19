# Perbandingan UI Kapsflow

Tangkapan layar dibuat dengan API tiruan yang sama, pada lebar 390 px dan 1440 px. `before/` memakai frontend pada commit `6785348`; `after/` memakai perubahan Tahap UI 1–5.

Keadaan yang direkam pada setiap ukuran:

- Masuk
- Daftar
- Lupa password
- Atur ulang password
- Verifikasi email berhasil
- Halaman 404
- Beranda setelah login tiruan (owner dengan status masa tenggang dan outlet Jakarta)
- Masuk dengan error email belum diverifikasi

Semua berkas PNG ada di folder `before/` dan `after/`, dengan nama yang menyertakan keadaan dan lebar viewport. `keyboard-focus.json` berisi hasil pemeriksaan fokus keyboard di halaman masuk.

Hasil axe-core pada 16 keadaan di `after/` (8 keadaan × 2 ukuran) tidak menemukan pelanggaran WCAG 2.1 A/AA, termasuk kontras warna dan label form. Fokus keyboard telah diperiksa pada form masuk dan seluruh kontrol interaktif beranda di ukuran HP serta desktop; datanya ada di dua berkas JSON.
