import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router'
import { api, ApiError, messageOf } from '../api/client'
import { useMe } from '../auth/useMe'
import { Alert, Button, Field, Spinner } from '../components/ui'
import { formatRupiah } from '../lib/format'
import type { components } from '../api/schema'

type PublicPricing = components['schemas']['PublicPricing']

export default function PemilikMulai() {
  const me = useMe()
  const [name, setName] = useState('')
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const create = useMutation({
    mutationFn: async () => {
      const { data, error, response } = await api.POST('/v1/tenants/', { body: { name: name.trim() } })
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['me'] })
      navigate('/pemilik', { replace: true })
    },
  })

  if (me.isPending) return <Spinner />
  if (me.isError) return <main className="mx-auto max-w-md px-5 py-10"><Alert>{messageOf(me.error)}</Alert></main>

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    create.mutate()
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 bg-paper px-5 py-8">
      <header>
        <Link to="/" className="text-sm font-semibold underline">← Beranda</Link>
        <p className="mt-8 text-sm font-semibold tracking-wide text-muted">MULAI DENGAN BISNISMU</p>
        <h1 className="mt-2 text-3xl font-bold">Buat bisnis pertama</h1>
        <p className="mt-2 text-sm leading-6 text-body-muted">Nama ini digunakan untuk mengenali akun usahamu di Trimwait. Setelah bisnis dibuat, lanjutkan dengan menambahkan outlet.</p>
      </header>

      <PublicPricingPanel />

      <form className="space-y-4 rounded-3xl border border-line bg-white p-5" onSubmit={submit}>
        <Field
          label="Nama bisnis atau barbershop"
          name="businessName"
          autoComplete="organization"
          required
          minLength={1}
          maxLength={100}
          value={name}
          onChange={(event) => setName(event.target.value)}
          hint="Maksimal 100 karakter. Contoh: Barber Maju Jaya."
        />
        {create.isError && <Alert>{messageOf(create.error)}</Alert>}
        <Button type="submit" loading={create.isPending} disabled={!name.trim()}>
          Buat bisnis
        </Button>
      </form>
      <Alert tone="info">Pembuatan outlet dan pengaturan antrean adalah langkah berikutnya. Outlet baru dapat dibuat setelah langganan bisnis aktif.</Alert>
    </main>
  )
}

function PublicPricingPanel() {
  const pricing = useQuery({
    queryKey: ['public-pricing'],
    refetchInterval: 30_000,
    queryFn: async (): Promise<PublicPricing> => {
      const { data, error, response } = await api.GET('/v1/plans/pricing')
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
  })

  return <section className="space-y-3 rounded-2xl border border-line bg-white p-4" aria-label="Harga Trimwait">
    <div><h2 className="font-bold">Harga langganan</h2><p className="mt-1 text-sm text-body-muted">Satu outlet sudah termasuk dalam paket bisnis.</p></div>
    {pricing.isPending ? <Spinner /> : pricing.isError ? <Alert>{messageOf(pricing.error)}</Alert> : <>
      <ul className="space-y-2">
        {pricing.data.plans.map((plan) => <li key={plan.code} className="flex items-center justify-between gap-3 rounded-xl bg-paper px-3 py-2.5 text-sm">
          <span>{plan.name} · {plan.billing_interval === 'yearly' ? 'Tahunan' : 'Bulanan'}</span>
          <strong className="whitespace-nowrap">{formatRupiah(plan.price_rupiah)} / {plan.billing_interval === 'yearly' ? 'tahun' : 'bulan'}</strong>
        </li>)}
      </ul>
      <div className="rounded-xl border border-line-soft p-3">
        <h3 className="text-sm font-semibold">Outlet ke-2 dan seterusnya</h3>
        <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
          <p>Bulanan: <strong>{pricing.data.additional_outlet_monthly_price_rupiah > 0 ? `${formatRupiah(pricing.data.additional_outlet_monthly_price_rupiah)} / bulan` : 'Belum tersedia'}</strong></p>
          <p>Tahunan: <strong>{pricing.data.additional_outlet_yearly_price_rupiah > 0 ? `${formatRupiah(pricing.data.additional_outlet_yearly_price_rupiah)} / tahun` : 'Belum tersedia'}</strong></p>
        </div>
      </div>
      <p className="text-xs text-muted">Harga ditampilkan sesuai pengaturan Trimwait dan dapat berubah untuk tagihan baru.</p>
    </>}
  </section>
}
