import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { api } from '../api/client'
import { useMe } from '../auth/useMe'
import { Alert, Button } from '../components/ui'

const ROLE_LABEL: Record<string, string> = {
  owner: 'Pemilik bisnis',
  admin: 'Admin',
  kapster: 'Kapster',
}

const STATUS_LABEL: Record<string, string> = {
  aktif: 'Aktif',
  masa_tenggang: 'Masa tenggang',
  baca_saja: 'Mode baca saja',
  belum_berlangganan: 'Belum berlangganan',
}

export default function Beranda() {
  const me = useMe()
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const logout = useMutation({
    mutationFn: async () => {
      await api.POST('/v1/auth/logout')
    },
    onSuccess: () => {
      // Hapus semua data tersimpan supaya akun berikutnya tidak melihat data akun ini.
      queryClient.clear()
      queryClient.setQueryData(['me'], null)
      navigate('/masuk', { replace: true })
    },
  })

  const data = me.data
  if (!data) return null // RequireLogin sudah memastikan data ada

  return (
    <main className="mx-auto max-w-md px-5 py-8">
      <header className="mb-6">
        <p className="text-sm font-semibold tracking-wide text-stone-500">KAPSFLOW</p>
        <h1 className="mt-1 text-xl font-bold">Halo</h1>
        <p className="text-sm text-stone-600">{data.user.email}</p>
        {data.is_platform_admin && (
          <span className="mt-2 inline-block rounded-full bg-stone-900 px-3 py-1 text-xs font-semibold text-white">
            Pemilik SaaS
          </span>
        )}
      </header>

      <section className="space-y-3">
        {data.memberships.length === 0 && (
          <Alert tone="info">
            Akun ini belum terhubung ke bisnis mana pun. Fitur pemesanan antrian untuk pelanggan akan hadir di tahap
            berikutnya.
          </Alert>
        )}

        {data.memberships.map((m) => (
          <article key={m.membership_id} className="rounded-2xl border border-stone-200 bg-white p-4">
            <h2 className="font-semibold">{m.tenant_name}</h2>
            <p className="mt-1 text-sm text-stone-600">{m.roles.map((r) => ROLE_LABEL[r] ?? r).join(' • ')}</p>
            <p className="mt-2 text-sm">
              Langganan: <strong>{STATUS_LABEL[m.subscription_status] ?? m.subscription_status}</strong>
              {m.current_period_end &&
                ` sampai ${new Date(m.current_period_end).toLocaleDateString('id-ID', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}`}
            </p>
            <ul className="mt-3 space-y-1 border-t border-stone-100 pt-3 text-sm text-stone-700">
              {m.outlets.map((o) => (
                <li key={o.id}>
                  {o.name} <span className="text-stone-400">({o.timezone})</span>
                </li>
              ))}
              {m.outlets.length === 0 && <li className="text-stone-400">Belum ada outlet</li>}
            </ul>
          </article>
        ))}
      </section>

      <div className="mt-8">
        <Button type="button" variant="ghost" loading={logout.isPending} onClick={() => logout.mutate()}>
          Keluar
        </Button>
      </div>
    </main>
  )
}