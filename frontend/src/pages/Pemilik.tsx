import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, messageOf } from '../api/client'
import { useMe } from '../auth/useMe'
import { Alert, Button, Field, Spinner } from '../components/ui'
import type { components } from '../api/schema'
import { formatRupiah } from '../lib/format'

type Membership = components['schemas']['MembershipInfo']
type Outlet = components['schemas']['OwnerOutlet']

export default function Pemilik() {
  const me = useMe()
  const location = useLocation()
  const [tenantChoice, setTenantChoice] = useState('')

  if (me.isPending) return <Spinner />
  if (me.isError) return <main className="mx-auto max-w-md px-5 py-10"><Alert>{messageOf(me.error)}</Alert></main>

  const memberships = (me.data?.memberships ?? []).filter((item) => item.roles.includes('owner'))
  const tenantID = memberships.some((item) => item.tenant_id === tenantChoice)
    ? tenantChoice
    : memberships[0]?.tenant_id ?? ''
  const membership = memberships.find((item) => item.tenant_id === tenantID)

  return (
    <main className="mx-auto min-h-dvh max-w-md space-y-5 bg-paper px-5 py-6">
      <header>
        <h1 className="mt-1 text-2xl font-bold">Bisnis</h1>
      </header>
      <section aria-labelledby="menu-bisnis-heading" className="-mx-5 space-y-2">
        <div className="flex items-end justify-between px-5">
          <h2 id="menu-bisnis-heading" className="text-sm font-bold text-body">Menu bisnis</h2>
          <span className="text-xs text-body-muted">Geser untuk melihat</span>
        </div>
        <nav aria-label="Menu pengelolaan bisnis" className="flex snap-x snap-mandatory gap-2 overflow-x-auto px-5 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <ManagementLink to="/pemilik/pembayaran" title="Pembayaran DP" currentPath={location.pathname} />
          <ManagementLink to="/pemilik/staf" title="Kelola staf" currentPath={location.pathname} />
          <ManagementLink to="/pemilik/peran" title="Akses operasional" currentPath={location.pathname} />
          <ManagementLink to="/pemilik/statistik" title="Statistik" currentPath={location.pathname} />
          <ManagementLink to="/pemilik/ulasan" title="Ulasan pelanggan" currentPath={location.pathname} />
          <ManagementLink to="/pemilik/langganan" title="Langganan" currentPath={location.pathname} />
        </nav>
      </section>

      {memberships.length === 0 ? (
        <Alert tone="info">Akun ini belum menjadi owner bisnis.</Alert>
      ) : (
        <>
          {memberships.length > 1 && (
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-body">Bisnis</span>
              <select
                aria-label="Bisnis"
                className="w-full rounded-xl border border-line-strong bg-white px-4 py-3 text-base focus-visible:outline-2 focus-visible:outline-brand-ink"
                value={tenantID}
                onChange={(event) => setTenantChoice(event.target.value)}
              >
                {memberships.map((item) => <option key={item.tenant_id} value={item.tenant_id}>{item.tenant_name}</option>)}
              </select>
            </label>
          )}
          {membership && <OutletList membership={membership} />}
        </>
      )}
    </main>
  )
}

function ManagementLink({ to, title, currentPath }: { to: string; title: string; currentPath: string }) {
  const active = currentPath === to
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      className={`inline-flex min-h-11 shrink-0 snap-start items-center whitespace-nowrap rounded-full border px-4 py-2.5 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ink ${active ? 'border-ink bg-ink text-white shadow-sm' : 'border-line bg-white text-ink hover:border-line-strong hover:bg-paper-raised'}`}
    >
      {title}
    </Link>
  )
}

