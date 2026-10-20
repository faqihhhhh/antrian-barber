import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, ApiError, messageOf } from '../api/client'
import { useMe } from '../auth/useMe'
import { Alert, Button, Spinner } from '../components/ui'
import { formatDateTime } from '../lib/format'

export default function PemilikUlasan() {
  const me = useMe()
  const [tenantChoice, setTenantChoice] = useState('')
  const owners = me.data?.memberships.filter((item) => item.roles.includes('owner')) ?? []
  const tenantID = owners.some((item) => item.tenant_id === tenantChoice) ? tenantChoice : owners[0]?.tenant_id ?? ''
  const [offset, setOffset] = useState(0)
  const summary = useQuery({
    queryKey: ['owner-review-summary', tenantID],
    enabled: !!tenantID,
    queryFn: async () => {
      const { data, error, response } = await api.GET('/v1/tenants/{tenantID}/reviews/summary', { params: { path: { tenantID } } })
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
  })
  const reviews = useQuery({
    queryKey: ['owner-reviews', tenantID, offset],
    enabled: !!tenantID,
    queryFn: async () => {
      const { data, error, response } = await api.GET('/v1/tenants/{tenantID}/reviews', { params: { path: { tenantID }, query: { limit: 20, offset } } })
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
  })

  if (me.isPending) return <Spinner />
  if (me.isError) return <main className="mx-auto max-w-md px-5 py-10"><Alert>{messageOf(me.error)}</Alert></main>
  if (!tenantID) return <main className="mx-auto max-w-md px-5 py-10"><Alert tone="info">Akun ini belum menjadi owner bisnis.</Alert></main>

  return (
    <main className="mx-auto min-h-dvh max-w-md space-y-5 bg-paper px-5 py-6">
      <header><h1 className="text-2xl font-bold">Ulasan pelanggan</h1></header>
      {owners.length > 1 && <label className="block"><span className="mb-1 block text-sm font-medium text-body">Bisnis</span><select aria-label="Bisnis" className="w-full rounded-xl border border-line-strong bg-white px-4 py-3 text-base" value={tenantID} onChange={(event) => { setTenantChoice(event.target.value); setOffset(0) }}>{owners.map((item) => <option key={item.tenant_id} value={item.tenant_id}>{item.tenant_name}</option>)}</select></label>}
      {summary.isPending ? <Spinner /> : summary.isError ? <Alert>{messageOf(summary.error)}</Alert> : (
        <section className="space-y-3" aria-label="Ringkasan rating kapster">
          <h2 className="font-bold">Rating kapster</h2>
          {summary.data.length === 0 && <Alert tone="info">Belum ada data kapster.</Alert>}
          {summary.data.map((item) => <article key={item.membership_id} className="flex items-center justify-between rounded-2xl border border-line bg-white p-4"><div><p className="font-semibold">{item.kapster_email}</p><p className="text-sm text-body-muted">{item.review_count} ulasan</p></div><strong aria-label={`Rata-rata ${item.avg_rating} dari 5`}>★ {item.avg_rating.toFixed(2)}</strong></article>)}
        </section>
      )}
      <section className="space-y-3" aria-label="Ulasan terbaru">
        <h2 className="font-bold">Ulasan terbaru</h2>
        {reviews.isPending ? <Spinner /> : reviews.isError ? <Alert>{messageOf(reviews.error)}</Alert> : reviews.data.length === 0 ? <Alert tone="info">Belum ada ulasan pelanggan.</Alert> : (
          <>
            {reviews.data.map((item) => <article key={item.id} className="space-y-2 rounded-2xl border border-line bg-white p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{item.kapster_email}</p><p className="text-xs text-muted">{formatDateTime(item.created_at)}</p></div><strong aria-label={`${item.rating} dari 5 bintang`}>{'★'.repeat(item.rating)}{'☆'.repeat(5 - item.rating)}</strong></div><p className="whitespace-pre-wrap text-sm text-body">{item.comment || 'Tanpa komentar.'}</p></article>)}
            {reviews.data.length === 20 && <Button type="button" variant="ghost" className="border border-line-strong" onClick={() => setOffset((current) => current + 20)}>Muat ulasan berikutnya</Button>}
            {offset > 0 && <Button type="button" variant="ghost" onClick={() => setOffset((current) => Math.max(0, current - 20))}>Kembali ke ulasan sebelumnya</Button>}
          </>
        )}
      </section>
    </main>
  )
}
