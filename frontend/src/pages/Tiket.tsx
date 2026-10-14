import { Link, useParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { messageOf } from '../api/client'
import PaymentPanel from '../components/PaymentPanel'
import ReviewForm from '../components/ReviewForm'
import TicketStub from '../components/TicketStub'
import { Alert, Spinner } from '../components/ui'
import { MY_TICKETS_KEY, useMyTickets, type MyTicket } from '../hooks/useMyTickets'
import { useQueueStream } from '../hooks/useQueueStream'
import { formatWait, isActiveStatus } from '../lib/format'
import { usePollWhileActive } from '../hooks/usePollWhileActive'

export default function Tiket() {
  const { ticketId } = useParams()
  const queryClient = useQueryClient()
  // Lebih sering diperiksa saat menunggu pembayaran (status berubah begitu admin/Midtrans mengonfirmasi).
  const tickets = useMyTickets(false)
  const ticket = tickets.data?.find((t) => t.ticket_id === ticketId)
  const live = ticket && isActiveStatus(ticket.status)

  // Antrian bergerak -> ambil ulang tiket ini. Pembaruan realtime dari server,
  // tanpa menunggu polling.
  useQueueStream(live ? ticket.session_id : null, () => {
    queryClient.invalidateQueries({ queryKey: MY_TICKETS_KEY })
  })

  // Cadangan kalau stream putus: periksa ulang berkala selama tiket aktif.
  usePollWhileActive(!!live, ticket?.status === 'pending_payment' ? 4_000 : 10_000)

  if (tickets.isPending) return <Spinner />
  if (tickets.isError) {
    return (
      <main className="mx-auto max-w-md px-5 py-10">
        <Alert>{messageOf(tickets.error)}</Alert>
      </main>
    )
  }
  if (!ticket) {
    return (
      <main className="mx-auto max-w-md space-y-4 px-5 py-10">
        <h1 className="text-2xl font-bold">Tiket tidak ditemukan</h1>
        <p className="text-sm text-stone-600">Tiket yang selesai lebih dari seminggu lalu tidak ditampilkan lagi.</p>
        <Link to="/tiket" className="text-sm font-semibold underline">
          Kembali ke daftar tiket
        </Link>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-md space-y-5 px-5 py-8">
      <Link to="/tiket" className="inline-block text-sm font-semibold underline">
        Semua tiket
      </Link>
      <TicketStub ticket={ticket} showCode={ticket.status !== 'pending_payment' && ticket.status !== 'canceled'} />
      <StatusBody ticket={ticket} />
    </main>
  )
}

function StatusBody({ ticket }: { ticket: MyTicket }) {
  switch (ticket.status) {
    case 'pending_payment':
      return <PaymentPanel ticket={ticket} />

    case 'waiting':
      return (
        <section className="space-y-3 rounded-3xl border border-stone-200 bg-white p-6" aria-live="polite">
          <h2 className="text-lg font-bold">Pembayaran diterima. Anda sudah masuk antrian.</h2>
          {ticket.estimate ? (
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-stone-600">Tiket di depan Anda</dt>
                <dd className="text-3xl font-bold tabular-nums">{ticket.estimate.tickets_ahead}</dd>
              </div>
              <div>
                <dt className="text-stone-600">Perkiraan menunggu</dt>
                <dd className="font-semibold">
                  {formatWait(ticket.estimate.estimated_wait_minutes, ticket.estimate.active_kapsters)}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-stone-600">Perkiraan waktu belum tersedia.</p>
          )}
          <p className="text-sm text-stone-600">
            Halaman ini berubah sendiri saat antrian bergerak. Saat dipanggil, sebutkan kode di atas kepada kapster.
          </p>
        </section>
      )

    case 'called':
      return (
        <section className="rounded-3xl border border-emerald-300 bg-emerald-50 p-6 text-emerald-900" aria-live="assertive">
          <h2 className="text-xl font-bold">Giliran Anda</h2>
          <p className="mt-1 text-sm">Temui kapster dan sebutkan kode di tiket ini.</p>
        </section>
      )

    case 'in_progress':
      return (
        <section className="rounded-3xl border border-stone-200 bg-white p-6">
          <h2 className="text-lg font-bold">Sedang dilayani</h2>
          <p className="mt-1 text-sm text-stone-600">Setelah selesai, Anda bisa memberi penilaian di halaman ini.</p>
        </section>
      )

    case 'completed':
      return ticket.reviewed ? (
        <Alert tone="success">Terima kasih, penilaian Anda sudah kami terima.</Alert>
      ) : (
        <ReviewForm ticket={ticket} />
      )

    case 'canceled':
      return (
        <section className="space-y-3 rounded-3xl border border-stone-200 bg-white p-6">
          <h2 className="text-lg font-bold">Tiket dibatalkan</h2>
          <p className="text-sm text-stone-600">
            Pesanan yang tidak dibayar tepat waktu dibatalkan otomatis dan kuotanya dikembalikan.
          </p>
          <Link to={`/b/${ticket.outlet_slug}`} className="inline-block text-sm font-semibold underline">
            Pesan lagi di {ticket.outlet_name}
          </Link>
        </section>
      )

    default:
      return null
  }
}
