import { useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, messageOf } from '../api/client'
import { useMe } from '../auth/useMe'
import { Alert, Button, Spinner } from '../components/ui'
import type { components } from '../api/schema'

type Membership = components['schemas']['MembershipInfo']
type PaymentProfile = components['schemas']['OwnerPaymentProfile']

export default function PemilikPembayaran() {
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
          <h1 className="mt-1 text-2xl font-bold">Pembayaran DP</h1>
        </div>
        <Link to="/pemilik" className="pt-1 text-sm font-semibold underline">Pengaturan outlet</Link>
      </header>

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
          {membership && <PaymentSettings membership={membership} />}
        </>
      )}
    </main>
  )
}

function PaymentSettings({ membership }: { membership: Membership }) {
  const queryClient = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)

  const profile = useQuery({
    queryKey: ['owner-payment-profile', membership.tenant_id],
    queryFn: async (): Promise<PaymentProfile> => {
      const { data, error, response } = await api.GET('/v1/tenants/{tenantID}/profile', {
        params: { path: { tenantID: membership.tenant_id } },
      })
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
  })

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Pilih gambar QRIS terlebih dahulu.')
      const { data, error, response } = await api.PUT('/v1/tenants/{tenantID}/profile/manual-qris', {
        params: { path: { tenantID: membership.tenant_id } },
        // OpenAPI binary dihasilkan sebagai string; kirim Blob asli tanpa JSON.stringify.
        body: file as unknown as string,
        bodySerializer: () => file,
        headers: { 'Content-Type': file.type },
      })
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
    onSuccess: async () => {
      setFile(null)
      if (fileInput.current) fileInput.current.value = ''
      await queryClient.invalidateQueries({ queryKey: ['owner-payment-profile', membership.tenant_id] })
    },
  })

  const clear = useMutation({
    mutationFn: async () => {
      const { data, error, response } = await api.DELETE('/v1/tenants/{tenantID}/profile/manual-qris', {
        params: { path: { tenantID: membership.tenant_id } },
      })
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
    onSuccess: async () => {
      upload.reset()
      setFile(null)
      if (fileInput.current) fileInput.current.value = ''
      await queryClient.invalidateQueries({ queryKey: ['owner-payment-profile', membership.tenant_id] })
    },
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    clear.reset()
    upload.mutate()
  }

  if (profile.isPending) return <p className="py-6 text-center text-sm text-stone-500" role="status">Memuat status pembayaran…</p>
  if (profile.isError) return <Alert>{messageOf(profile.error)}</Alert>

  return (
    <section className="space-y-4">
      <article className="rounded-3xl border border-stone-200 bg-white p-5">
        <h2 className="text-lg font-bold">QRIS manual</h2>
        <p className="mt-1 text-sm text-stone-600">
          Pelanggan membayar DP ke QRIS ini. Admin bisnis perlu mencocokkan nominal pembayaran sebelum mengonfirmasi tiket.
        </p>
        <p className="mt-4 rounded-xl bg-stone-100 px-4 py-3 text-sm">
          Status: <strong>{profile.data.manual_qris_configured ? 'QRIS sudah terpasang' : 'QRIS belum dipasang'}</strong>
        </p>
        <form className="mt-5 space-y-4" onSubmit={submit}>
          <label className="block" htmlFor="qris-image">
            <span className="mb-1 block text-sm font-medium text-stone-700">Gambar QRIS</span>
            <input
              ref={fileInput}
              id="qris-image"
              name="qris-image"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              required
              disabled={upload.isPending || clear.isPending}
              onChange={(event) => {
                upload.reset()
                clear.reset()
                setFile(event.target.files?.[0] ?? null)
              }}
              className="w-full rounded-xl border border-stone-300 bg-white p-3 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-stone-900 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
            />
            <span className="mt-1 block text-xs text-stone-500">PNG, JPG, atau WebP. Maksimal 512 KB. Mengunggah gambar baru akan mengganti QRIS yang terpasang.</span>
          </label>
          {file && <p className="text-sm text-stone-600">Dipilih: {file.name} ({Math.ceil(file.size / 1024)} KB)</p>}
          {upload.isError && <Alert>{messageOf(upload.error)}</Alert>}
          {upload.isSuccess && <Alert tone="success">Gambar QRIS tersimpan.</Alert>}
          {clear.isError && <Alert>{messageOf(clear.error)}</Alert>}
          {clear.isSuccess && <Alert tone="success">QRIS manual dihapus. Pasang QRIS baru sebelum menerima DP manual.</Alert>}
          <Button type="submit" loading={upload.isPending} disabled={!file || clear.isPending}>Simpan QRIS</Button>
        </form>
        {profile.data.manual_qris_configured && (
          <button
            type="button"
            className="mt-3 w-full rounded-xl px-4 py-3 text-sm font-semibold text-red-700 underline focus-visible:outline-2 focus-visible:outline-red-700 disabled:opacity-60"
            disabled={clear.isPending}
            onClick={() => {
              if (window.confirm('Hapus QRIS manual? Pelanggan tidak dapat memesan dengan DP manual sampai QRIS baru dipasang.')) clear.mutate()
            }}
          >
            {clear.isPending ? 'Menghapus…' : 'Hapus QRIS manual'}
          </button>
        )}
      </article>

      <article className="rounded-3xl border border-stone-200 bg-white p-5">
        <h2 className="font-bold">Midtrans</h2>
        <p className="mt-1 text-sm text-stone-600">
          {profile.data.midtrans_configured
            ? 'Kunci Midtrans sudah tersimpan. Pengaturan kunci tidak ditampilkan di layar ini.'
            : 'Belum diatur. Pembayaran online Midtrans memerlukan akun dan kunci dari Midtrans.'}
        </p>
      </article>
    </section>
  )
}
