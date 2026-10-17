import { useState } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { api, ApiError, messageOf } from '../api/client'
import { useMe } from '../auth/useMe'
import { Alert, Spinner } from '../components/ui'
import type { components } from '../api/schema'
import { formatDateTime, formatRupiah } from '../lib/format'

type Invoice = components['schemas']['OwnerInvoice']
type Subscription = components['schemas']['OwnerSubscription']
const statusLabel: Record<string, string> = { belum_berlangganan: 'Belum berlangganan', aktif: 'Aktif', masa_tenggang: 'Masa tenggang', baca_saja: 'Baca saja' }
const invoiceLabel: Record<string, string> = { pending: 'Menunggu konfirmasi', paid: 'Lunas', expired: 'Kedaluwarsa', canceled: 'Dibatalkan' }

export default function PemilikLangganan() {
  const me = useMe()
  const [tenantChoice, setTenantChoice] = useState('')
  const owners = me.data?.memberships.filter((item) => item.roles.includes('owner')) ?? []
  const tenantID = owners.some((item) => item.tenant_id === tenantChoice) ? tenantChoice : owners[0]?.tenant_id ?? ''
  const subscription = useQuery({
    queryKey: ['owner-subscription', tenantID],
    enabled: !!tenantID,
    queryFn: async (): Promise<Subscription> => {
      const { data, error, response } = await api.GET('/v1/tenants/{tenantID}/subscription', { params: { path: { tenantID } } })
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
  })
  const invoices = useQuery({
    queryKey: ['owner-invoices', tenantID],
    enabled: !!tenantID,
    queryFn: async (): Promise<Invoice[]> => {
      const { data, error, response } = await api.GET('/v1/tenants/{tenantID}/invoices', { params: { path: { tenantID } } })
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
  })

  if (me.isPending) return <Spinner />
  if (me.isError) return <main className="mx-auto max-w-md px-5 py-10"><Alert>{messageOf(me.error)}</Alert></main>
  if (!tenantID) return <main className="mx-auto max-w-md px-5 py-10"><Alert tone="info">Akun ini belum menjadi owner bisnis.</Alert></main>

  return (
    <main className="mx-auto min-h-dvh max-w-md space-y-5 bg-stone-50 px-5 py-6">
      <header className="flex items-start justify-between gap-4"><div><p className="text-sm font-semibold tracking-wide text-stone-500">KAPSFLOW</p><h1 className="mt-1 text-2xl font-bold">Langganan</h1></div><Link to="/pemilik" className="pt-1 text-sm font-semibold underline">Pengaturan outlet</Link></header>
      {owners.length > 1 && <label className="block"><span className="mb-1 block text-sm font-medium text-stone-700">Bisnis</span><select aria-label="Bisnis" className="w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-base" value={tenantID} onChange={(event) => setTenantChoice(event.target.value)}>{owners.map((item) => <option key={item.tenant_id} value={item.tenant_id}>{item.tenant_name}</option>)}</select></label>}
      {subscription.isPending ? <Spinner /> : subscription.isError ? <Alert>{messageOf(subscription.error)}</Alert> : (
        <article className="rounded-3xl border border-stone-200 bg-white p-5"><h2 className="font-bold">Status bisnis</h2><p className="mt-2">Langganan: <strong>{statusLabel[subscription.data.status] ?? subscription.data.status}</strong></p>{subscription.data.plan_code && <p className="mt-1 text-sm text-stone-600">Paket: {subscription.data.plan_code}</p>}{subscription.data.current_period_end && <p className="mt-1 text-sm text-stone-600">Periode berakhir: {formatDateTime(subscription.data.current_period_end)}</p>}</article>
      )}
      <section className="space-y-3"><h2 className="font-bold">Riwayat tagihan</h2>{invoices.isPending ? <Spinner /> : invoices.isError ? <Alert>{messageOf(invoices.error)}</Alert> : invoices.data.length === 0 ? <Alert tone="info">Belum ada tagihan.</Alert> : invoices.data.map((invoice) => <article key={invoice.id} className="space-y-1 rounded-2xl border border-stone-200 bg-white p-4"><div className="flex items-start justify-between gap-3"><strong>{formatRupiah(invoice.amount_rupiah)}</strong><span className="text-right text-sm">{invoiceLabel[invoice.status] ?? invoice.status}</span></div><p className="text-sm text-stone-600">Dibuat: {formatDateTime(invoice.created_at)}</p>{invoice.expires_at && <p className="text-sm text-stone-600">Batas tagihan: {formatDateTime(invoice.expires_at)}</p>}{invoice.paid_at && <p className="text-sm text-stone-600">Dibayar: {formatDateTime(invoice.paid_at)}</p>}{invoice.period_start && invoice.period_end ? <p className="text-sm text-stone-600">Periode langganan: {formatDateTime(invoice.period_start)} – {formatDateTime(invoice.period_end)}</p> : invoice.status === 'paid' && <p className="text-sm text-stone-500">Periode invoice lama belum tercatat.</p>}<p className="break-all text-xs text-stone-400">ID tagihan: {invoice.id}</p></article>)}</section>
      <p className="text-xs text-stone-500">Pembayaran langganan saat ini diproses manual dan dikonfirmasi oleh pemilik Kapsflow.</p>
    </main>
  )
}
