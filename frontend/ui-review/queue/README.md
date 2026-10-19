# Tangkapan layar layar antrian

Semua gambar dibuat dari build lokal memakai mock API dan ukuran viewport yang tertulis di nama file.
Ini bukti tampilan, bukan bukti alur pembayaran terhadap akun produksi.

| Gambar | Tampilan |
|---|---|
| `outlet-1440.png` | Halaman outlet publik pada desktop |
| `admin-1440.png` | Konsol owner/admin, sesi, DP dan pelunasan |
| `ticket-pending_payment-390.png` | Tiket menunggu DP manual |
| `ticket-waiting-390.png` | Tiket dalam antrian dan estimasi |
| `ticket-called-390.png` | Giliran dipanggil dan kode pencocokan |
| `ticket-in_progress-390.png` | Pelanggan sedang dilayani |
| `ticket-completed-390.png` | Tiket selesai dan form ulasan |
| `ticket-canceled-390.png` | Tiket dibatalkan dan tautan pesan ulang |
| `kapster-idle-390.png` | Kapster siap mengambil tiket |
| `kapster-ready-390.png` | Kapster menunggu tiket berikutnya |
| `kapster-busy-390.png` | Kapster melayani pelanggan |

Pengujian Playwright mock juga membuka halaman pelanggan dan kapster bersamaan. Sesudah kapster menekan
**Siap**, event SSE memicu pengambilan ulang data dan halaman pelanggan berubah menjadi **Giliran Anda!**
tanpa reload.

Audit axe pada state yang ditangkap lulus WCAG 2.1 A/AA tanpa pelanggaran kontras atau label form. Alur
manual lengkap juga dijalankan terhadap backend lokal dengan akun uji baru: pelanggan pesan dan menunggu
DP, admin konfirmasi DP, kapster memanggil/mulai/menyelesaikan, lalu admin mencatat pelunasan. Akun, sesi,
dan tiket uji dibersihkan setelah pemeriksaan.

Catatan respons backend: endpoint **Siap** mengembalikan tiket dengan `status: waiting` pada respons aksi,
meskipun status tiket sudah `called` di database. UI mengikuti pola yang disyaratkan dan mengambil ulang
daftar tiket setelah aksi; daftar itu sudah berstatus `called`. Perbaikan backend yang disarankan adalah
mengembalikan tiket setelah perubahan status.
