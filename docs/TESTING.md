# Cara menguji

Prinsip: setiap langkah punya bukti yang bisa dijalankan. Tidak ada "sepertinya benar".
Bentuk bukti: skrip bash PASS/FAIL untuk backend, checklist browser untuk layar, dan tes Playwright
dengan API tiruan untuk tampilan.

## Akun dan data uji (database lokal pemilik)

File cookie sesi di `~/kapsflow` (dibuat dengan `curl -c`, tidak di-commit):

| File | Akun |
|---|---|
| `cookies.txt` | Pemilik SaaS (platform admin). Juga bisa mengakses tenant mana pun secara sah |
| `cookiesB.txt` | Owner tenant B |
| `cookiesAdminB.txt` | Admin tenant B |
| `cookiesKapsterB.txt` | Kapster tenant B |
| `cookiesKapster.txt`, `cookiesKapster2.txt` | Kapster tenant A |
| `cookiesPembeli.txt`, `cookiesPembeli2.txt` | Dua pelanggan |

ID tetap di database lokal (bisa berbeda kalau database dibuat ulang): tenant A
`50871685-cdc1-47a7-bf8f-f2bcf45d731a`, tenant B `3159e203-02c0-49b0-8fe5-1e94ebbae2e1`, outlet tenant B
`3ae1bd6e-fb87-4963-9ef4-d93e998e03c6` (slug `salon-cabang-utama-2-3ae1bd`).

Membuat cookie baru:
```bash
curl -s -c cookiesX.txt -X POST localhost:8080/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"...","password":"..."}'
```
Akun tes dibuat dengan `DEV_AUTO_VERIFY=true`. Jangan memakai kata sandi nyata.

## Skrip verifikasi

Skrip integrasi yang sudah disimpan di `scripts/verify/` mencakup `verify_fase11c1.sh`,
`verify_fase11d.sh`, `verify_fase12b_expired_sessions.sh`, dan
`verify_fase12c1_owner_outlet_settings.sh`, `verify_fase12c2_owner_staff_access.sh`, dan
`verify_fase12c3_owner_payment_profile.sh`, `verify_fase12c7_owner_subscription.sh`, dan
`verify_fase12c8_subscription_period.sh`. Skrip 11d
memeriksa matriks owner, admin, kapster, pelanggan, dan orang luar; 11c1 menguji pembayaran lewat
Midtrans tiruan; 12b menguji penutupan sesi lewat tanggal; 12c1 memeriksa respons outlet; 12c2
memastikan daftar staf hanya bisa dibaca owner; 12c3 memeriksa status pembayaran dan izin QRIS owner.
Skrip 12c7 memastikan hanya owner yang membaca status dan riwayat tagihan serta kolom internal tidak
terkirim ke klien.
Skrip 12c8 membuat tenant dan invoice sementara, mengonfirmasi invoice lewat API, lalu memastikan
rentang periode sama dengan hasil query database dan membersihkan tenant uji.
Pola semuanya sama:

```bash
check() {  # nama, diharapkan, didapat
  if [ "$2" = "$3" ]; then echo "PASS  $1"
  else FAILS=$((FAILS+1)); echo "FAIL  $1"; echo "      diharapkan: $2"; echo "      didapat   : $3"; fi
}
sql()  { docker compose exec -T db psql -U kapsflow -d kapsflow -At -c "$1"; }   # bandingkan API dengan database
code() { jq -r '.error.code // "OK"'; }
```
Skrip menyiapkan keadaan awalnya sendiri, aman diulang, dan diakhiri `Selesai: N pemeriksaan gagal.`
Tes baru wajib mengandung data yang membuat kode salah **gagal**. Contoh pelajaran: tes siaran
realtime hanya bermakna kalau ada tiket milik orang lain di sesi itu (tiket offline).

Skrip membuat sesi di tanggal acak 20 sampai 320 hari ke depan (`freedate` memastikan belum dipakai).
Data uji menumpuk di tenant B dan tidak dibersihkan semuanya.

## Midtrans tiruan

Simulator Midtrans sandbox pemilik tidak bisa menyelesaikan pembayaran, jadi jalur Midtrans diuji dengan
server tiruan. `verify_fase11c1.sh` menjalankannya sendiri di port 9099 (status transaksi dibaca dari
`/tmp/fake_midtrans_status`: `pending`, `settlement`, `expire`). API harus dijalankan dengan:
```bash
MIDTRANS_BASE_URL_OVERRIDE=http://localhost:9099 make dev
```
Setelah tes, jalankan `make dev` seperti biasa. Yang belum terbukti: bentuk respons status dan webhook
dari Midtrans asli (baru cocok dengan dokumentasi, belum terlihat langsung).

## Tes tampilan frontend

Playwright (`playwright-core`) memakai Chromium bawaan di `/opt/pw-browsers/chromium` pada sandbox agen.
Pola: `page.route('**/v1/**', ...)` untuk API tiruan, `addInitScript` untuk mengganti `EventSource`
dengan versi yang bisa dipicu (`window.__emit(snapshot)`), jendela 390x844, tangkapan layar, dan
daftar pemeriksaan teks dan elemen. Server pratinjau: `npx vite preview --port 4173`.

