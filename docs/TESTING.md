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

Skrip integrasi yang sudah disimpan di `scripts/verify/`: `verify_fase11c1.sh` dan
`verify_fase11d.sh`. Skrip 11d memeriksa matriks owner, admin, kapster, pelanggan, dan orang luar;
11c1 menguji pembayaran lewat Midtrans tiruan dan memastikan RLS menolak perubahan langsung oleh
pelanggan. Pola semuanya sama:

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

## Sebelum commit

`go build -C backend ./...`, skrip verifikasi fase terkait (0 gagal), `npm run build`, `npm run lint`,
lalu checklist browser untuk perubahan layar.
