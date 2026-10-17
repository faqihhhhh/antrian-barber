import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
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
  const [tenantChoice, setTenantChoice] = useState('')

  if (me.isPending) return <Spinner />
  if (me.isError) return <main className="mx-auto max-w-md px-5 py-10"><Alert>{messageOf(me.error)}</Alert></main>

  const memberships = (me.data?.memberships ?? []).filter((item) => item.roles.includes('owner'))
  const tenantID = memberships.some((item) => item.tenant_id === tenantChoice)
    ? tenantChoice
    : memberships[0]?.tenant_id ?? ''
  const membership = memberships.find((item) => item.tenant_id === tenantID)

  return (
    <main className="mx-auto min-h-dvh max-w-md space-y-5 bg-stone-50 px-5 py-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold tracking-wide text-stone-500">KAPSFLOW</p>
          <h1 className="mt-1 text-2xl font-bold">Pengaturan outlet</h1>
        </div>
        <Link
          to="/"
          className="shrink-0 rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-stone-900"
        >
          Beranda
        </Link>
      </header>
      <nav
        aria-label="Navigasi pengaturan bisnis"
        className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 text-sm font-semibold"
      >
        <Link className="shrink-0 rounded-full border border-stone-300 bg-white px-3 py-2 text-stone-700 hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-stone-900" to="/pemilik/pembayaran">Pembayaran DP</Link>
        <Link className="shrink-0 rounded-full border border-stone-300 bg-white px-3 py-2 text-stone-700 hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-stone-900" to="/pemilik/staf">Kelola staf</Link>
        <Link className="shrink-0 rounded-full border border-stone-300 bg-white px-3 py-2 text-stone-700 hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-stone-900" to="/pemilik/statistik">Statistik</Link>
        <Link className="shrink-0 rounded-full border border-stone-300 bg-white px-3 py-2 text-stone-700 hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-stone-900" to="/pemilik/ulasan">Ulasan pelanggan</Link>
        <Link className="shrink-0 rounded-full border border-stone-300 bg-white px-3 py-2 text-stone-700 hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-stone-900" to="/pemilik/langganan">Langganan</Link>
      </nav>

      {memberships.length === 0 ? (
        <Alert tone="info">Akun ini belum menjadi owner bisnis.</Alert>
      ) : (
        <>
          {memberships.length > 1 && (
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-stone-700">Bisnis</span>
              <select
                aria-label="Bisnis"
                className="w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-base focus-visible:outline-2 focus-visible:outline-stone-900"
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

function OutletList({ membership }: { membership: Membership }) {
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

  if (outlets.isPending) return <p className="py-6 text-center text-sm text-stone-500" role="status">Memuat outlet…</p>
  if (outlets.isError) return <Alert>{messageOf(outlets.error)}</Alert>
  if (membership.subscription_status === 'belum_berlangganan' || membership.subscription_status === 'baca_saja') {
    return (
      <section className="space-y-3">
        <Alert tone="info">Aktifkan langganan bisnis ini untuk membuat outlet dan mengatur layanan.</Alert>
        <Link to="/pemilik/langganan" className="inline-flex rounded-xl bg-stone-900 px-4 py-3 text-sm font-semibold text-white">Buka langganan</Link>
      </section>
    )
  }
  if (outlets.data.length === 0) return <CreateOutlet tenantID={membership.tenant_id} />

  return (
    <section className="space-y-4">
      <article className="space-y-3 rounded-2xl border border-stone-200 bg-white p-4">
        <h2 className="font-bold">Lanjutkan penyiapan</h2>
        <p className="text-sm leading-6 text-stone-600">Atur harga DP di outlet, pasang QRIS untuk menerima pembayaran, lalu buka sesi di meja admin agar pelanggan bisa memesan.</p>
        <div className="flex flex-wrap gap-2">
          <Link to="/pemilik/pembayaran" className="inline-flex rounded-xl border border-stone-300 px-4 py-3 text-sm font-semibold text-stone-900">Atur pembayaran DP</Link>
          <Link to="/admin" className="inline-flex rounded-xl bg-stone-900 px-4 py-3 text-sm font-semibold text-white">Buka meja admin</Link>
        </div>
      </article>
      {outlets.data.map((outlet) => (
        <OutletSettings
          key={outlet.id}
          tenantID={membership.tenant_id}
          outlet={outlet}
        />
      ))}
    </section>
  )
}

function CreateOutlet({ tenantID }: { tenantID: string }) {
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
    },
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    create.mutate()
  }

  return (
    <section className="space-y-4 rounded-3xl border border-stone-200 bg-white p-5">
      <div>
        <h2 className="text-lg font-bold">Buat outlet pertama</h2>
        <p className="mt-1 text-sm leading-6 text-stone-600">Tentukan nama dan zona waktu outlet. Setelah dibuat, atur DP dan metode pembayaran sebelum pelanggan memesan.</p>
      </div>
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Nama outlet" name="outletName" autoComplete="organization" required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} />
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-stone-700">Zona waktu outlet</span>
          <select aria-label="Zona waktu outlet" className="w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-base" value={timezone} onChange={(event) => setTimezone(event.target.value)}>
            <option value="Asia/Jakarta">WIB — Asia/Jakarta</option>
            <option value="Asia/Makassar">WITA — Asia/Makassar</option>
            <option value="Asia/Jayapura">WIT — Asia/Jayapura</option>
          </select>
        </label>
        <Field label="Alamat outlet (opsional)" name="outletAddress" autoComplete="street-address" value={address} onChange={(event) => setAddress(event.target.value)} />
        {create.isError && <Alert>{messageOf(create.error)}</Alert>}
        {create.isSuccess && <Alert tone="success">Outlet berhasil dibuat. Lanjutkan dengan mengatur DP dan pembayaran.</Alert>}
        <Button type="submit" loading={create.isPending} disabled={!name.trim()}>Buat outlet</Button>
      </form>
    </section>
  )
}

function OutletSettings({ tenantID, outlet }: { tenantID: string; outlet: Outlet }) {
  const queryClient = useQueryClient()
  const [dpPrice, setDpPrice] = useState(String(outlet.dp_price_rupiah))
  const [duration, setDuration] = useState(String(outlet.default_duration_minutes))
  const [saved, setSaved] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  const publicURL = `${window.location.origin}/b/${outlet.slug}`

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
    <article className="rounded-3xl border border-stone-200 bg-white p-5">
      <h2 className="text-lg font-bold">{outlet.name}</h2>
      <p className="mt-1 text-sm text-stone-600">{outlet.address || 'Alamat belum diisi'} · {outlet.timezone}</p>
      <p className="mt-2 text-sm text-stone-600">
        Tautan publik: <a className="font-semibold underline" href={`/b/${outlet.slug}`}>{publicURL}</a>
      </p>
      <div className="mt-3 flex gap-2">
        <Button type="button" variant="ghost" className="border border-stone-300" onClick={copyPublicURL}>Salin tautan</Button>
        <a className="inline-flex w-full items-center justify-center rounded-xl border border-stone-300 px-4 py-3 text-sm font-semibold text-stone-900 hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-stone-900" href={`/b/${outlet.slug}`} target="_blank" rel="noreferrer">Buka halaman</a>
      </div>
      {linkCopied && <p className="mt-2 text-sm text-emerald-700" role="status">Tautan outlet disalin.</p>}
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
          onChange={(event) => setDpPrice(event.target.value)}
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
          onChange={(event) => setDuration(event.target.value)}
          hint="Dipakai untuk menghitung perkiraan waktu tunggu."
        />
        {save.isError && <Alert>{messageOf(save.error)}</Alert>}
        {saved && <Alert tone="success">Pengaturan outlet tersimpan.</Alert>}
        <Button type="submit" loading={save.isPending}>Simpan pengaturan</Button>
      </form>
    </article>
  )
}
