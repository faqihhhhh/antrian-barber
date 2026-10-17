# Website profil Kapsflow

Website statis berbasis Astro untuk profil produk Kapsflow. Aplikasi operasional tetap berada di
`frontend/` (React + Vite); CTA website diarahkan ke `PUBLIC_APP_URL`.

Jalankan di WSL dari `~/kapsflow/website`:

```bash
npm install
npm run dev
```

Buka `http://localhost:4321`. Secara bawaan tombol masuk dan daftar mengarah ke aplikasi lokal di
`http://localhost:5173`. Untuk alamat lain, set `PUBLIC_APP_URL` saat menjalankan Astro.

Build situs statis:

```bash
npm run build
npm run preview
```

Hasil build ada di `website/dist/`. Syarat penggunaan dan kebijakan privasi akan dibuat pada langkah
fase 13 berikutnya setelah alur produk dan data yang diproses dirinci.