function OutletList({ membership }: { membership: Membership }) {
  const [showCreateOutlet, setShowCreateOutlet] = useState(false)
  const [renewOutlet, setRenewOutlet] = useState<Outlet | null>(null)
  const outlets = useQuery({
    queryKey: ['owner-outlets', membership.tenant_id],
    queryFn: async (): Promise<Outlet[]> => {
      const { data, error, response } = await api.GET('/v1/tenants/{tenantID}/outlets', {
        params: { path: { tenantID: membership.tenant_id } },
      })
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
  })

  if (outlets.isPending) return <p className="py-6 text-center text-sm text-muted" role="status">Memuat outlet…</p>
  if (outlets.isError) return <Alert>{messageOf(outlets.error)}</Alert>
  if (membership.subscription_status === 'belum_berlangganan' || membership.subscription_status === 'baca_saja') {
    return (
      <section className="space-y-3">
        <Alert tone="info">Aktifkan langganan bisnis ini untuk membuat outlet dan mengatur layanan.</Alert>
        <Link to="/pemilik/langganan" className="inline-flex rounded-xl bg-ink px-4 py-3 text-sm font-semibold text-white">Buka langganan</Link>
      </section>
    )
  }
  if (outlets.data.length === 0) return <CreateOutlet tenantID={membership.tenant_id} />

  return (
    <section className="space-y-4">
      <article className="space-y-3 rounded-2xl border border-line bg-white p-4">
        <h2 className="font-bold">Lanjutkan penyiapan</h2>
        <p className="text-sm leading-6 text-body-muted">Atur harga DP di outlet dan pasang QRIS. Aktifkan ruang Admin jika Anda ingin mengelola sesi antrean sendiri.</p>
        <div className="flex flex-wrap gap-2">
          <Link to="/pemilik/pembayaran" className="inline-flex rounded-xl border border-line-strong px-4 py-3 text-sm font-semibold text-ink">Atur pembayaran DP</Link>
          <Link to="/pemilik/peran" className="inline-flex rounded-xl bg-ink px-4 py-3 text-sm font-semibold text-white">Atur akses operasional</Link>
        </div>
      </article>
      {outlets.data.map((outlet) => (
        <OutletSettings
          key={outlet.id}
          tenantID={membership.tenant_id}
          outlet={outlet}
          onRenew={() => setRenewOutlet(outlet)}
        />
      ))}
      {renewOutlet && <CreateOutletAddon tenantID={membership.tenant_id} existingOutlet={renewOutlet} onCancel={() => setRenewOutlet(null)} />}
      {showCreateOutlet ? (
        <CreateOutletAddon tenantID={membership.tenant_id} onCancel={() => setShowCreateOutlet(false)} />
      ) : (
        <Button type="button" variant="secondary" onClick={() => setShowCreateOutlet(true)}>Tambah outlet</Button>
      )}
    </section>
  )
}

function CreateOutletAddon({ tenantID, existingOutlet, onCancel }: { tenantID: string; existingOutlet?: Outlet; onCancel: () => void }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [timezone, setTimezone] = useState('Asia/Jakarta')
  const [address, setAddress] = useState('')
  const [interval, setInterval] = useState<'monthly' | 'yearly'>('monthly')
  const [method, setMethod] = useState<'manual' | 'midtrans' | ''>('')
  const paymentOptions = useQuery({
    queryKey: ['owner-subscription-payment-options', tenantID],
    queryFn: async () => {
      const { data, error, response } = await api.GET('/v1/tenants/{tenantID}/subscription/payment-options', { params: { path: { tenantID } } })
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
  })
  const invoice = useMutation({
    mutationFn: async () => {
      const selectedMethod = method || (paymentOptions.data?.manual_qris_configured || paymentOptions.data?.manual_transfer_configured ? 'manual' : 'midtrans')
      const { data, error, response } = await api.POST('/v1/tenants/{tenantID}/outlet-subscriptions', {
        params: { path: { tenantID } },
        body: {
          outlet_id: existingOutlet?.id ?? null,
          name: existingOutlet ? '' : name.trim(),
          timezone: existingOutlet ? '' : timezone,
          address: existingOutlet ? '' : address.trim(),
          billing_interval: interval,
          payment_method: selectedMethod,
        },
      })
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['owner-invoices', tenantID] })
      await queryClient.invalidateQueries({ queryKey: ['owner-outlets', tenantID] })
      navigate(`/pemilik/langganan?tenant=${tenantID}`)
    },
  })
  const addonPrice = interval === 'monthly' ? paymentOptions.data?.additional_outlet_monthly_price_rupiah : paymentOptions.data?.additional_outlet_yearly_price_rupiah
  const manualAvailable = !!(paymentOptions.data?.manual_qris_configured || paymentOptions.data?.manual_transfer_configured)
  const midtransAvailable = !!paymentOptions.data?.midtrans_configured
  const selectedMethod = method || (manualAvailable ? 'manual' : 'midtrans')
  return <section className="space-y-4 rounded-3xl border border-line bg-white p-5">
    <div><h2 className="text-lg font-bold">{existingOutlet ? `Perpanjang ${existingOutlet.name}` : 'Tambah outlet'}</h2><p className="mt-1 text-sm leading-6 text-body-muted">{existingOutlet ? 'Perpanjangan menambah masa aktif dari tanggal akhir sekarang.' : 'Outlet tambahan aktif setelah tagihan dibayar dan dikonfirmasi.'}</p></div>
    {!existingOutlet && <>
      <Field label="Nama outlet" name="addonOutletName" required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} />
      <label className="block"><span className="mb-1 block text-sm font-medium text-body">Zona waktu outlet</span><select aria-label="Zona waktu outlet" className="w-full rounded-xl border border-line-strong bg-white px-4 py-3 text-base" value={timezone} onChange={(event) => setTimezone(event.target.value)}><option value="Asia/Jakarta">WIB — Asia/Jakarta</option><option value="Asia/Makassar">WITA — Asia/Makassar</option><option value="Asia/Jayapura">WIT — Asia/Jayapura</option></select></label>
      <Field label="Alamat outlet (opsional)" name="addonOutletAddress" value={address} onChange={(event) => setAddress(event.target.value)} />
    </>}
    <label className="block"><span className="mb-1 block text-sm font-medium text-body">Periode outlet</span><select aria-label="Periode outlet" className="w-full rounded-xl border border-line-strong bg-white px-4 py-3 text-base" value={interval} onChange={(event) => setInterval(event.target.value as 'monthly' | 'yearly')}><option value="monthly">Bulanan</option><option value="yearly">Tahunan</option></select></label>
    {paymentOptions.isPending ? <Spinner /> : paymentOptions.isError ? <Alert>{messageOf(paymentOptions.error)}</Alert> : <>
      <p className="rounded-xl bg-paper p-3 text-sm">Biaya outlet tambahan: <strong>{addonPrice ? formatRupiah(addonPrice) : 'Belum diatur'}</strong> / {interval === 'monthly' ? 'bulan' : 'tahun'}</p>
      <fieldset className="space-y-2"><legend className="mb-1 text-sm font-medium text-body">Cara bayar</legend>
        {manualAvailable && <label className="flex items-start gap-3 rounded-xl border border-line p-3"><input type="radio" name="addon-payment-method" value="manual" checked={selectedMethod === 'manual'} onChange={() => setMethod('manual')} /><span><strong className="block text-sm">QRIS atau transfer manual</strong><span className="text-xs text-body-muted">Aktif setelah pemilik Trimwait mencocokkan pembayaran.</span></span></label>}
        {midtransAvailable && <label className="flex items-start gap-3 rounded-xl border border-line p-3"><input type="radio" name="addon-payment-method" value="midtrans" checked={selectedMethod === 'midtrans'} onChange={() => setMethod('midtrans')} /><span><strong className="block text-sm">QRIS otomatis</strong><span className="text-xs text-body-muted">Aktif otomatis setelah pembayaran diterima.</span></span></label>}
        {!manualAvailable && !midtransAvailable && <Alert tone="info">Metode pembayaran langganan belum disiapkan.</Alert>}
      </fieldset>
    </>}
    {invoice.isError && <Alert>{messageOf(invoice.error)}</Alert>}
    <div className="flex gap-2"><Button type="button" variant="secondary" onClick={onCancel}>Batal</Button><Button type="button" loading={invoice.isPending} disabled={!existingOutlet && !name.trim() || !addonPrice || (!manualAvailable && !midtransAvailable)} onClick={() => invoice.mutate()}>{existingOutlet ? 'Buat tagihan perpanjangan' : 'Buat tagihan outlet'}</Button></div>
  </section>
}

