import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, messageOf } from '../api/client'
import { useMe } from '../auth/useMe'
import QueueNow from '../components/QueueNow'
import { Alert, Button, Field, LinkButton, Spinner } from '../components/ui'
import { MY_TICKETS_KEY } from '../hooks/useMyTickets'
import { useQueueStream } from '../hooks/useQueueStream'
import { dayOfMonth, formatLongDate, formatMonthYear, formatRupiah, weekdayShort } from '../lib/format'
import { saveLastOutlet, saveName, savedName } from '../lib/storage'

type OutletData = NonNullable<Awaited<ReturnType<typeof fetchOutlet>>>

async function fetchOutlet(slug: string) {
  const { data, error, response } = await api.GET('/v1/public/outlets/{slug}', { params: { path: { slug } } })
  if (response.status === 404) return null
  if (!response.ok || !data) throw new ApiError(error)
  return data
}

const UNAVAILABLE_TEXT: Record<string, string> = {
  langganan_tidak_aktif: 'Outlet ini sedang tidak menerima pemesanan online.',
  harga_dp_belum_diatur: 'Pemesanan online belum dibuka oleh outlet ini.',
  pembayaran_belum_diatur: 'Pemesanan online belum dibuka oleh outlet ini.',
}

export default function Outlet() {
  const { slug = '' } = useParams()
  const outlet = useQuery({
    queryKey: ['outlet', slug],
    queryFn: () => fetchOutlet(slug),
    refetchInterval: 30_000,
  })

  useEffect(() => {
    if (outlet.data) saveLastOutlet(slug)
  }, [outlet.data, slug])

  if (outlet.isPending) return <Spinner />
  if (outlet.isError) {
    return (
      <main className="mx-auto max-w-md px-5 py-10">
        <Alert>{messageOf(outlet.error)}</Alert>
      </main>
    )
  }
  if (!outlet.data) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 text-center">
        <h1 className="text-2xl font-bold">Outlet tidak ditemukan</h1>
        <p className="mt-2 text-sm text-body-muted">Periksa lagi tautan atau scan ulang QR dari outlet.</p>
      </main>
    )
  }
  return <OutletView outlet={outlet.data} />
}

function OutletView({ outlet }: { outlet: OutletData }) {
  const stream = useQueueStream(outlet.today?.session_id)
  const today = stream.snapshot ?? outlet.today

  return (
    <main className="mx-auto max-w-md space-y-6 px-5 py-8">
      <header>
        <p className="text-sm text-body-muted">{outlet.business_name}</p>
        <h1 className="text-2xl font-bold">{outlet.outlet_name}</h1>
        {outlet.address && <p className="mt-1 text-sm text-body-muted">{outlet.address}</p>}
      </header>

      <QueueNow today={today} live={stream.connected} />

      {outlet.accepting_bookings ? (
        <BookingSection outlet={outlet} />
      ) : (
        <Alert tone="info">
          {(outlet.unavailable_reason && UNAVAILABLE_TEXT[outlet.unavailable_reason]) ||
            'Outlet ini belum menerima pemesanan online.'}
        </Alert>
      )}

      <nav className="text-center text-sm">
        <Link to="/tiket" className="font-semibold underline">
          Lihat tiket saya
        </Link>
      </nav>
    </main>
  )
}

