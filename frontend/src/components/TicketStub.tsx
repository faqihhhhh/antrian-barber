import { formatLongDate, timezoneLabel } from '../lib/format'
import type { MyTicket } from '../hooks/useMyTickets'

// Tiket antrian bergaya karcis: nomor besar di atas, kode pencocokan di bawah,
// dipisah garis putus-putus. Dua lubang di tepi menyatu dengan warna latar halaman.
export default function TicketStub({ ticket, showCode }: { ticket: MyTicket; showCode: boolean }) {
  const called = ticket.status === 'called'
  return (
    <section aria-label={`Tiket nomor ${ticket.ticket_number}`} className={`relative overflow-hidden rounded-3xl text-white ${called ? 'bg-brand' : 'bg-ink'}`}>
      <div className="px-6 pb-7 pt-6">
        <p className="text-sm text-white/90">{ticket.outlet_name}</p>
        <p className="text-sm text-white/80">{formatLongDate(ticket.session_date)} · {timezoneLabel(ticket.outlet_timezone)}</p>
        <p className="mt-5 text-sm text-paper-muted">Nomor antrian</p>
        <p className="text-8xl font-bold leading-none tabular-nums">{ticket.ticket_number}</p>
        {ticket.customer_name && <p className="mt-3 text-sm text-white/90">atas nama {ticket.customer_name}</p>}
      </div>
      {showCode && ticket.match_code && (
        <div className={`relative border-t-2 border-dashed px-6 pb-6 pt-5 ${called ? 'border-white/40' : 'border-ink-muted'}`}>
          <span aria-hidden className="absolute -left-3 -top-3 h-6 w-6 rounded-full bg-paper" />
          <span aria-hidden className="absolute -right-3 -top-3 h-6 w-6 rounded-full bg-paper" />
          <p className="text-sm text-white/90">{called ? 'Giliran Anda! Tunjukkan kode ini ke kapster' : 'Kode untuk kapster'}</p>
          <p className="mt-1 font-mono text-4xl font-bold tracking-[0.25em]">{ticket.match_code}</p>
        </div>
      )}
    </section>
  )
}
