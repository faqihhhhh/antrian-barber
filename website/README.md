# Website profil Trimwait

Website statis berbasis Astro untuk profil produk Trimwait. Aplikasi operasional tetap berada di
`frontend/` (React + Vite); CTA website diarahkan ke `PUBLIC_APP_URL`.

Jalankan API, frontend aplikasi, dan website profil. Bagian harga di website membaca harga publik
dari API dan memperbaruinya otomatis setiap 30 detik. Saat pengembangan, Astro meneruskan
`/v1/plans/pricing` ke API lokal. Di produksi, Caddy menyediakan jalur proxy dengan path yang sama
pada domain website, jadi browser tidak perlu akses lintas domain.

Terminal pertama, dari `~/kapsflow/frontend`:

```bash
npm run dev -- --host 0.0.0.0
```

Pastikan API Trimwait juga berjalan di `http://localhost:8080`.

Terminal kedua, dari `~/kapsflow/website`:

```bash
npm install
npm run dev
```

Buka `http://localhost:4321`. Secara bawaan pratinjau, tombol masuk, dan tombol daftar memakai
aplikasi lokal di `http://localhost:5173`. Untuk alamat lain, set `PUBLIC_APP_URL` saat menjalankan Astro.

Build situs statis:

```bash
PUBLIC_APP_URL=https://app.example.com npm run build
npm run preview
```

Ganti `app.example.com` dengan domain yang dipakai pada `APP_DOMAIN` di `.env.production`.
Hasil build ada di `website/dist/`. Halaman `/syarat` dan `/privasi` saat ini adalah draf; lengkapi
identitas operator, kontak, penyedia produksi, lokasi data, dan jadwal retensi sebelum dipublikasikan.
