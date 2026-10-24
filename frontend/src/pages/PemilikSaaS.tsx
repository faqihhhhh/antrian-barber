import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { Link } from 'react-router'
import { api, ApiError, messageOf } from '../api/client'
import { useMe } from '../auth/useMe'
import { Alert, ConfirmDialog, Spinner } from '../components/ui'
import { formatDateTime, formatMonthYear, formatRupiah } from '../lib/format'

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
      <PlatformBilling />
      {stats.isPending ? <Spinner /> : stats.isError ? <Alert>{messageOf(stats.error)}</Alert> : (
        <>
          <PlanPricing />
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

function PlatformBilling() {
  const queryClient = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [confirmInvoiceID, setConfirmInvoiceID] = useState<string | null>(null)
  const settings = useQuery({
    queryKey: ['platform-payment-settings'],
    queryFn: async () => {
      const { data, error, response } = await api.GET('/v1/admin/payment-settings')
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
  })
  const invoices = useQuery({
    queryKey: ['platform-invoices'],
    refetchInterval: (query) => query.state.data?.some((invoice) => invoice.status === 'pending') ? 10_000 : false,
    queryFn: async () => {
      const { data, error, response } = await api.GET('/v1/admin/invoices')
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
  })
  const refreshBilling = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['platform-payment-settings'] }),
      queryClient.invalidateQueries({ queryKey: ['platform-invoices'] }),
      queryClient.invalidateQueries({ queryKey: ['platform-stats'] }),
    ])
  }
  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Pilih gambar QRIS terlebih dahulu.')
      const { data, error, response } = await api.PUT('/v1/admin/payment-settings/manual-qris', {
        body: file as unknown as string,
        bodySerializer: () => file,
        headers: { 'Content-Type': file.type },
      })
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
    onSuccess: async () => {
      setFile(null)
      if (input.current) input.current.value = ''
      await refreshBilling()
    },
  })
  const clear = useMutation({
    mutationFn: async () => {
      const { data, error, response } = await api.DELETE('/v1/admin/payment-settings/manual-qris')
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
    onSuccess: refreshBilling,
  })
  const confirm = useMutation({
    mutationFn: async (invoiceID: string) => {
      const { data, error, response } = await api.POST('/v1/admin/invoices/{invoiceID}/confirm', { params: { path: { invoiceID } } })
      if (!response.ok || !data) throw new ApiError(error)
      return invoiceID
    },
    onSuccess: async () => {
      setConfirmInvoiceID(null)
      await refreshBilling()
    },
  })

  return <section className="space-y-4 rounded-3xl border border-line bg-white p-5">
    <div><h2 className="text-lg font-bold">Pembayaran langganan</h2><p className="mt-1 text-sm text-body-muted">Atur QRIS manual platform dan cocokkan pembayaran owner.</p></div>
    {settings.isPending ? <Spinner /> : settings.isError ? <Alert>{messageOf(settings.error)}</Alert> : <div className="space-y-3 rounded-2xl border border-line bg-paper p-4">
      <div className="flex items-center justify-between gap-3"><div><h3 className="font-semibold">QRIS manual platform</h3><p className="text-sm text-body-muted">Status: {settings.data.manual_qris_configured ? 'Sudah dipasang' : 'Belum dipasang'} · Otomatis: {settings.data.midtrans_configured ? 'Tersedia' : 'Belum diatur'}</p></div></div>
      {settings.data.manual_qris_configured && <img src="/v1/admin/payment-settings/manual-qris/image" alt="QRIS manual platform" className="mx-auto size-48 rounded-xl border border-line bg-white object-contain" />}
      <label className="block text-sm font-medium">Unggah QRIS (PNG, JPG, WebP; maksimal 512 KB)<input ref={input} className="mt-2 block w-full text-sm" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
      {upload.isError && <Alert>{messageOf(upload.error)}</Alert>}{upload.isSuccess && <Alert tone="success">QRIS manual platform tersimpan.</Alert>}{clear.isError && <Alert>{messageOf(clear.error)}</Alert>}
      <div className="flex flex-wrap gap-2"><button className="rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50" disabled={!file || upload.isPending} onClick={() => upload.mutate()}>{upload.isPending ? 'Menyimpan…' : 'Simpan QRIS'}</button>{settings.data.manual_qris_configured && <button className="rounded-xl border border-line-strong px-4 py-2.5 text-sm font-semibold disabled:opacity-50" disabled={clear.isPending} onClick={() => clear.mutate()}>{clear.isPending ? 'Menghapus…' : 'Hapus QRIS'}</button>}</div>
    </div>}
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3"><h3 className="font-semibold">Tagihan owner</h3>{invoices.data && <span className="rounded-full bg-paper-raised px-3 py-1 text-sm">{invoices.data.filter((invoice) => invoice.status === 'pending').length} menunggu</span>}</div>
      {invoices.isPending ? <Spinner /> : invoices.isError ? <Alert>{messageOf(invoices.error)}</Alert> : invoices.data.length === 0 ? <Alert tone="info">Tidak ada tagihan tertunda.</Alert> : invoices.data.map((invoice) => <article key={invoice.id} className="space-y-2 rounded-2xl border border-line p-4"><div className="flex items-start justify-between gap-3"><div><strong>{invoice.tenant_name}</strong><p className="text-sm text-body-muted">{invoice.plan_name} · {invoice.payment_method === 'manual' ? 'QRIS manual' : 'QRIS otomatis'}</p></div><span className="text-right text-sm">{invoice.status === 'pending' ? 'Menunggu' : 'Kedaluwarsa'}</span></div><p className="text-lg font-bold tabular-nums">{formatRupiah(invoice.amount_rupiah)}</p>{invoice.unique_code > 0 && <p className="text-sm text-body-muted">Kode unik: {invoice.unique_code}</p>}<p className="text-xs text-muted">Dibuat {formatDateTime(invoice.created_at)} · ID {invoice.id}</p>{invoice.payment_method === 'manual' ? <button className="w-full rounded-xl bg-ink px-4 py-3 text-sm font-semibold text-white disabled:opacity-50" disabled={confirm.isPending} onClick={() => setConfirmInvoiceID(invoice.id)}>{confirm.isPending && confirm.variables === invoice.id ? 'Memproses…' : 'Konfirmasi pembayaran manual'}</button> : <p className="text-sm text-body-muted">Pembayaran QRIS otomatis dikonfirmasi oleh Midtrans.</p>}</article>)}
      {confirm.isError && <Alert>{messageOf(confirm.error)}</Alert>}
    </div>
    <ConfirmDialog open={confirmInvoiceID !== null} onCancel={() => setConfirmInvoiceID(null)} onConfirm={() => { if (confirmInvoiceID) confirm.mutate(confirmInvoiceID) }} title="Konfirmasi pembayaran manual?" description="Pastikan transfer QRIS sudah masuk dan nominalnya cocok dengan tagihan. Setelah dikonfirmasi, langganan owner langsung aktif." confirmLabel="Ya, pembayaran diterima" loading={confirm.isPending} />
  </section>
}

