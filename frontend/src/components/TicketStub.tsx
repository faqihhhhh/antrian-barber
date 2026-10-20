import { formatLongDate, timezoneLabel } from '../lib/format'
import type { MyTicket } from '../hooks/useMyTickets'

// Tiket antrian bergaya karcis: nomor besar di atas, kode pencocokan di bawah,
// dipisah garis putus-putus. Dua lubang di tepi menyatu dengan warna latar halaman.
export default function TicketStub({ ticket, showCode }: { ticket: MyTicket; showCode: boolean }) {
  const called = ticket.status === 'called'
  return (
    <section aria-label={`Tiket nomor ${ticket.ticket_number}`} className={`relative overflow-hidden rounded-3xl text-white ${called ? 'bg-emerald-800' : 'bg-ink'}`}>
      <div className="px-5 pb-5 pt-4 sm:px-6 sm:pb-7 sm:pt-6">
        <p className="text-sm text-white/90">{ticket.outlet_name}</p>
        <p className="text-sm text-white/80">{formatLongDate(ticket.session_date)} · {timezoneLabel(ticket.outlet_timezone)}</p>
        <p className="mt-4 text-sm text-paper-muted sm:mt-5">Nomor antrian</p>
        <p className="text-7xl font-bold leading-none tabular-nums sm:text-8xl">{ticket.ticket_number}</p>
        {ticket.customer_name && <p className="mt-2 text-sm text-white/90 sm:mt-3">atas nama {ticket.customer_name}</p>}
      </div>
      {showCode && ticket.match_code && (
        <div className={`relative border-t-2 border-dashed px-5 pb-5 pt-4 sm:px-6 sm:pb-6 sm:pt-5 ${called ? 'border-white/40' : 'border-ink-muted'}`}>
          <span aria-hidden className="absolute -left-3 -top-3 h-6 w-6 rounded-full bg-paper" />
          <span aria-hidden className="absolute -right-3 -top-3 h-6 w-6 rounded-full bg-paper" />
          <p className="text-sm text-white/90">{called ? 'Giliran Anda! Tunjukkan kode untuk kapster' : 'Kode untuk kapster'}</p>
          <p className="mt-1 font-mono text-3xl font-bold tracking-[0.25em] sm:text-4xl">{ticket.match_code}</p>
        </div>
      )}
    </section>
  )
}
