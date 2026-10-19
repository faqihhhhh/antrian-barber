import { formatWait } from '../lib/format'
import type { SessionSnapshot } from '../hooks/useQueueStream'

// Kondisi antrian hari ini. Angka besar = berapa orang menunggu sekarang.
export default function QueueNow({ today, live }: { today: SessionSnapshot | null; live: boolean }) {
  if (!today) {
    return (
      <section className="rounded-3xl border border-line bg-white p-6" aria-label="Antrian hari ini">
        <h2 className="font-semibold">Antrian hari ini</h2>
        <p className="mt-1 text-sm text-body-muted">Outlet belum membuka antrian hari ini.</p>
      </section>
    )
  }
  const closed = today.status === 'closed'
  return (
    <section className="rounded-3xl bg-ink p-6 text-white" aria-label="Antrian hari ini">
      <div className="flex items-center justify-between text-sm">
        <h2 className="font-semibold">Antrian hari ini</h2>
        {live && !closed && (
          <span className="flex items-center gap-2 text-paper-muted">
            <span aria-hidden className="h-2 w-2 rounded-full bg-emerald-400" />
            Diperbarui langsung
          </span>
        )}
        {closed && <span className="text-paper-muted">Ditutup</span>}
      </div>
      <p className="mt-4 text-7xl font-bold leading-none tabular-nums">{today.waiting_count}</p>
      <p className="mt-1 text-paper-muted">{today.waiting_count === 0 ? 'Belum ada yang menunggu' : 'orang sedang menunggu'}</p>
      {!closed && (
        <p className="mt-4 border-t border-ink-muted pt-3 text-sm text-paper-muted">
          Kalau Anda datang sekarang:{' '}
          <strong className="text-white">{formatWait(today.estimated_wait_minutes, today.active_kapsters)}</strong>
        </p>
      )}
    </section>
  )
}
