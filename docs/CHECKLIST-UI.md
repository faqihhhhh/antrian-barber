# Checklist UI Kapsflow untuk pemilik

Jalankan API (`make dev`), frontend (`cd frontend && npm run dev`), dan website (`cd website && npm run dev`). Buka `http://localhost:5173` untuk aplikasi dan `http://localhost:4321` untuk website. Gunakan akun uji lokal dari `docs/TESTING.md`; jangan masukkan kata sandi produksi ke lingkungan uji.

## Website

- [ ] Buka `http://localhost:4321/` di HP dan pastikan judul, tombol **Buat akun**, tiga langkah pemesanan, bukti dan harga, serta blok demo dapat dibaca.
- [ ] Buka `http://localhost:4321/syarat` dan pastikan halaman syarat tampil dengan logo Kapsflow.
- [ ] Buka `http://localhost:4321/privasi` dan pastikan halaman privasi tampil dengan logo Kapsflow.
- [ ] Buka halaman utama website dengan keyboard dan tekan Tab; pastikan elemen aktif memiliki outline fokus yang terlihat.

## Masuk dan pemisahan ruang

- [ ] Buka `/masuk` dan pastikan formulir mitra tampil tanpa pilihan Mitra/Pelanggan.
- [ ] Buka `/o/contoh-barber`, tekan **Pesan antrian**, lalu pastikan login pelanggan kembali ke halaman outlet itu.
- [ ] Masuk sebagai owner dan pastikan halaman pertama adalah `/pemilik`.
- [ ] Masuk sebagai admin dan pastikan halaman pertama adalah halaman `/kelola/<tenant>/<outlet>`.
- [ ] Masuk sebagai kapster dan pastikan halaman pertama adalah `/kapster`.
- [ ] Masuk sebagai pemilik SaaS dan pastikan halaman pertama adalah `/pemilik-saas`.
- [ ] Masuk sebagai pelanggan dan pastikan pelanggan tetap berada di ruang pelanggan setelah membuka Beranda atau Akun.

## Pelanggan dan pemesanan

- [ ] Buka `/o/contoh-barber` pada lebar 1440px dan pastikan tanggal serta formulir pemesanan tampil dalam dua kolom.
- [ ] Pada outlet, pilih tanggal, ketik nama, tekan **Masuk untuk memesan**, lalu kembali dan pastikan nama masih terisi.
- [ ] Periksa pilihan tanggal outlet dan pastikan tidak ada tile dengan teks `Invalid Date`.
- [ ] Buka tiket berstatus menunggu dan pastikan nomor/kode, posisi antrean, perkiraan menunggu, langkah aktif, lalu notifikasi tampil berurutan.
- [ ] Buka tiket berstatus dipanggil dan pastikan kartu giliran tampil sebelum langkah serta tombol notifikasi tidak tampil.
- [ ] Buka tiket selesai dan pastikan langkah selesai tampil tanpa ajakan notifikasi.

## Kapster

- [ ] Masuk sebagai kapster dan pastikan bar bawah hanya berisi menu ruang kapster.
- [ ] Jika memiliki beberapa workspace, tekan tombol pemilih ruang di header dengan Enter, tutup dengan Esc, lalu pastikan fokus kembali ke tombol.
- [ ] Buka Beranda kapster dan pastikan nama pelanggan yang sedang dilayani lebih menonjol daripada nomor tiket.
- [ ] Pada tiket yang sedang dilayani, cocokkan kode pelanggan dengan kode yang dibacakan kepada kapster.
- [ ] Buka halaman antrean kapster dan pastikan kontrol untuk memanggil, memulai layanan, menyelesaikan, atau melewati tiket tersedia sesuai statusnya.
- [ ] Buka Akun kapster, ubah kata sandi melalui formulir, lalu pastikan pesan berhasil atau kesalahan tampil dengan jelas.

## Admin

- [ ] Masuk sebagai admin dengan sesi aktif dan pembayaran DP menunggu, lalu pastikan tombol konfirmasi terlihat tanpa scroll panjang.
- [ ] Tekan tombol konfirmasi DP dan pastikan tiket masuk ke antrean.
- [ ] Pada sesi aktif, pastikan bagian **Buka sesi baru** tertutup dan dapat dibuka dengan keyboard.
- [ ] Buka daftar antrean admin dan pastikan kode tiket serta tiga digit terakhir pembayaran dijelaskan.
- [ ] Buka menu tautan publik outlet dan pastikan tautan membuka halaman outlet yang benar.

## Owner

- [ ] Masuk sebagai owner dan pastikan navigasi utama hanya menampilkan Beranda, Akun, dan Bisnis.
- [ ] Buka Bisnis dan pastikan akses ke outlet, staf, pembayaran, langganan, statistik, dan ulasan tersedia.
- [ ] Buka pengaturan outlet, ubah harga DP atau durasi, simpan, lalu muat ulang dan pastikan nilainya tersimpan.
- [ ] Buka pengelolaan staf dan pastikan owner dapat mengatur peran admin/kapster dan outlet penugasan.
- [ ] Buka pembayaran DP dan pastikan status metode pembayaran terlihat tanpa menampilkan kunci rahasia.
- [ ] Buka langganan, statistik, dan ulasan satu per satu; pastikan data sesuai tenant yang dipilih.

## Pemeriksaan ukuran dan konsistensi

- [ ] Buka halaman login, outlet, tiket, admin, dan kapster pada lebar 390px; pastikan tidak ada gulir horizontal.
- [ ] Buka halaman yang sama pada lebar 1440px; pastikan konten utama tidak melebar tanpa batas.
- [ ] Pada setiap halaman staf, pastikan indikator koneksi langsung memakai warna hijau yang sama saat tersambung.
- [ ] Pada setiap halaman yang disentuh, tekan Tab dan pastikan fokus keyboard terlihat serta tidak tertutup navigasi bawah.
