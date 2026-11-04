import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, messageOf } from '../api/client'
import { useMe } from '../auth/useMe'
import { Alert, Spinner } from '../components/ui'
import type { components } from '../api/schema'
import { formatDateTime, formatRupiah } from '../lib/format'
import { useNow } from '../hooks/useNow'

type Invoice = components['schemas']['OwnerInvoice']
type Subscription = components['schemas']['OwnerSubscription']
type Plan = components['schemas']['PublicPlan']
type PaymentOptions = components['schemas']['PaymentOptions']
const statusLabel: Record<string, string> = { belum_berlangganan: 'Belum berlangganan', aktif: 'Aktif', masa_tenggang: 'Masa tenggang', baca_saja: 'Baca saja' }
const invoiceLabel: Record<string, string> = { pending: 'Menunggu pembayaran', paid: 'Lunas', expired: 'Kedaluwarsa', canceled: 'Dibatalkan' }

export default function PemilikLangganan() {
  const me = useMe()
  const now = useNow(60_000)
  const queryClient = useQueryClient()
  const [tenantChoice, setTenantChoice] = useState('')
  const [planCode, setPlanCode] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<'manual' | 'midtrans' | ''>('')
  const owners = me.data?.memberships.filter((item) => item.roles.includes('owner')) ?? []
  const tenantID = owners.some((item) => item.tenant_id === tenantChoice) ? tenantChoice : owners[0]?.tenant_id ?? ''
  const subscription = useQuery({
    queryKey: ['owner-subscription', tenantID],
    enabled: !!tenantID,
    refetchInterval: (query) => {
      const end = query.state.data?.current_period_end
      if (query.state.data?.status !== 'aktif' || !end) return 15_000
      return new Date(end).getTime() - Date.now() <= 7 * 24 * 60 * 60 * 1000 ? 15_000 : false
    },
    queryFn: async (): Promise<Subscription> => {
      const { data, error, response } = await api.GET('/v1/tenants/{tenantID}/subscription', { params: { path: { tenantID } } })
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
  })
  const invoices = useQuery({
    queryKey: ['owner-invoices', tenantID],
    enabled: !!tenantID,
    refetchInterval: (query) => query.state.data?.some((invoice) => invoice.status === 'pending') ? 10_000 : false,
    queryFn: async (): Promise<Invoice[]> => {
      const { data, error, response } = await api.GET('/v1/tenants/{tenantID}/invoices', { params: { path: { tenantID } } })
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
  })
  const plans = useQuery({
    queryKey: ['plans'],
    queryFn: async (): Promise<Plan[]> => {
      const { data, error, response } = await api.GET('/v1/plans/')
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
  })
  const paymentOptions = useQuery({
    queryKey: ['owner-subscription-payment-options', tenantID],
    enabled: !!tenantID,
    queryFn: async (): Promise<PaymentOptions> => {
      const { data, error, response } = await api.GET('/v1/tenants/{tenantID}/subscription/payment-options', { params: { path: { tenantID } } })
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
  })
  const selectedPlanCode = planCode || plans.data?.[0]?.code || ''
  const selectedPaymentMethod = paymentMethod || (paymentOptions.data?.manual_qris_configured || paymentOptions.data?.manual_transfer_configured ? 'manual' : 'midtrans')
  const manualAvailable = !!(paymentOptions.data?.manual_qris_configured || paymentOptions.data?.manual_transfer_configured)
  const createInvoice = useMutation({
    mutationFn: async () => {
      const { data, error, response } = await api.POST('/v1/tenants/{tenantID}/subscribe', {
        params: { path: { tenantID } }, body: { plan_code: selectedPlanCode, payment_method: selectedPaymentMethod },
      })
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['owner-invoices', tenantID] }),
        queryClient.invalidateQueries({ queryKey: ['owner-subscription', tenantID] }),
      ])
    },
  })
  const hasPendingInvoice = invoices.data?.some((invoice) => invoice.status === 'pending') ?? false
  const canCreateInvoice = subscription.data?.status !== 'aktif' || !subscription.data.current_period_end ||
    new Date(subscription.data.current_period_end).getTime() - now <= 7 * 24 * 60 * 60 * 1000

  if (me.isPending) return <Spinner />
  if (me.isError) return <main className="mx-auto max-w-md px-5 py-10"><Alert>{messageOf(me.error)}</Alert></main>
  if (!tenantID) return <main className="mx-auto max-w-md px-5 py-10"><Alert tone="info">Akun ini belum menjadi owner bisnis.</Alert></main>

  return (
    <main className="mx-auto min-h-dvh max-w-md space-y-5 bg-paper px-5 py-6">
      <header><h1 className="text-2xl font-bold">Langganan</h1></header>
      {owners.length > 1 && <label className="block"><span className="mb-1 block text-sm font-medium text-body">Bisnis</span><select aria-label="Bisnis" className="w-full rounded-xl border border-line-strong bg-white px-4 py-3 text-base" value={tenantID} onChange={(event) => setTenantChoice(event.target.value)}>{owners.map((item) => <option key={item.tenant_id} value={item.tenant_id}>{item.tenant_name}</option>)}</select></label>}
      {subscription.isPending ? <Spinner /> : subscription.isError ? <Alert>{messageOf(subscription.error)}</Alert> : (
        <article className="rounded-3xl border border-line bg-white p-5"><h2 className="font-bold">Status bisnis</h2><p className="mt-2">Langganan: <strong>{statusLabel[subscription.data.status] ?? subscription.data.status}</strong></p>{subscription.data.plan_code && <p className="mt-1 text-sm text-body-muted">Paket: {subscription.data.plan_code}</p>}{subscription.data.current_period_end && <p className="mt-1 text-sm text-body-muted">Periode berakhir: {formatDateTime(subscription.data.current_period_end)}</p>}</article>
      )}
      <section className="space-y-3 rounded-3xl border border-line bg-white p-5">
        <h2 className="font-bold">Buat tagihan langganan</h2>
        {plans.isPending || paymentOptions.isPending ? <Spinner /> : plans.isError ? <Alert>{messageOf(plans.error)}</Alert> : paymentOptions.isError ? <Alert>{messageOf(paymentOptions.error)}</Alert> : plans.data.length === 0 ? <Alert tone="info">Belum ada paket yang tersedia.</Alert> : (
          <>
            <label className="block"><span className="mb-1 block text-sm font-medium text-body">Pilih paket</span><select aria-label="Pilih paket" className="w-full rounded-xl border border-line-strong bg-white px-4 py-3 text-base" value={selectedPlanCode} onChange={(event) => setPlanCode(event.target.value)}>{plans.data.map((plan) => <option key={plan.code} value={plan.code}>{plan.name} · {formatRupiah(plan.price_rupiah)} / {plan.billing_interval === 'yearly' ? 'tahun' : 'bulan'}</option>)}</select></label>
            <fieldset className="space-y-2"><legend className="mb-1 text-sm font-medium text-body">Cara bayar</legend>
              {manualAvailable && <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3"><input type="radio" name="payment-method" value="manual" checked={selectedPaymentMethod === 'manual'} onChange={() => setPaymentMethod('manual')} /><span><strong className="block text-sm">QRIS atau transfer manual</strong><span className="text-xs text-body-muted">Pilih salah satu tujuan pada instruksi tagihan. Pemilik Trimwait memeriksa pembayaran sebelum mengaktifkan langganan.</span></span></label>}
              {paymentOptions.data.midtrans_configured && <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3"><input type="radio" name="payment-method" value="midtrans" checked={selectedPaymentMethod === 'midtrans'} onChange={() => setPaymentMethod('midtrans')} /><span><strong className="block text-sm">QRIS otomatis</strong><span className="text-xs text-body-muted">Langganan aktif otomatis setelah pembayaran diterima.</span></span></label>}
              {!manualAvailable && !paymentOptions.data.midtrans_configured && <Alert tone="info">Pembayaran langganan belum disiapkan. Hubungi pemilik Trimwait.</Alert>}
            </fieldset>
            {hasPendingInvoice ? <Alert tone="info">Masih ada tagihan yang menunggu pembayaran atau verifikasi. Selesaikan tagihan itu sebelum membuat yang baru.</Alert> : !canCreateInvoice ? <Alert tone="info">Tagihan perpanjangan baru bisa dibuat dalam 7 hari sebelum periode berakhir.</Alert> : <button className="w-full rounded-xl bg-ink px-4 py-3 font-semibold text-white disabled:opacity-50" disabled={!selectedPlanCode || (!manualAvailable && !paymentOptions.data.midtrans_configured) || createInvoice.isPending || invoices.isPending} onClick={() => createInvoice.mutate()}>{createInvoice.isPending ? 'Membuat tagihan…' : 'Buat tagihan'}</button>}
            {invoices.isError && <Alert>{messageOf(invoices.error)}</Alert>}
            {createInvoice.isError && <Alert>{messageOf(createInvoice.error)}</Alert>}
            {createInvoice.isSuccess && <Alert tone="success">Tagihan dibuat. Lihat nominal dan batas pembayarannya di Riwayat tagihan.</Alert>}
          </>
        )}
      </section>
      <section className="space-y-3"><h2 className="font-bold">Riwayat tagihan</h2>{invoices.isPending ? <Spinner /> : invoices.isError ? <Alert>{messageOf(invoices.error)}</Alert> : invoices.data.length === 0 ? <Alert tone="info">Belum ada tagihan.</Alert> : invoices.data.map((invoice) => <article key={invoice.id} className="space-y-2 rounded-2xl border border-line bg-white p-4"><div className="flex items-start justify-between gap-3"><strong>{formatRupiah(invoice.amount_rupiah)}</strong><span className="text-right text-sm">{invoice.status === 'pending' && invoice.payment_method === 'manual' ? 'Menunggu pembayaran dan verifikasi' : invoiceLabel[invoice.status] ?? invoice.status}</span></div><p className="text-sm text-body-muted">Metode: {invoice.payment_method === 'manual' ? 'QRIS atau transfer manual' : 'QRIS otomatis'}</p>{invoice.payment_method === 'manual' && invoice.status === 'pending' && <div className="space-y-3 rounded-xl bg-paper p-4"><p className="text-sm font-semibold">Bayar tepat sesuai nominal tagihan</p>{paymentOptions.data?.manual_qris_configured && <div className="space-y-2 text-center"><p className="text-sm">QRIS</p><img src={`/v1/tenants/${tenantID}/subscription/manual-qris`} alt="QRIS pembayaran langganan Trimwait" className="mx-auto size-56 object-contain" /></div>}{paymentOptions.data?.manual_transfer_configured && <div className="space-y-2 border-t border-line pt-3"><p className="text-sm font-semibold">Transfer bank atau e-wallet</p><p className="text-sm">Nama penerima: <strong>{paymentOptions.data.recipient_name}</strong></p>{paymentOptions.data.bank_account && <p className="text-sm">{paymentOptions.data.bank_name}: <strong className="select-all">{paymentOptions.data.bank_account}</strong></p>}{paymentOptions.data.dana_number && <p className="text-sm">DANA: <strong className="select-all">{paymentOptions.data.dana_number}</strong></p>}{paymentOptions.data.gopay_number && <p className="text-sm">GoPay: <strong className="select-all">{paymentOptions.data.gopay_number}</strong></p>}</div>}<p className="text-xs text-body-muted">Masukkan nominal persis seperti tagihan, termasuk kode unik. Langganan aktif setelah pembayaran diterima dan diverifikasi oleh pemilik Trimwait.</p></div>}{invoice.payment_method === 'midtrans' && invoice.status === 'pending' && invoice.qr_code_url && <div className="space-y-2 rounded-xl bg-paper p-3 text-center"><p className="text-sm font-semibold">Pindai QRIS untuk membayar langganan</p><img src={invoice.qr_code_url} alt="QRIS pembayaran langganan Trimwait" className="mx-auto size-56 object-contain" /><p className="text-xs text-body-muted">Langganan diperbarui otomatis setelah pembayaran diterima.</p></div>}{invoice.unique_code > 0 && <p className="text-sm text-body-muted">Nominal sudah termasuk kode unik Rp{invoice.unique_code} untuk mencocokkan pembayaran.</p>}<p className="text-sm text-body-muted">Dibuat: {formatDateTime(invoice.created_at)}</p>{invoice.expires_at && <p className="text-sm text-body-muted">Batas pembayaran: {formatDateTime(invoice.expires_at)}</p>}{invoice.paid_at && <p className="text-sm text-body-muted">Dibayar: {formatDateTime(invoice.paid_at)}</p>}{invoice.period_start && invoice.period_end && <p className="text-sm text-body-muted">Periode langganan: {formatDateTime(invoice.period_start)} – {formatDateTime(invoice.period_end)}</p>}{invoice.status === 'paid' && !invoice.period_start && <p className="text-sm text-muted">Periode invoice lama belum tercatat.</p>}<p className="break-all text-xs text-muted">ID tagihan: {invoice.id}</p></article>)}</section>
      <p className="text-xs text-muted">QRIS otomatis melalui Midtrans aktif setelah pembayaran terkonfirmasi. QR pembayaran otomatis berlaku 30 menit.</p>
    </main>
  )
}
