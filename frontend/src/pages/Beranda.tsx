import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router'
import { api } from '../api/client'
import { useMe } from '../auth/useMe'
import { Alert, Button } from '../components/ui'
import { Logo } from '../components/Logo'
import { lastOutlet } from '../lib/storage'
import { removePushSubscription } from '../hooks/usePushNotifications'

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
      try {
        await removePushSubscription()
      } catch {
        // Logout harus tetap bisa dilakukan jika penghapusan subscription gagal.
      }
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
  const outlet = lastOutlet()
  if (!data) return null // RequireLogin sudah memastikan data ada

  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-5 pb-24 pt-8">
      <header className="sticky top-0 z-20 -mx-5 mb-7 flex items-center justify-between border-b border-line bg-paper/95 px-5 py-3 backdrop-blur">
        <Logo />
        <Button type="button" variant="ghost" className="w-auto px-3" loading={logout.isPending} onClick={() => logout.mutate()}>
          Keluar
        </Button>
      </header>
      <div className="mb-6">
        <h1 className="mt-1 text-xl font-bold">Halo</h1>
        <p className="text-sm text-body-muted">{data.user.email}</p>
        {data.is_platform_admin && (
          <div className="mt-2 flex items-center gap-2">
            <span className="inline-block rounded-full bg-ink px-3 py-1 text-xs font-semibold text-white">Pemilik SaaS</span>
            <Link to="/pemilik-saas" className="text-sm font-semibold underline">Buka ringkasan platform</Link>
          </div>
        )}
      </div>

      <section className="grid gap-4 md:grid-cols-2">
        <Link
          to="/tiket"
          className="block rounded-2xl border border-ink bg-white p-4 font-semibold transition hover:bg-paper-raised"
        >
          Tiket saya
          <span className="block text-sm font-normal text-body-muted">Lihat antrian dan status pembayaran</span>
        </Link>
        {outlet && (
          <Link to={`/b/${outlet}`} className="block px-1 text-sm font-semibold underline">
            Kembali ke halaman pemesanan terakhir
          </Link>
        )}

        {data.memberships.length === 0 && (
          <div className="space-y-3">
            <Alert tone="info">Akun ini belum terhubung ke bisnis mana pun. Untuk memesan antrean, buka tautan atau scan QR dari outlet.</Alert>
            <Link to="/mulai-bisnis" className="block rounded-2xl border border-line bg-white p-4 font-semibold transition hover:bg-paper-raised">
              Saya pemilik barbershop atau salon
              <span className="block text-sm font-normal text-body-muted">Buat bisnis pertama di Kapsflow</span>
            </Link>
          </div>
        )}

        {data.memberships.map((m) => (
          <article key={m.membership_id} className="rounded-2xl border border-line bg-white p-4">
            <h2 className="font-semibold">{m.tenant_name}</h2>
            <p className="mt-1 text-sm text-body-muted">{m.roles.map((r) => ROLE_LABEL[r] ?? r).join(' • ')}</p>
            {m.roles.includes('kapster') && (
              <Link to="/kapster" className="mt-3 inline-flex rounded-xl bg-ink px-4 py-3 text-sm font-semibold text-white">
                Buka meja kapster
              </Link>
            )}
            {(m.roles.includes('admin') || m.roles.includes('owner')) && (
              <Link to="/admin" className="mt-3 inline-flex rounded-xl border border-line-strong px-4 py-3 text-sm font-semibold text-ink">
                Buka meja admin
              </Link>
            )}
            {m.roles.includes('owner') && (
              <Link to="/pemilik" className="mt-3 inline-flex rounded-xl border border-line-strong px-4 py-3 text-sm font-semibold text-ink">
                Atur outlet
              </Link>
            )}
            <p className="mt-2 text-sm">
              Langganan: <strong>{STATUS_LABEL[m.subscription_status] ?? m.subscription_status}</strong>
              {m.current_period_end &&
                ` sampai ${new Date(m.current_period_end).toLocaleDateString('id-ID', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}`}
            </p>
            <ul className="mt-3 space-y-1 border-t border-line-soft pt-3 text-sm text-body">
              {m.outlets.map((o) => (
                <li key={o.id}>
                  {o.name} <span className="text-muted">({o.timezone})</span>
                </li>
              ))}
              {m.outlets.length === 0 && <li className="text-muted">Belum ada outlet</li>}
            </ul>
          </article>
        ))}
      </section>

      <nav aria-label="Navigasi utama" className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-2 border-t border-line bg-white/95 px-4 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 backdrop-blur md:hidden">
        <Link to="/" aria-current="page" className="flex min-h-11 items-center justify-center rounded-xl px-3 text-sm font-semibold text-brand-ink focus-visible:outline-2 focus-visible:outline-brand-ink">Beranda</Link>
        <Link to="/tiket" className="flex min-h-11 items-center justify-center rounded-xl px-3 text-sm font-semibold text-body focus-visible:outline-2 focus-visible:outline-brand-ink">Tiket saya</Link>
      </nav>
    </main>
  )
}