function PlanPricing() {
  const queryClient = useQueryClient()
  const plans = useQuery({
    queryKey: ['platform-plans'],
    queryFn: async () => {
      const { data, error, response } = await api.GET('/v1/plans/')
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
  })
  const save = useMutation({
    mutationFn: async ({ code, price }: { code: string; price: number }) => {
      const { data, error, response } = await api.PUT('/v1/admin/plans/{planCode}', {
        params: { path: { planCode: code } }, body: { price_rupiah: price },
      })
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['platform-plans'] })
      await queryClient.invalidateQueries({ queryKey: ['plans'] })
    },
  })
  if (plans.isPending) return <Spinner />
  if (plans.isError) return <Alert>{messageOf(plans.error)}</Alert>
  return <section className="space-y-3" aria-label="Harga paket langganan">
    <h2 className="text-lg font-bold">Harga langganan</h2>
    <div className="grid gap-3 sm:grid-cols-2">
      {plans.data.map((plan) => <PlanPrice key={`${plan.code}-${plan.price_rupiah}`} plan={plan} saving={save.isPending} onSave={(price) => save.mutate({ code: plan.code, price })} error={save.isError ? messageOf(save.error) : null} />)}
    </div>
    {save.isSuccess && <Alert tone="success">Harga paket diperbarui. Tagihan baru memakai harga ini; tagihan yang sudah dibuat tetap.</Alert>}
  </section>
}

function PlanPrice({ plan, saving, onSave, error }: { plan: { code: string; name: string; billing_interval: string; price_rupiah: number }; saving: boolean; onSave: (price: number) => void; error: string | null }) {
  const [price, setPrice] = useState(String(plan.price_rupiah))
  return <form className="space-y-3 rounded-2xl border border-line bg-white p-4" onSubmit={(event) => { event.preventDefault(); const value = Number(price); if (Number.isSafeInteger(value) && value > 0) onSave(value) }}>
    <h3 className="font-semibold">{plan.name} · {plan.billing_interval === 'yearly' ? 'Tahunan' : 'Bulanan'}</h3>
    <label className="block text-sm font-medium">Harga (rupiah)
      <input className="mt-1 w-full rounded-xl border border-line-strong bg-white px-4 py-3 text-base" type="number" min="1" step="1" required value={price} onChange={(event) => setPrice(event.target.value)} />
    </label>
    {error && <Alert>{error}</Alert>}
    <button className="w-full rounded-xl bg-ink px-4 py-3 font-semibold text-white disabled:opacity-50" disabled={saving || Number(price) === plan.price_rupiah}>Simpan harga</button>
  </form>
}

function Metric({ label, value, hint, dark = false }: { label: string; value: string; hint?: string; dark?: boolean }) {
  return <article className={`rounded-2xl border p-4 ${dark ? 'border-ink bg-ink text-white' : 'border-line bg-white'}`}><p className={`text-sm ${dark ? 'text-paper-muted' : 'text-body-muted'}`}>{label}</p><p className="mt-2 text-xl font-bold tabular-nums">{value}</p>{hint && <p className={`mt-1 text-xs ${dark ? 'text-paper-muted' : 'text-muted'}`}>{hint}</p>}</article>
}

function percent(value: number | null): string {
  return value === null ? '—' : `${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(value)}%`
}