## Checklist browser (backend asli)

Dua terminal: `make dev` dan `npm run dev`. Buka `http://localhost:5173/b/<slug>`.
Buat sesi bersih dengan `POST /v1/tenants/$T/outlets/$OUTLET/queue-sessions`. Alur yang diuji:
belum login -> masuk -> kembali ke tanggal pilihan -> pesan -> layar bayar -> "Saya sudah bayar" ->
konfirmasi admin lewat `curl` -> status berubah sendiri -> `ready`, `start`, `complete` lewat kapster ->
form penilaian -> cek `GET /v1/tenants/$T/reviews`. Realtime: tambah tiket offline ke sesi hari ini dan
lihat angka antrian naik di halaman outlet tanpa reload.

Untuk layar owner: masuk dengan akun owner tenant B, buka Beranda lalu **Atur outlet**. Pastikan
nama outlet, harga DP, durasi bawaan, dan tautan publik tampil. Ubah harga DP dan durasi, simpan,
lalu muat ulang untuk memastikan nilai tetap tersimpan. Buka tautan outlet dan pastikan halaman
publiknya masih bisa dibuka.

Untuk staf owner: dari **Pengaturan outlet**, buka **Kelola staf**. Pastikan daftar staf dan status
verifikasi email tampil. Form undangan harus menyediakan pilihan peran Admin/Kapster (boleh keduanya)
dan penugasan outlet; role Owner tidak boleh tersedia.

Untuk pembayaran owner: buka **Pengaturan outlet → Pembayaran DP**. Pastikan status QRIS manual tampil.
Pilih gambar QRIS PNG/JPG/WebP maksimal 512 KB dan simpan hanya jika ingin mengganti QRIS aktif.
Midtrans hanya menampilkan status konfigurasi; jangan isi kunci tanpa akun Midtrans.

Untuk tautan outlet owner: di **Pengaturan outlet**, tekan **Salin tautan** dan pastikan pesan
konfirmasi tampil serta URL dapat ditempel di tab baru. Tekan **Buka halaman** dan pastikan halaman
publik outlet terbuka di tab baru.

Untuk statistik owner: dari **Pengaturan outlet**, buka **Statistik**. Pastikan periode 30 hari,
total tiket, tiket selesai, pendapatan DP, DP belum lunas, rata-rata DP, dan tingkat penyelesaian tampil.
Jika memiliki beberapa tenant owner, ganti pilihan bisnis dan pastikan angka ikut berganti.

Untuk ulasan owner: buka **Ulasan pelanggan**. Pastikan ringkasan rating tiap kapster dan ulasan
terbaru tampil, komentar kosong diberi keterangan, serta tombol halaman berikutnya bekerja bila ada
20 ulasan. Admin/kapster tidak boleh bisa membaca daftar ulasan.

Untuk langganan owner: buka **Langganan**. Pastikan status, tanggal akhir periode, dan riwayat tagihan
tampil. Tagihan dibayar manual dan dikonfirmasi pemilik Kapsflow; layar ini hanya menampilkan status.
Untuk invoice yang dikonfirmasi setelah migrasi periode audit, pastikan rentang periode yang diberikan
tampil. Invoice lama menampilkan keterangan periode belum tercatat karena datanya tidak bisa dipastikan.
Pastikan owner tidak bisa membuat tagihan saat periode aktif masih lebih dari 7 hari dan hanya ada
satu invoice pending untuk satu bisnis.

Untuk pemilik SaaS: masuk memakai akun platform admin (`cookies.txt`), buka Beranda, lalu tekan
**Buka ringkasan platform** (atau buka `/pemilik-saas`). Pastikan MRR, ARR, jumlah tenant menurut
status langganan, tingkat konversi dan churn, tagihan tertunda, aktivitas 30 hari, serta tren bulanan
12 bulan tampil. Masuk dengan akun owner tenant biasa (`cookiesB.txt`) dan buka `/pemilik-saas`;
layar harus menolak akses dan API `GET /v1/admin/stats` harus membalas 403.

Untuk website profil, dari `~/kapsflow/website` jalankan `npm run dev`, lalu buka
`http://localhost:4321`. Periksa tampilan desktop dan lebar ponsel: menu, judul, ilustrasi antrean,
bagian cara kerja, dan CTA harus terbaca tanpa gulir horizontal. Pastikan **Masuk**, **Buat akun**,
dan kedua CTA pendaftaran mengarah ke `http://localhost:5173/masuk` atau `/daftar` yang sesuai.
Build statis dibuktikan dengan `npm run build`; hasilnya harus memuat `/index.html`.

## Sebelum commit

`go build -C backend ./...`, skrip verifikasi fase terkait (0 gagal), `npm run build`, `npm run lint`,
lalu checklist browser untuk perubahan layar.
