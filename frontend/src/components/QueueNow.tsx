import { formatWait } from '../lib/format'
import type { SessionSnapshot } from '../hooks/useQueueStream'

// Kondisi antrian hari ini. Angka besar = berapa orang menunggu sekarang.
export default function QueueNow({ today, live }: { today: SessionSnapshot | null; live: boolean }) {
  if (!today) {
    return (
      <section className="rounded-3xl border border-stone-200 bg-white p-6" aria-label="Antrian hari ini">
        <h2 className="font-semibold">Antrian hari ini</h2>
        <p className="mt-1 text-sm text-stone-600">Outlet belum membuka antrian hari ini.</p>
      </section>
    )
  }
  const closed = today.status === 'closed'
  return (
    <section className="rounded-3xl bg-stone-900 p-6 text-white" aria-label="Antrian hari ini">
      <div className="flex items-center justify-between text-sm">
        <h2 className="font-semibold">Antrian hari ini</h2>
        {live && !closed && (
          <span className="flex items-center gap-2 text-stone-300">
            <span aria-hidden className="h-2 w-2 rounded-full bg-emerald-400" />
            Diperbarui langsung
          </span>
        )}
        {closed && <span className="text-stone-300">Ditutup</span>}
      </div>
      <p className="mt-4 text-7xl font-bold leading-none tabular-nums">{today.waiting_count}</p>
      <p className="mt-1 text-stone-300">{today.waiting_count === 0 ? 'Belum ada yang menunggu' : 'orang sedang menunggu'}</p>
      {!closed && (
        <p className="mt-4 border-t border-stone-700 pt-3 text-sm text-stone-300">
          Kalau Anda datang sekarang:{' '}
          <strong className="text-white">{formatWait(today.estimated_wait_minutes, today.active_kapsters)}</strong>
        </p>
      )}
    </section>
  )
}
