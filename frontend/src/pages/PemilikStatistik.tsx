import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, ApiError, messageOf } from '../api/client'
import { useMe } from '../auth/useMe'
import { Alert, Spinner } from '../components/ui'
import { formatRupiah } from '../lib/format'

export default function PemilikStatistik() {
  const me = useMe()
  const [tenantChoice, setTenantChoice] = useState('')
  const owners = me.data?.memberships.filter((item) => item.roles.includes('owner')) ?? []
  const tenantID = owners.some((item) => item.tenant_id === tenantChoice) ? tenantChoice : owners[0]?.tenant_id ?? ''
  const stats = useQuery({
    queryKey: ['owner-stats', tenantID],
    enabled: !!tenantID,
    queryFn: async () => {
      const { data, error, response } = await api.GET('/v1/tenants/{tenantID}/stats/overview', {
        params: { path: { tenantID } },
      })
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
  })

  if (me.isPending) return <Spinner />
  if (me.isError) return <main className="mx-auto max-w-md px-5 py-10"><Alert>{messageOf(me.error)}</Alert></main>
  if (!tenantID) return <main className="mx-auto max-w-md px-5 py-10"><Alert tone="info">Akun ini belum menjadi owner bisnis.</Alert></main>

  return (
    <main className="mx-auto min-h-dvh max-w-md space-y-5 bg-paper px-5 py-6">
      <header>
        <h1 className="text-2xl font-bold">Statistik bisnis</h1>
      </header>
      {owners.length > 1 && <label className="block"><span className="mb-1 block text-sm font-medium text-body">Bisnis</span><select aria-label="Bisnis" className="w-full rounded-xl border border-line-strong bg-white px-4 py-3 text-base" value={tenantID} onChange={(event) => setTenantChoice(event.target.value)}>{owners.map((item) => <option key={item.tenant_id} value={item.tenant_id}>{item.tenant_name}</option>)}</select></label>}
      {stats.isPending ? <Spinner /> : stats.isError ? <Alert>{messageOf(stats.error)}</Alert> : (
        <>
          <p className="text-sm text-body-muted">30 hari terakhir: {stats.data.from} – {stats.data.to}</p>
          <section className="grid grid-cols-2 gap-3" aria-label="Ringkasan 30 hari terakhir">
            <Metric label="Total tiket" value={String(stats.data.totals.tickets_total)} />
            <Metric label="Tiket selesai" value={String(stats.data.totals.tickets_completed)} />
            <Metric label="Pendapatan DP" value={formatRupiah(stats.data.totals.revenue_rupiah)} />
            <Metric label="DP belum lunas" value={formatRupiah(stats.data.totals.dp_unsettled_rupiah)} />
            <Metric label="Rata-rata per tiket lunas" value={formatRupiah(stats.data.totals.avg_ticket_rupiah)} />
            <Metric label="Tingkat penyelesaian" value={`${stats.data.totals.completion_pct}%`} />
          </section>
          <p className="text-xs text-muted">Pendapatan dihitung dari DP yang sudah lunas, termasuk tiket yang belum selesai.</p>
        </>
      )}
    </main>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return <article className="rounded-2xl border border-line bg-white p-4"><p className="text-sm text-body-muted">{label}</p><p className="mt-2 text-lg font-bold">{value}</p></article>
}
