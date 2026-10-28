import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router'
import { api, messageOf } from '../api/client'
import { useMe } from '../auth/useMe'
import { Alert, Spinner } from '../components/ui'
import { lastOutlet } from '../lib/storage'

export default function PelangganBeranda() {
  const me = useMe()
  const navigate = useNavigate()
  const outlet = lastOutlet()
  const displayName = me.data?.user.display_name
  const directory = useQuery({
    queryKey: ['public-outlet-directory'],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/public/outlets')
      if (error) throw new Error(messageOf(error))
      return data
    },
    staleTime: 60_000,
  })

  return (
    <main className="mx-auto min-h-[70dvh] max-w-2xl space-y-6 px-5 py-8">
      <header>
        <h1 className="text-2xl font-bold">{displayName ? `Halo, ${displayName}` : 'Ruang pelanggan'}</h1>
        <p className="mt-1 text-sm text-body-muted">Pesan antrean dan pantau giliran Anda.</p>
      </header>

      <section className="space-y-3 rounded-3xl border border-line bg-white p-5">
        <h2 className="text-lg font-semibold">Antrean Anda</h2>
        <p className="text-sm leading-6 text-body-muted">Lihat tiket aktif, status pembayaran, dan riwayat antrean Anda.</p>
        <Link to="/tiket" className="inline-flex min-h-11 items-center rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ink">
          Lihat tiket saya
        </Link>
      </section>

      <section className="space-y-3 rounded-3xl border border-line bg-white p-5">
        <h2 className="text-lg font-semibold">Pilih barbershop atau salon</h2>
        <p className="text-sm leading-6 text-body-muted">Pilih bisnis dan outlet untuk melihat jadwal antreannya.</p>
        {directory.isPending ? <Spinner /> : directory.isError ? <Alert>{directory.error.message}</Alert> : directory.data.length === 0 ? (
          <p className="text-sm text-body-muted">Belum ada outlet yang terdaftar.</p>
        ) : (
          <label className="block">
            <span className="sr-only">Pilih barbershop atau salon</span>
            <select
              aria-label="Pilih barbershop atau salon"
              className="min-h-11 w-full rounded-xl border border-line-strong bg-white px-4 py-2.5 text-base text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ink"
              value=""
              onChange={(event) => {
                if (event.target.value) navigate(`/o/${event.target.value}`)
              }}
            >
              <option value="" disabled>Pilih bisnis atau outlet</option>
              {directory.data.map((item) => (
                <option key={item.slug} value={item.slug}>{item.business_name} — {item.outlet_name}</option>
              ))}
            </select>
          </label>
        )}
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
