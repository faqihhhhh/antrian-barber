import { Link } from 'react-router'
import { useMe } from '../auth/useMe'
import { lastOutlet } from '../lib/storage'

export default function PelangganBeranda() {
  const me = useMe()
  const outlet = lastOutlet()
  const username = me.data?.user.username

  return (
    <main className="mx-auto min-h-[70dvh] max-w-2xl space-y-6 px-5 py-8">
      <header>
        <h1 className="text-2xl font-bold">{username ? `Halo, ${username}` : 'Ruang pelanggan'}</h1>
        <p className="mt-1 text-sm text-body-muted">Pesan antrean dan pantau giliran Anda.</p>
      </header>

      <section className="space-y-3 rounded-3xl border border-line bg-white p-5">
        <h2 className="text-lg font-semibold">Antrean Anda</h2>
        <p className="text-sm leading-6 text-body-muted">Lihat tiket aktif, status pembayaran, dan riwayat antrean Anda.</p>
        <Link to="/tiket" className="inline-flex min-h-11 items-center rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ink">
          Lihat tiket saya
        </Link>
      </section>

      {outlet ? (
        <section className="rounded-3xl border border-line bg-white p-5">
          <h2 className="font-semibold">Pesan lagi di outlet terakhir</h2>
          <p className="mt-1 text-sm leading-6 text-body-muted">Buka kembali halaman outlet untuk melihat jadwal dan memesan antrean.</p>
          <Link to={`/o/${outlet}`} className="mt-3 inline-flex min-h-11 items-center px-1 text-sm font-semibold text-brand-ink underline focus-visible:outline-2 focus-visible:outline-brand-ink">
            Buka outlet
          </Link>
        </section>
      ) : (
        <p className="text-sm leading-6 text-body-muted">Untuk memesan antrean, buka tautan atau pindai QR dari outlet.</p>
      )}
    </main>
  )
}