function CreateOutlet({ tenantID, title = 'Buat outlet pertama', onCancel, onCreated }: { tenantID: string; title?: string; onCancel?: () => void; onCreated?: () => void }) {
  const [name, setName] = useState('')
  const [timezone, setTimezone] = useState('Asia/Jakarta')
  const [address, setAddress] = useState('')
  const queryClient = useQueryClient()
  const create = useMutation({
    mutationFn: async () => {
      const { data, error, response } = await api.POST('/v1/tenants/{tenantID}/outlets', {
        params: { path: { tenantID } },
        body: { name: name.trim(), timezone, address: address.trim() },
      })
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['owner-outlets', tenantID] }),
        queryClient.invalidateQueries({ queryKey: ['me'] }),
      ])
      onCreated?.()
    },
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    create.mutate()
  }

  return (
    <section className="space-y-4 rounded-3xl border border-line bg-white p-5">
      <div>
        <h2 className="text-lg font-bold">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-body-muted">Tentukan nama dan zona waktu outlet. Setelah dibuat, atur DP dan metode pembayaran sebelum pelanggan memesan.</p>
      </div>
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Nama outlet" name="outletName" autoComplete="organization" required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} />
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-body">Zona waktu outlet</span>
          <select aria-label="Zona waktu outlet" className="w-full rounded-xl border border-line-strong bg-white px-4 py-3 text-base" value={timezone} onChange={(event) => setTimezone(event.target.value)}>
            <option value="Asia/Jakarta">WIB — Asia/Jakarta</option>
            <option value="Asia/Makassar">WITA — Asia/Makassar</option>
            <option value="Asia/Jayapura">WIT — Asia/Jayapura</option>
          </select>
        </label>
        <Field label="Alamat outlet (opsional)" name="outletAddress" autoComplete="street-address" value={address} onChange={(event) => setAddress(event.target.value)} />
        {create.isError && <Alert>{messageOf(create.error)}</Alert>}
        {create.isSuccess && <Alert tone="success">Outlet berhasil dibuat.</Alert>}
        <Button type="submit" loading={create.isPending} disabled={!name.trim()}>Buat outlet</Button>
        {onCancel && <Button type="button" variant="ghost" disabled={create.isPending} onClick={onCancel}>Batal</Button>}
      </form>
    </section>
  )
}

