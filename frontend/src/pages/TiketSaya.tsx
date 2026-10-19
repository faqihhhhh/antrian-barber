import { Link } from 'react-router'
import { Alert, Spinner } from '../components/ui'
import { messageOf } from '../api/client'
import { useMyTickets, type MyTicket } from '../hooks/useMyTickets'
import { formatLongDate, isActiveStatus, TICKET_STATUS_LABEL } from '../lib/format'
import { lastOutlet } from '../lib/storage'

export default function TiketSaya() {
  const tickets = useMyTickets(15_000)

  if (tickets.isPending) return <Spinner />
  if (tickets.isError) {
    return (
      <main className="mx-auto max-w-md px-5 py-10">
        <Alert>{messageOf(tickets.error)}</Alert>
      </main>
    )
  }

  const active = tickets.data.filter((t) => isActiveStatus(t.status))
  const history = tickets.data.filter((t) => !isActiveStatus(t.status))
  const outlet = lastOutlet()

  return (
    <main className="mx-auto max-w-md space-y-6 px-5 py-8">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">Tiket saya</h1>
        <Link to="/" className="text-sm font-semibold underline">
          Beranda
        </Link>
      </header>

      {tickets.data.length === 0 && (
        <div className="rounded-3xl border border-line bg-white p-6">
          <p className="font-semibold">Belum ada tiket</p>
          <p className="mt-1 text-sm text-body-muted">Buka tautan atau scan QR dari outlet untuk memesan antrian.</p>
          {outlet && (
            <Link to={`/b/${outlet}`} className="mt-3 inline-block text-sm font-semibold underline">
              Pesan di outlet terakhir yang Anda buka
            </Link>
          )}
        </div>
      )}

      {active.length > 0 && (
        <section className="space-y-3" aria-label="Tiket aktif">
          {active.map((t) => (
            <TicketRow key={t.ticket_id} ticket={t} highlight />
          ))}
        </section>
      )}

      {history.length > 0 && (
        <section className="space-y-3" aria-label="Riwayat">
          <h2 className="text-sm font-semibold text-body-muted">Seminggu terakhir</h2>
          {history.map((t) => (
            <TicketRow key={t.ticket_id} ticket={t} />
          ))}
        </section>
      )}
    </main>
  )
}

function TicketRow({ ticket, highlight }: { ticket: MyTicket; highlight?: boolean }) {
  return (
    <Link
      to={`/tiket/${ticket.ticket_id}`}
      className={`flex items-center gap-4 rounded-2xl border p-4 transition hover:border-ink ${
        highlight ? 'border-ink bg-white' : 'border-line bg-white text-body-muted'
      }`}
    >
      <span className="w-14 text-center text-3xl font-bold tabular-nums">{ticket.ticket_number}</span>
      <span className="min-w-0">
        <span className="block truncate font-semibold">{ticket.outlet_name}</span>
        <span className="block text-sm">{formatLongDate(ticket.session_date)}</span>
        <span className="block text-sm font-medium">{TICKET_STATUS_LABEL[ticket.status] ?? ticket.status}</span>
      </span>
    </Link>
  )
}
