import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { api, ApiError, messageOf } from '../api/client'
import { useMe } from '../auth/useMe'
import { Alert, Spinner } from '../components/ui'
import { formatMonthYear, formatRupiah } from '../lib/format'

export default function PemilikSaaS() {
  const me = useMe()
  const stats = useQuery({
    queryKey: ['platform-stats'],
    enabled: me.data?.is_platform_admin === true,
    queryFn: async () => {
      const { data, error, response } = await api.GET('/v1/admin/stats')
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
  })

  if (me.isPending) return <Spinner />
  if (me.isError) return <main className="mx-auto max-w-3xl px-5 py-10"><Alert>{messageOf(me.error)}</Alert></main>
  if (!me.data?.is_platform_admin) {
    return <main className="mx-auto max-w-3xl space-y-4 px-5 py-10"><Alert>Akses halaman ini hanya untuk pemilik Trimwait.</Alert><Link to="/" className="text-sm font-semibold underline">Kembali ke beranda</Link></main>
  }

  return (
    <main className="mx-auto min-h-dvh max-w-5xl space-y-6 bg-paper px-5 py-6">
      <header>
        <p className="text-sm font-semibold tracking-wide text-muted">Panel platform</p>
        <h1 className="mt-1 text-2xl font-bold">Ringkasan SaaS</h1>
        <p className="mt-1 text-sm text-body-muted">Kinerja bisnis dan langganan platform.</p>
      </header>
      {stats.isPending ? <Spinner /> : stats.isError ? <Alert>{messageOf(stats.error)}</Alert> : (
        <>
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="Pendapatan langganan">
            <Metric label="MRR" value={formatRupiah(stats.data.revenue.mrr_rupiah)} hint="Pendapatan langganan bulanan aktif" dark />
            <Metric label="ARR" value={formatRupiah(stats.data.revenue.arr_rupiah)} hint="Perkiraan MRR dikali 12" />
            <Metric label="Pendapatan rata-rata per bisnis aktif" value={formatRupiah(stats.data.revenue.arpa_rupiah)} />
          </section>

          <section className="space-y-3" aria-label="Tenant dan bisnis">
            <h2 className="text-lg font-bold">Tenant dan bisnis</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Metric label="Total tenant" value={String(stats.data.tenants.total)} />
              <Metric label="Langganan aktif" value={String(stats.data.tenants.active)} />
              <Metric label="Masa tenggang" value={String(stats.data.tenants.grace)} />
              <Metric label="Mode baca saja" value={String(stats.data.tenants.read_only)} />
              <Metric label="Belum berlangganan" value={String(stats.data.tenants.never_subscribed)} />
              <Metric label="Pernah membayar" value={String(stats.data.tenants.ever_paid)} />
              <Metric label="Konversi berbayar" value={percent(stats.data.tenants.conversion_pct)} />
              <Metric label="Churn 30 hari" value={percent(stats.data.tenants.churn_rate_30d_pct)} hint={`${stats.data.tenants.churned_30d} tenant berhenti`} />
            </div>
            <p className="text-sm text-body-muted">{stats.data.tenants.outlets} outlet · {stats.data.tenants.staff} staf · {stats.data.tenants.users} pengguna · {stats.data.tenants.onboarding_completed} bisnis menyelesaikan penyiapan</p>
          </section>

          <section className="grid gap-3 sm:grid-cols-2" aria-label="Tagihan dan aktivitas">
            <article className="rounded-2xl border border-line bg-white p-4">
              <h2 className="font-bold">Tagihan</h2>
              <p className="mt-3 text-sm text-body">Menunggu konfirmasi: <strong>{stats.data.billing.pending_invoices}</strong> · {formatRupiah(stats.data.billing.pending_amount_rupiah)}</p>
              <p className="mt-2 text-sm text-body">Jatuh tempo 7 hari: <strong>{stats.data.billing.expiring_7d}</strong> · {formatRupiah(stats.data.billing.expiring_7d_rupiah)}</p>
            </article>
            <article className="rounded-2xl border border-line bg-white p-4">
              <h2 className="font-bold">Aktivitas 30 hari</h2>
              <p className="mt-3 text-sm text-body">Outlet aktif: <strong>{stats.data.activity_30d.active_outlets}</strong></p>
              <p className="mt-2 text-sm text-body">Antrean selesai: <strong>{stats.data.activity_30d.tickets_completed}</strong></p>
              <p className="mt-2 text-sm text-body">Nilai transaksi DP: <strong>{formatRupiah(stats.data.activity_30d.gmv_rupiah)}</strong></p>
            </article>
          </section>

          <section className="space-y-3" aria-label="Tren bulanan">
            <h2 className="text-lg font-bold">Tren 12 bulan</h2>
            <div className="overflow-x-auto rounded-2xl border border-line bg-white">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead className="border-b border-line bg-paper-raised text-body-muted"><tr><th className="px-4 py-3 font-semibold">Bulan</th><th className="px-4 py-3 font-semibold">Tenant baru</th><th className="px-4 py-3 font-semibold">Tagihan lunas</th><th className="px-4 py-3 text-right font-semibold">Pendapatan</th></tr></thead>
                <tbody>{stats.data.monthly.map((month) => <tr key={month.month} className="border-b border-line-soft last:border-0"><td className="px-4 py-3">{formatMonthYear(`${month.month}-01`)}</td><td className="px-4 py-3">{month.tenants_created}</td><td className="px-4 py-3">{month.invoices_paid}</td><td className="px-4 py-3 text-right tabular-nums">{formatRupiah(month.revenue_rupiah)}</td></tr>)}</tbody>
              </table>
            </div>
          </section>
          <p className="text-xs text-muted">MRR dan ARR dihitung dari langganan aktif. Pendapatan bulanan berasal dari tagihan yang lunas.</p>
        </>
      )}
    </main>
  )
}

function Metric({ label, value, hint, dark = false }: { label: string; value: string; hint?: string; dark?: boolean }) {
  return <article className={`rounded-2xl border p-4 ${dark ? 'border-ink bg-ink text-white' : 'border-line bg-white'}`}><p className={`text-sm ${dark ? 'text-paper-muted' : 'text-body-muted'}`}>{label}</p><p className="mt-2 text-xl font-bold tabular-nums">{value}</p>{hint && <p className={`mt-1 text-xs ${dark ? 'text-paper-muted' : 'text-muted'}`}>{hint}</p>}</article>
}

function percent(value: number | null): string {
  return value === null ? '—' : `${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(value)}%`
}
