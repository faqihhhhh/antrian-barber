import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router'
import { api } from '../api/client'
import { useMe } from '../auth/useMe'
import { Badge, Button } from '../components/ui'
import { Logo } from '../components/Logo'
import { displayTimezone } from '../lib/timezone'
import { lastOutlet } from '../lib/storage'
import { removePushSubscription } from '../hooks/usePushNotifications'

const ROLE_LABEL: Record<string, string> = {
  owner: 'Pemilik bisnis',
  admin: 'Admin',
  kapster: 'Kapster',
}

const STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral'; explanation?: string; action?: string }> = {
  aktif: { label: 'Aktif', tone: 'success' },
  masa_tenggang: {
    label: 'Masa tenggang',
    tone: 'warning',
    explanation: 'Perpanjang langganan agar layanan tetap berjalan penuh.',
    action: 'Perpanjang langganan',
  },
  baca_saja: {
    label: 'Mode baca saja',
    tone: 'danger',
    explanation: 'Pengelolaan bisnis dibatasi sampai langganan diperbarui.',
    action: 'Perbarui langganan',
  },
  belum_berlangganan: {
    label: 'Belum berlangganan',
    tone: 'neutral',
    explanation: 'Pilih paket untuk mulai memakai Kapsflow untuk bisnis ini.',
    action: 'Pilih paket',
  },
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
  const localEmailPart = data.user.email.split('@', 1)[0]
  const greetingName = localEmailPart ? localEmailPart[0].toLocaleUpperCase('id-ID') + localEmailPart.slice(1) : null

  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-5 pb-24 pt-8">
      <header className="sticky top-0 z-20 -mx-5 mb-7 flex items-center justify-between border-b border-line bg-paper/95 px-5 py-3 backdrop-blur">
        <Logo />
        <Button type="button" variant="ghost" className="w-auto px-3" loading={logout.isPending} onClick={() => logout.mutate()}>
          Keluar
        </Button>
      </header>
      <div className="mb-6">
        <h1 className="mt-1 text-2xl font-bold">{greetingName ? `Halo, ${greetingName}` : 'Halo'}</h1>
        <p className="text-sm text-body-muted">{data.user.email}</p>
        {data.is_platform_admin && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge tone="neutral">Pemilik SaaS</Badge>
            <Link to="/pemilik-saas" className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-brand-ink underline focus-visible:outline-2 focus-visible:outline-brand-ink">Buka ringkasan platform</Link>
          </div>
        )}
      </div>

      <section className="grid gap-4 md:grid-cols-2">
        <Link
          to="/tiket"
          className="block self-start rounded-2xl border border-ink bg-white p-4 font-semibold transition hover:bg-paper-raised"
        >
          Tiket saya
          <span className="block text-sm font-normal text-body-muted">Lihat antrian dan status pembayaran</span>
        </Link>
        {outlet && (
          <Link to={`/o/${outlet}`} className="block px-1 text-sm font-semibold underline">
            Kembali ke halaman pemesanan terakhir
          </Link>
        )}

        {data.memberships.length === 0 && (
          <article className="rounded-2xl border border-line bg-white p-5">
            <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-paper-raised text-brand-ink" aria-hidden="true">
              <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 10h18l-1.5 10h-15L3 10Z" /><path d="m5 10 2-6h10l2 6M9 20v-6h6v6" /></svg>
            </div>
            <h2 className="font-semibold">Belum terhubung ke bisnis</h2>
            <p className="mt-1 text-sm leading-6 text-body-muted">Untuk memesan antrean, buka tautan atau pindai QR dari outlet. Jika Anda pemilik usaha, buat bisnis untuk mulai menyiapkan outlet.</p>
            <Link to="/mulai-bisnis" className="mt-3 inline-flex min-h-11 items-center rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ink">
              Buat bisnis
            </Link>
          </article>
        )}

        {data.memberships.map((m) => {
          const status = STATUS[m.subscription_status] ?? { label: m.subscription_status, tone: 'neutral' as const }
          return (
          <article key={m.membership_id} className="flex flex-col rounded-2xl border border-line bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h2 className="text-lg font-bold">{m.tenant_name}</h2>
              <div className="flex flex-wrap gap-1.5">
                {m.roles.map((role) => <Badge key={role} tone="neutral">{ROLE_LABEL[role] ?? role}</Badge>)}
              </div>
            </div>

            <div className="mt-4 rounded-xl bg-paper px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">Langganan</span>
                <Badge tone={status.tone}>{status.label}</Badge>
              </div>
              {m.current_period_end && <p className="mt-2 text-sm text-body-muted">Berakhir {new Date(m.current_period_end).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</p>}
              {status.explanation && (
                <>
                  <p className="mt-2 text-sm leading-5 text-body-muted">{status.explanation}</p>
                  {m.roles.includes('owner') ? (
                    <Button to="/pemilik/langganan" variant="secondary" className="mt-3 w-auto">{status.action}</Button>
                  ) : (
                    <Button type="button" variant="secondary" className="mt-3 w-auto" disabled title="Hubungi pemilik bisnis untuk mengelola langganan">Hubungi pemilik bisnis</Button>
                  )}
                </>
              )}
            </div>

            <div className="mt-4 border-t border-line-soft pt-4">
              <h3 className="text-sm font-semibold">Outlet</h3>
              {m.outlets.length > 0 ? (
                <ul className="mt-2 space-y-2 text-sm text-body">
                  {m.outlets.map((o) => (
                    <li key={o.id} className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2"><span className="size-2 rounded-full bg-brand" aria-hidden="true" />{o.name}</span>
                      <span className="font-medium text-body-muted">{displayTimezone(o.timezone)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="mt-2 rounded-xl bg-paper-raised px-3 py-3 text-sm text-body-muted">
                  <p>Belum ada outlet di bisnis ini.</p>
                  {m.roles.includes('owner') && <Link to="/pemilik" className="mt-1 inline-flex min-h-11 items-center font-semibold text-brand-ink underline focus-visible:outline-2 focus-visible:outline-brand-ink">Tambahkan outlet</Link>}
                </div>
              )}
            </div>

            <div className="mt-auto flex flex-wrap gap-2 pt-4">
              {m.roles.includes('kapster') && <Link to="/kapster" className="inline-flex min-h-11 items-center rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ink">Buka meja kapster</Link>}
              {(m.roles.includes('admin') || m.roles.includes('owner')) && <Link to="/admin" className="inline-flex min-h-11 items-center rounded-xl border border-line-strong px-4 py-2.5 text-sm font-semibold text-ink focus-visible:outline-2 focus-visible:outline-brand-ink">Buka meja admin</Link>}
              {m.roles.includes('owner') && <Link to="/pemilik" className="inline-flex min-h-11 items-center rounded-xl border border-line-strong px-4 py-2.5 text-sm font-semibold text-ink focus-visible:outline-2 focus-visible:outline-brand-ink">Atur outlet</Link>}
            </div>
          </article>
          )
        })}
      </section>

      <nav aria-label="Navigasi utama" className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-2 border-t border-line bg-white/95 px-4 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 backdrop-blur md:hidden">
        <Link to="/" aria-current="page" className="flex min-h-11 items-center justify-center rounded-xl px-3 text-sm font-semibold text-brand-ink focus-visible:outline-2 focus-visible:outline-brand-ink">Beranda</Link>
        <Link to="/tiket" className="flex min-h-11 items-center justify-center rounded-xl px-3 text-sm font-semibold text-body focus-visible:outline-2 focus-visible:outline-brand-ink">Tiket saya</Link>
      </nav>
    </main>
  )
}
