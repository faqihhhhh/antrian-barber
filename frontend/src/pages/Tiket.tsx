import { useEffect, useRef } from 'react'
import { Link, useParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { messageOf } from '../api/client'
import PaymentPanel from '../components/PaymentPanel'
import ReviewForm from '../components/ReviewForm'
import TicketStub from '../components/TicketStub'
import { Alert, Button, Spinner } from '../components/ui'
import { MY_TICKETS_KEY, useMyTickets, type MyTicket } from '../hooks/useMyTickets'
import { useQueueStream } from '../hooks/useQueueStream'
import { formatWait, isActiveStatus } from '../lib/format'
import { usePollWhileActive } from '../hooks/usePollWhileActive'
import PushPrompt from '../components/PushPrompt'

export default function Tiket() {
  const { ticketId } = useParams()
  const queryClient = useQueryClient()
  // Lebih sering diperiksa saat menunggu pembayaran (status berubah begitu admin/Midtrans mengonfirmasi).
  const tickets = useMyTickets(false)
  const ticket = tickets.data?.find((t) => t.ticket_id === ticketId)
  const live = ticket && isActiveStatus(ticket.status)
  const activeTicketID = ticket?.ticket_id
  const activeTicketStatus = ticket?.status
  const activeTicketNumber = ticket?.ticket_number

  // Antrian bergerak -> ambil ulang tiket ini. Pembaruan realtime dari server,
  // tanpa menunggu polling.
  const stream = useQueueStream(live ? ticket.session_id : null, () => {
    queryClient.invalidateQueries({ queryKey: MY_TICKETS_KEY })
  }, () => {
    queryClient.invalidateQueries({ queryKey: MY_TICKETS_KEY })
  })

  // Cadangan kalau stream putus: periksa ulang berkala selama tiket aktif.
  usePollWhileActive(!!live, ticket?.status === 'pending_payment' ? 4_000 : 10_000)

  const calledTicketID = useRef<string | null>(null)
  useEffect(() => {
    if (!activeTicketID || activeTicketStatus !== 'called' || calledTicketID.current === activeTicketID) return
    calledTicketID.current = activeTicketID
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.(180)
  }, [activeTicketID, activeTicketStatus])

  useEffect(() => {
    if (!activeTicketID || activeTicketStatus !== 'called') return
    const originalTitle = document.title
    const message = `Giliran Anda · Tiket #${activeTicketNumber}`
    let timer = 0
    const updateTitle = () => {
      if (document.visibilityState === 'hidden') {
        document.title = document.title === message ? originalTitle : message
      } else {
        document.title = originalTitle
      }
    }
    timer = window.setInterval(updateTitle, 1200)
    document.addEventListener('visibilitychange', updateTitle)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', updateTitle)
      document.title = originalTitle
    }
  }, [activeTicketID, activeTicketStatus, activeTicketNumber])

  if (tickets.isPending) return <Spinner />
  if (tickets.isError) {
    return (
      <main className="mx-auto max-w-md px-5 py-10">
        <Alert>{messageOf(tickets.error)}</Alert>
        <Button type="button" variant="secondary" onClick={() => void tickets.refetch()}>Coba lagi</Button>
      </main>
    )
  }
  if (!ticket) {
    return (
      <main className="mx-auto max-w-md space-y-4 px-5 py-10">
        <h1 className="text-2xl font-bold">Tiket tidak ditemukan</h1>
        <p className="text-sm text-body-muted">Tiket yang selesai lebih dari seminggu lalu tidak ditampilkan lagi.</p>
        <Link to="/tiket" className="text-sm font-semibold underline">
          Kembali ke daftar tiket
        </Link>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-md space-y-5 px-5 py-8">
      <div className="flex items-center justify-between gap-3">
      <Link to="/tiket" className="inline-flex min-h-11 items-center text-sm font-semibold underline">
        Semua tiket
      </Link>
      {live && <span className="flex items-center gap-2 text-xs text-body-muted" role="status">
        <span aria-hidden className={`h-2 w-2 rounded-full ${stream.connected ? 'bg-emerald-600' : 'bg-amber-700'}`} />
        {stream.connected ? 'Terhubung langsung' : 'Menyambungkan ulang…'}
      </span>}
      </div>
      <TicketStub ticket={ticket} showCode={ticket.status !== 'pending_payment' && ticket.status !== 'canceled'} />
      <StatusStepper status={ticket.status} />
      {ticket.status === 'waiting' && <PushPrompt />}
      <StatusBody ticket={ticket} />
    </main>
  )
}

function StatusStepper({ status }: { status: string }) {
  if (status === 'canceled') return <p className="rounded-xl border border-line bg-white px-4 py-3 text-sm font-semibold">Tiket dibatalkan</p>
  const steps = [
    ['pending_payment', 'Bayar DP'],
    ['waiting', 'Dalam antrian'],
    ['called', 'Dipanggil'],
    ['in_progress', 'Sedang dilayani'],
    ['completed', 'Selesai'],
  ] as const
  const current = steps.findIndex(([key]) => key === status)
  return (
    <ol aria-label="Tahapan tiket" className="grid grid-cols-5 gap-1">
      {steps.map(([key, label], index) => (
        <li key={key} className={`border-t-2 pt-2 text-center text-xs leading-tight ${index <= current ? 'border-brand text-brand-ink' : 'border-line text-muted'}`} aria-current={index === current ? 'step' : undefined}>
          <span className="block font-bold">{index < current ? '✓' : index + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  )
}

function StatusBody({ ticket }: { ticket: MyTicket }) {
  switch (ticket.status) {
    case 'pending_payment':
      return <PaymentPanel ticket={ticket} />

    case 'waiting':
      return (
        <section className="space-y-3 rounded-3xl border border-line bg-white p-6" aria-live="polite">
          <h2 className="text-lg font-bold">Pembayaran diterima. Anda sudah masuk antrian.</h2>
          {ticket.estimate ? (
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-body-muted">Orang di depan Anda</dt>
                <dd className="text-3xl font-bold tabular-nums">{ticket.estimate.tickets_ahead}</dd>
              </div>
              <div>
                <dt className="text-body-muted">Perkiraan menunggu</dt>
                <dd className="font-semibold">
                  {formatWait(ticket.estimate.estimated_wait_minutes, ticket.estimate.active_kapsters)}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-body-muted">Perkiraan waktu belum tersedia.</p>
          )}
          <p className="text-sm text-body-muted">
            Halaman ini berubah sendiri saat antrian bergerak. Saat dipanggil, sebutkan kode di atas kepada kapster.
          </p>
        </section>
      )

    case 'called':
      return (
        <section className="rounded-3xl border border-emerald-300 bg-emerald-50 p-6 text-emerald-900" aria-live="assertive">
          <h2 className="text-3xl font-extrabold">Giliran Anda!</h2>
          <p className="mt-1 text-base">Tunjukkan kode pada tiket ini ke kapster.</p>
        </section>
      )

    case 'in_progress':
      return (
        <section className="rounded-3xl border border-line bg-white p-6">
          <h2 className="text-lg font-bold">Sedang dilayani</h2>
          <p className="mt-1 text-sm text-body-muted">Setelah selesai, Anda bisa memberi penilaian di halaman ini.</p>
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
        <section className="space-y-3 rounded-3xl border border-line bg-white p-6">
          <h2 className="text-lg font-bold">Tiket dibatalkan</h2>
          <p className="text-sm text-body-muted">
            Pesanan yang tidak dibayar tepat waktu dibatalkan otomatis dan kuotanya dikembalikan.
          </p>
          <Link to={`/o/${ticket.outlet_slug}`} className="inline-block text-sm font-semibold underline">
            Pesan lagi di {ticket.outlet_name}
          </Link>
        </section>
      )

    default:
      return null
  }
}