function OutletSettings({ tenantID, outlet, onRenew }: { tenantID: string; outlet: Outlet; onRenew: () => void }) {
  const queryClient = useQueryClient()
  const [dpPrice, setDpPrice] = useState(String(outlet.dp_price_rupiah))
  const [duration, setDuration] = useState(String(outlet.default_duration_minutes))
  const [saved, setSaved] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  const publicURL = `${window.location.origin}/o/${outlet.slug}`
  const hasChanges = Number(dpPrice) !== outlet.dp_price_rupiah || Number(duration) !== outlet.default_duration_minutes

  const save = useMutation({
    mutationFn: async () => {
      const { data, error, response } = await api.PATCH('/v1/tenants/{tenantID}/outlets/{outletID}/settings', {
        params: { path: { tenantID, outletID: outlet.id } },
        body: { dp_price_rupiah: Number(dpPrice), default_duration_minutes: Number(duration) },
      })
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
    onSuccess: async (updated) => {
      setSaved(true)
      queryClient.setQueryData<Outlet[]>(['owner-outlets', tenantID], (current) =>
        current?.map((item) => item.id === updated.id ? updated : item),
      )
      await queryClient.invalidateQueries({ queryKey: ['outlet', outlet.slug] })
    },
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaved(false)
    save.mutate()
  }

  async function copyPublicURL() {
    setLinkCopied(false)
    setCopyError(false)
    try {
      await navigator.clipboard.writeText(publicURL)
      setLinkCopied(true)
    } catch {
      setCopyError(true)
    }
  }

  return (
    <article className="rounded-3xl border border-line bg-white p-5">
      <h2 className="text-lg font-bold">{outlet.name}</h2>
      <p className="mt-1 text-sm text-body-muted">{outlet.address || 'Alamat belum diisi'} · {outlet.timezone}</p>
      {outlet.is_additional && <div className="rounded-xl bg-paper p-3 text-sm"><p>Outlet tambahan · {outlet.additional_billing_interval === 'yearly' ? 'Tahunan' : 'Bulanan'}</p><p className="mt-1">Masa aktif sampai: <strong>{outlet.additional_period_end ? new Date(outlet.additional_period_end).toLocaleDateString('id-ID') : 'Belum aktif'}</strong></p><button type="button" className="mt-2 font-semibold underline" onClick={onRenew}>Perpanjang outlet</button></div>}
      <p className="mt-2 text-sm text-body-muted">
        Tautan publik: <a className="font-semibold underline" href={`/o/${outlet.slug}`}>{publicURL}</a>
      </p>
      <div className="mt-3 flex gap-2">
        <Button type="button" variant="ghost" className="border border-line-strong" onClick={copyPublicURL}>Salin tautan</Button>
        <a className="inline-flex w-full items-center justify-center rounded-xl border border-line-strong px-4 py-3 text-sm font-semibold text-ink hover:bg-paper-raised focus-visible:outline-2 focus-visible:outline-brand-ink" href={`/o/${outlet.slug}`} target="_blank" rel="noreferrer">Buka halaman</a>
      </div>
      {linkCopied && <p className="mt-2 text-sm text-accent-ink" role="status">Tautan outlet disalin.</p>}
      {copyError && <p className="mt-2 text-sm text-red-700" role="alert">Tautan tidak bisa disalin. Pilih dan salin alamat di atas.</p>}
      <form className="mt-5 space-y-4" onSubmit={submit}>
        <Field
          label="Harga DP pelanggan (rupiah)"
          name={`dp-${outlet.id}`}
          type="number"
          min="0"
          step="1000"
          required
          value={dpPrice}
          onChange={(event) => { setDpPrice(event.target.value); setSaved(false) }}
          hint={dpPrice !== '' && Number.isFinite(Number(dpPrice)) ? `Ditampilkan sebagai ${formatRupiah(Number(dpPrice))}` : undefined}
        />
        <Field
          label="Durasi layanan bawaan (menit)"
          name={`duration-${outlet.id}`}
          type="number"
          min="1"
          step="1"
          required
          value={duration}
          onChange={(event) => { setDuration(event.target.value); setSaved(false) }}
          hint="Dipakai untuk menghitung perkiraan waktu tunggu."
        />
        {save.isError && <Alert>{messageOf(save.error)}</Alert>}
        {saved && <Alert tone="success">Pengaturan outlet tersimpan.</Alert>}
        <Button type="submit" loading={save.isPending} disabled={!hasChanges}>Simpan pengaturan</Button>
      </form>
    </article>
  )
}