function BookingSection({ outlet }: { outlet: OutletData }) {
  const me = useMe()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const [name, setName] = useState(savedName)

  // Tanggal terpilih: dari alamat (supaya bertahan setelah login), kalau tidak ada
  // atau tidak valid, hari pertama yang masih bisa dipesan.
  const wanted = params.get('tanggal')
  const firstOpen = outlet.days.find((d) => d.open)
  const selected = outlet.days.find((d) => d.open && d.date === wanted) ?? firstOpen

  const book = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error('belum ada tanggal')
      const { data, error, response } = await api.POST('/v1/tenants/{tenantID}/outlets/{outletID}/book', {
        params: { path: { tenantID: outlet.tenant_id, outletID: outlet.outlet_id } },
        body: { session_date: selected.date, customer_name: name.trim() || undefined },
      })
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
    onSuccess: async (result) => {
      saveName(name.trim())
      await queryClient.invalidateQueries({ queryKey: MY_TICKETS_KEY })
      navigate(`/tiket/${result.ticket_id}`)
    },
  })

  if (!firstOpen) {
    return <Alert tone="info">Tidak ada tanggal yang bisa dipesan dalam 14 hari ke depan. Coba lagi nanti.</Alert>
  }

  const loggedIn = !!me.data
  const from = location.pathname + location.search
  const hasUnpaid = book.error instanceof ApiError && book.error.code === 'masih_ada_pesanan_belum_dibayar'

  return (
    <section className="space-y-4" aria-label="Pesan antrian">
      <div>
        <h2 className="text-lg font-bold">Pesan antrian</h2>
        <p className="text-sm text-body-muted">Pilih tanggal. Nomor antrian Anda aman setelah DP dibayar.</p>
      </div>

      <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Pilih tanggal">
        {outlet.days.map((d) => {
          const isSelected = selected?.date === d.date
          const note = !d.session_id ? 'Belum buka' : d.open ? `Sisa ${d.remaining}` : d.remaining === 0 ? 'Penuh' : 'Tutup'
          return (
            <button
              key={d.date}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={!d.open}
              onClick={() => setParams({ tanggal: d.date }, { replace: true })}
              className={`rounded-xl border px-1 py-2 text-center transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink disabled:cursor-not-allowed ${
                isSelected
                  ? 'border-ink bg-ink text-white'
                  : d.open
                    ? 'border-line-strong bg-white hover:border-ink'
                    : 'border-line bg-paper-raised text-muted'
              }`}
            >
              <span className="block text-xs">{d.date === outlet.local_today ? 'Hari ini' : weekdayShort(d.date)}</span>
              <span className="block text-xl font-bold tabular-nums">{dayOfMonth(d.date)}</span>
              <span className="block text-[10px]">{formatMonthYear(d.date)}</span>
              <span className="block text-xs">{note}</span>
            </button>
          )
        })}
      </div>

      {selected && (
        <form
          className="space-y-4 rounded-3xl border border-line bg-white p-5"
          onSubmit={(e) => {
            e.preventDefault()
            if (loggedIn) book.mutate()
          }}
        >
          <p className="text-sm">
            <strong>{formatLongDate(selected.date)}</strong>
          </p>
          <Field
            label="Nama yang dipanggil kapster"
            name="nama"
            autoComplete="name"
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="flex items-baseline justify-between border-t border-line-soft pt-3 text-sm">
            <span className="text-body-muted">DP lewat QRIS</span>
            <strong className="text-lg tabular-nums">{formatRupiah(outlet.dp_price_rupiah)}</strong>
          </div>

          {book.isError && (
            <Alert>
              {messageOf(book.error)}
              {hasUnpaid && (
                <>
                  {' '}
                  <Link to="/tiket" className="font-semibold underline">
                    Lanjutkan pembayaran
                  </Link>
                </>
              )}
            </Alert>
          )}

          {me.isPending ? (
            <Button type="button" disabled>
              Memuat…
            </Button>
          ) : loggedIn ? (
            <Button type="submit" loading={book.isPending}>
              Pesan dan bayar DP
            </Button>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-body-muted">Masuk dulu supaya tiket Anda tersimpan dan bisa dilihat dari HP mana pun.</p>
              <LinkButton to="/masuk" state={{ from }}>
                Masuk untuk memesan
              </LinkButton>
              <LinkButton to="/daftar" state={{ from }} variant="outline">
                Buat akun baru
              </LinkButton>
            </div>
          )}
        </form>
      )}
    </section>
  )
}
