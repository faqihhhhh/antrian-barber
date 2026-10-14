import { formatLongDate } from '../lib/format'
import type { MyTicket } from '../hooks/useMyTickets'

// Tiket antrian bergaya karcis: nomor besar di atas, kode pencocokan di bawah,
// dipisah garis putus-putus. Dua lubang di tepi menyatu dengan warna latar halaman.
export default function TicketStub({ ticket, showCode }: { ticket: MyTicket; showCode: boolean }) {
  return (
    <section aria-label={`Tiket nomor ${ticket.ticket_number}`} className="relative overflow-hidden rounded-3xl bg-stone-900 text-white">
      <div className="px-6 pb-7 pt-6">
        <p className="text-sm text-stone-300">{ticket.outlet_name}</p>
        <p className="text-sm text-stone-400">{formatLongDate(ticket.session_date)}</p>
        <p className="mt-5 text-sm text-stone-300">Nomor antrian</p>
        <p className="text-8xl font-bold leading-none tabular-nums">{ticket.ticket_number}</p>
        {ticket.customer_name && <p className="mt-3 text-sm text-stone-300">atas nama {ticket.customer_name}</p>}
      </div>
      {showCode && ticket.match_code && (
        <div className="relative border-t-2 border-dashed border-stone-600 px-6 pb-6 pt-5">
          <span aria-hidden className="absolute -left-3 -top-3 h-6 w-6 rounded-full bg-stone-50" />
          <span aria-hidden className="absolute -right-3 -top-3 h-6 w-6 rounded-full bg-stone-50" />
          <p className="text-sm text-stone-300">Kode untuk kapster</p>
          <p className="mt-1 font-mono text-4xl font-bold tracking-[0.25em]">{ticket.match_code}</p>
        </div>
      )}
    </section>
  )
}
