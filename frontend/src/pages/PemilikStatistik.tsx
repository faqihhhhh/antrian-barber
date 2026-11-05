import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, ApiError, messageOf } from '../api/client'
import { useMe } from '../auth/useMe'
import { Alert, Spinner } from '../components/ui'
import { formatRupiah } from '../lib/format'

const RANGE_OPTIONS = [7, 30, 90] as const

function jakartaToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function shortDate(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}

function formatMinutes(value: number) {
  if (value <= 0) return 'Belum cukup data'
  return `${Math.round(value)} menit`
}

export default function PemilikStatistik() {
  const me = useMe()
  const [tenantChoice, setTenantChoice] = useState('')
  const [rangeDays, setRangeDays] = useState<(typeof RANGE_OPTIONS)[number]>(30)
  const owners = me.data?.memberships.filter((item) => item.roles.includes('owner')) ?? []
  const tenantID = owners.some((item) => item.tenant_id === tenantChoice) ? tenantChoice : owners[0]?.tenant_id ?? ''
  const to = jakartaToday()
  const from = addDays(to, 1 - rangeDays)
  const stats = useQuery({
    queryKey: ['owner-stats', tenantID, from, to],
    enabled: !!tenantID,
    queryFn: async () => {
      const { data, error, response } = await api.GET('/v1/tenants/{tenantID}/stats/overview', {
        params: { path: { tenantID }, query: { from, to } },
      })
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
  })
  const kapsters = useQuery({
    queryKey: ['owner-kapster-stats', tenantID, from, to],
    enabled: !!tenantID,
    queryFn: async () => {
      const { data, error, response } = await api.GET('/v1/tenants/{tenantID}/stats/kapsters', {
        params: { path: { tenantID }, query: { from, to } },
      })
      if (!response.ok || !data) throw new ApiError(error)
      return data.kapsters
    },
  })

  if (me.isPending) return <Spinner />
  if (me.isError) return <main className="mx-auto max-w-md px-5 py-10"><Alert>{messageOf(me.error)}</Alert></main>
  if (!tenantID) return <main className="mx-auto max-w-md px-5 py-10"><Alert tone="info">Akun ini belum menjadi owner bisnis.</Alert></main>

  return (
    <main className="mx-auto min-h-dvh max-w-5xl space-y-6 bg-paper px-5 py-6 sm:px-7 sm:py-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-body-muted">Ringkasan usaha</p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Statistik bisnis</h1>
        </div>
        <div className="flex flex-wrap gap-2" aria-label="Pilih periode statistik">
          {RANGE_OPTIONS.map((days) => (
            <button
              key={days}
              type="button"
              aria-pressed={rangeDays === days}
              className={`rounded-xl border px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${rangeDays === days ? 'border-ink bg-ink text-white' : 'border-line-strong bg-white text-body'}`}
              onClick={() => setRangeDays(days)}
            >
              {days} hari
            </button>
          ))}
        </div>
      </header>

      {owners.length > 1 && (
        <label className="block max-w-sm">
          <span className="mb-1 block text-sm font-medium text-body">Bisnis</span>
          <select aria-label="Bisnis" className="w-full rounded-xl border border-line-strong bg-white px-4 py-3 text-base" value={tenantID} onChange={(event) => setTenantChoice(event.target.value)}>
            {owners.map((item) => <option key={item.tenant_id} value={item.tenant_id}>{item.tenant_name}</option>)}
          </select>
        </label>
      )}

      {stats.isPending ? <Spinner /> : stats.isError ? <Alert>{messageOf(stats.error)}</Alert> : (
        <>
          <p className="text-sm text-body-muted">{shortDate(stats.data.from)} – {shortDate(stats.data.to)} · dibandingkan dengan periode sebelumnya</p>

          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Ringkasan kinerja bisnis">
            <Metric label="Pendapatan" value={formatRupiah(stats.data.totals.revenue_rupiah)} change={stats.data.change_pct.revenue} />
            <Metric label="Tiket selesai" value={String(stats.data.totals.tickets_completed)} change={stats.data.change_pct.customers} />
            <Metric label="Rata-rata per tiket lunas" value={formatRupiah(stats.data.totals.avg_ticket_rupiah)} />
            <Metric label="Tingkat penyelesaian" value={`${stats.data.totals.completion_pct}%`} />
          </section>

          <section className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(260px,1fr)]">
            <article className="rounded-3xl border border-line bg-white p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-lg font-bold">Tren pendapatan</h2>
                  <p className="mt-1 text-sm text-body-muted">Berdasarkan tanggal sesi dan pelunasan yang dicatat.</p>
                </div>
                <span className="text-sm text-body-muted">{stats.data.daily.length} hari aktif</span>
              </div>
              <RevenueChart days={stats.data.daily} />
            </article>

            <article className="rounded-3xl border border-line bg-white p-5 sm:p-6">
              <h2 className="text-lg font-bold">Operasional</h2>
              {stats.data.timing.tickets_measured > 0 ? (
                <>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <Metric label="Rata-rata waktu tunggu" value={formatMinutes(stats.data.timing.avg_wait_minutes)} compact />
                    <Metric label="Rata-rata durasi cukur" value={formatMinutes(stats.data.timing.avg_service_minutes)} compact />
                  </div>
                  <p className="mt-3 text-xs text-body-muted">Dihitung dari {stats.data.timing.tickets_measured} tiket selesai yang memiliki catatan waktu.</p>
                </>
              ) : <p className="mt-3 text-sm text-body-muted">Belum cukup data tiket selesai untuk menghitung waktu layanan.</p>}
              <div className="mt-5 grid grid-cols-2 gap-3 border-t border-line-soft pt-4">
                <SmallMetric label="Online" value={stats.data.totals.tickets_online} />
                <SmallMetric label="Offline" value={stats.data.totals.tickets_offline} />
                <SmallMetric label="Batal" value={stats.data.totals.tickets_canceled} />
                <SmallMetric label="DP menunggu pelunasan" value={formatRupiah(stats.data.totals.dp_unsettled_rupiah)} />
              </div>
            </article>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <article className="rounded-3xl border border-line bg-white p-5 sm:p-6">
              <h2 className="text-lg font-bold">Jam paling ramai</h2>
              <p className="mt-1 text-sm text-body-muted">Jumlah tiket yang mulai dilayani pada tiap jam.</p>
              <PeakHours hours={stats.data.peak_hours} />
            </article>

            <article className="rounded-3xl border border-line bg-white p-5 sm:p-6">
              <h2 className="text-lg font-bold">Kinerja outlet</h2>
              <p className="mt-1 text-sm text-body-muted">Pendapatan dan tiket selesai pada periode ini.</p>
              {stats.data.by_outlet.length > 0 ? (
                <div className="mt-4 divide-y divide-line-soft">
                  {stats.data.by_outlet.map((outlet) => (
                    <div key={outlet.outlet_id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3 first:pt-0 last:pb-0">
                      <p className="truncate font-semibold" title={outlet.outlet_name}>{outlet.outlet_name}</p>
                      <p className="text-right text-sm font-bold tabular-nums">{formatRupiah(outlet.totals.revenue_rupiah)}<span className="mt-1 block font-normal text-body-muted">{outlet.totals.tickets_completed} tiket selesai</span></p>
                    </div>
                  ))}
                </div>
              ) : <p className="mt-4 text-sm text-body-muted">Belum ada aktivitas pada periode ini.</p>}
            </article>
          </section>

          <section className="rounded-3xl border border-line bg-white p-5 sm:p-6" aria-labelledby="kapster-performance-title">
            <div>
              <h2 id="kapster-performance-title" className="text-lg font-bold">Performa kapster</h2>
              <p className="mt-1 text-sm text-body-muted">Layanan selesai, pendapatan tercatat, tiket dilewati, dan penilaian pelanggan.</p>
            </div>
            {kapsters.isPending ? <div className="py-6"><Spinner /></div> : kapsters.isError ? <div className="mt-4"><Alert>{messageOf(kapsters.error)}</Alert></div> : kapsters.data.length === 0 ? (
              <p className="mt-4 text-sm text-body-muted">Belum ada data kapster pada bisnis ini.</p>
            ) : (
              <div className="mt-4 grid gap-3 xl:grid-cols-2">
                {kapsters.data.map((kapster) => (
                  <article key={kapster.membership_id} className="rounded-2xl border border-line-soft bg-paper/60 p-4">
                    <h3 className="truncate font-semibold" title={kapster.kapster_email}>{kapster.kapster_email}</h3>
                    <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                      <PerformanceValue label="Layanan selesai" value={String(kapster.tickets_completed)} />
                      <PerformanceValue label="Pendapatan tercatat" value={formatRupiah(kapster.revenue_rupiah)} />
                      <PerformanceValue label="Rata-rata durasi" value={formatMinutes(kapster.avg_service_minutes)} />
                      <PerformanceValue label="Tiket dilewati" value={`${kapster.skip_count} (${kapster.skip_rate_pct}%)`} />
                      <PerformanceValue label="Penilaian" value={kapster.review_count > 0 ? `${kapster.avg_rating.toFixed(1)} / 5 · ${kapster.review_count} ulasan` : 'Belum ada ulasan'} />
                    </dl>
                  </article>
                ))}
              </div>
            )}
          </section>

          <p className="text-xs leading-relaxed text-body-muted">Pendapatan menjumlah total harga layanan yang sudah dicatat lunas, termasuk DP tiket online. DP yang sudah dibayar tetapi belum dicatat lunas ditampilkan terpisah. Perubahan dibanding periode sebelumnya memakai persentase; jika periode sebelumnya belum memiliki data, perbandingan tidak ditampilkan.</p>
        </>
      )}
    </main>
  )
}

function Metric({ label, value, change, compact = false }: { label: string; value: string; change?: number | null; compact?: boolean }) {
  return (
    <article className={`rounded-2xl border border-line bg-white ${compact ? 'p-3' : 'p-4 sm:p-5'}`}>
      <p className="text-sm text-body-muted">{label}</p>
      <p className={`mt-2 font-bold tabular-nums ${compact ? 'text-base' : 'text-lg sm:text-xl'}`}>{value}</p>
      {change !== undefined && <p className="mt-2 text-xs text-body-muted">{change === null ? 'Belum ada data pembanding' : `${change > 0 ? '+' : ''}${change}% dari periode sebelumnya`}</p>}
    </article>
  )
}

function SmallMetric({ label, value }: { label: string; value: number | string }) {
  return <div><p className="text-xs text-body-muted">{label}</p><p className="mt-1 text-sm font-semibold tabular-nums">{value}</p></div>
}

function PerformanceValue({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-body-muted">{label}</dt><dd className="mt-1 text-sm font-semibold tabular-nums">{value}</dd></div>
}

function RevenueChart({ days }: { days: { date: string; revenue_rupiah: number }[] }) {
  if (days.length === 0) return <p className="py-14 text-center text-sm text-body-muted">Belum ada data pada periode ini.</p>
  const max = Math.max(...days.map((day) => day.revenue_rupiah), 1)
  const points = days.map((day, index) => {
    const x = days.length === 1 ? 360 : 24 + (index / (days.length - 1)) * 672
    const y = 188 - (day.revenue_rupiah / max) * 150
    return { ...day, x, y }
  })
  const line = points.map((point) => `${point.x},${point.y}`).join(' ')
  const area = `24,190 ${line} 696,190`
  return (
    <div className="mt-5">
      <div className="flex justify-between text-xs text-body-muted"><span>{formatRupiah(max)}</span><span>{formatRupiah(0)}</span></div>
      <svg className="mt-2 h-44 w-full overflow-visible" viewBox="0 0 720 200" role="img" aria-label="Grafik pendapatan harian">
        <line x1="24" y1="38" x2="696" y2="38" stroke="currentColor" className="text-line" strokeDasharray="4 5" />
        <line x1="24" y1="113" x2="696" y2="113" stroke="currentColor" className="text-line" strokeDasharray="4 5" />
        <line x1="24" y1="190" x2="696" y2="190" stroke="currentColor" className="text-line" />
        <polygon points={area} className="fill-accent-soft" />
        <polyline points={line} fill="none" stroke="currentColor" className="text-accent" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((point) => <circle key={point.date} cx={point.x} cy={point.y} r="3" fill="currentColor" className="text-accent"><title>{shortDate(point.date)}: {formatRupiah(point.revenue_rupiah)}</title></circle>)}
      </svg>
      <div className="flex justify-between text-xs text-body-muted"><span>{shortDate(days[0].date)}</span><span>{shortDate(days[days.length - 1].date)}</span></div>
    </div>
  )
}

function PeakHours({ hours }: { hours: { hour: number; tickets_started: number }[] }) {
  const peak = hours.reduce((best, current) => current.tickets_started > best.tickets_started ? current : best, { hour: 0, tickets_started: 0 })
  const max = Math.max(...hours.map((item) => item.tickets_started), 1)
  return (
    <>
      {peak.tickets_started > 0 && <p className="mt-3 text-sm text-body">Puncak: <strong>{String(peak.hour).padStart(2, '0')}.00</strong> · {peak.tickets_started} tiket mulai dilayani</p>}
      <div className="mt-5 grid h-32 grid-cols-[repeat(24,minmax(0,1fr))] items-end gap-1" role="img" aria-label="Grafik jumlah tiket mulai dilayani per jam">
        {hours.map((item) => <div key={item.hour} className="flex h-full flex-col items-center justify-end gap-1" title={`${String(item.hour).padStart(2, '0')}.00 · ${item.tickets_started} tiket`}>
          <span className="w-full rounded-t bg-accent" style={{ height: `${Math.max(item.tickets_started > 0 ? 6 : 2, (item.tickets_started / max) * 100)}%` }} />
        </div>)}
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-body-muted"><span>00.00</span><span>06.00</span><span>12.00</span><span>18.00</span><span>23.00</span></div>
      {peak.tickets_started === 0 && <p className="mt-3 text-sm text-body-muted">Belum ada tiket yang mulai dilayani pada periode ini.</p>}
    </>
  )
}
