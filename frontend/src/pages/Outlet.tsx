import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, messageOf } from '../api/client'
import { useMe } from '../auth/useMe'
import { Logo } from '../components/Logo'
import QueueNow from '../components/QueueNow'
import { Alert, Button, Field, Spinner } from '../components/ui'
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
        <Button type="button" variant="secondary" onClick={() => void outlet.refetch()}>Coba lagi</Button>
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
    <main className="mx-auto min-h-dvh max-w-6xl px-5 pb-12 pt-4 sm:px-8 lg:px-10">
      <header className="mb-8 flex items-center justify-between border-b border-line pb-4">
        <Logo />
        <Link to="/tiket" className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-accent-ink underline focus-visible:outline-2 focus-visible:outline-brand-ink">
          Tiket saya
        </Link>
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,0.9fr)] lg:items-start lg:gap-12">
        <div className="space-y-6">
          <section>
            <p className="text-sm font-semibold text-body-muted">{outlet.business_name}</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight">{outlet.outlet_name}</h1>
            {outlet.address && <p className="mt-2 text-sm text-body-muted">{outlet.address}</p>}
          </section>

          <section className="grid grid-cols-2 gap-3 rounded-2xl border border-line bg-white p-4" aria-label="Informasi layanan">
            <div>
              <p className="text-xs text-body-muted">Uang muka</p>
              <p className="mt-1 font-bold tabular-nums">{formatRupiah(outlet.dp_price_rupiah)}</p>
            </div>
            <div>
              <p className="text-xs text-body-muted">Durasi layanan</p>
              <p className="mt-1 font-bold">± {outlet.default_duration_minutes} menit</p>
            </div>
          </section>

          <QueueNow today={today} live={stream.connected} />
        </div>

        <div className="space-y-4 lg:pt-1">
          {outlet.accepting_bookings ? (
            <BookingSection outlet={outlet} />
          ) : (
            <Alert tone="info">
              {(outlet.unavailable_reason && UNAVAILABLE_TEXT[outlet.unavailable_reason]) ||
                'Outlet ini belum menerima pemesanan online.'}
            </Alert>
          )}
          <p className="text-center text-xs text-body-muted">Dikelola dengan Trimwait</p>
        </div>
      </div>
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
  const validDays = outlet.days.filter((day) => dayOfMonth(day.date) !== '')
  const firstOpen = validDays.find((d) => d.open)
  const selected = validDays.find((d) => d.open && d.date === wanted) ?? firstOpen
  const openedDays = validDays.filter((day) => day.session_id !== null)
  const notOpenedCount = validDays.filter((day) => day.session_id === null).length

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

      <fieldset>
        <legend className="sr-only">Pilih tanggal antrian</legend>
        <div className="flex gap-2 overflow-x-auto pb-2" role="group" aria-label="Tanggal yang sudah dibuka">
        {openedDays.map((d) => {
          const isSelected = selected?.date === d.date
          const note = d.open ? `Sisa ${d.remaining}/${d.max_quota}` : d.remaining === 0 ? 'Penuh' : 'Tutup'
          return (
            <label key={d.date} className="relative min-w-[5.5rem] flex-none cursor-pointer">
              <input
                type="radio"
                name="tanggal-antrian"
                value={d.date}
                checked={isSelected}
                disabled={!d.open}
                onChange={() => setParams({ tanggal: d.date }, { replace: true })}
                className="peer sr-only"
              />
              <span className={`block rounded-xl border px-2 py-2 text-center transition peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-ink ${
                isSelected
                  ? 'border-ink bg-ink text-white'
                  : d.open
                    ? 'border-line-strong bg-white hover:border-ink'
                    : 'border-line bg-paper-raised text-muted cursor-not-allowed'
              }`}
              >
                <span className={`block text-xs ${d.date === outlet.local_today && !isSelected ? 'text-accent' : ''}`}>{d.date === outlet.local_today ? 'Hari ini' : weekdayShort(d.date)}</span>
                <span className="block text-xl font-bold tabular-nums">{dayOfMonth(d.date)}</span>
                <span className="block text-xs">{formatMonthYear(d.date)}</span>
                <span className="block text-xs">{note}</span>
              </span>
            </label>
          )
        })}
        </div>
      </fieldset>
      {notOpenedCount > 0 && <p className="-mt-2 text-xs text-body-muted">{notOpenedCount} tanggal lain belum dibuka.</p>}

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
          {!loggedIn && (
            <p className="text-sm text-body-muted">Masuk dulu supaya tiket yang Anda pesan tersimpan di akun.</p>
          )}
          <Field
            label="Nama yang dipanggil kapster"
            name="nama"
            autoComplete="name"
            maxLength={60}
            value={name}
            onChange={(e) => {
              const value = e.target.value
              setName(value)
              saveName(value)
            }}
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
              <Button to="/pelanggan/masuk" state={{ from }}>
                Masuk untuk memesan
              </Button>
              <Button to="/daftar" state={{ from }} variant="secondary">
                Buat akun baru
              </Button>
            </div>
          )}
        </form>
      )}
    </section>
  )
}
