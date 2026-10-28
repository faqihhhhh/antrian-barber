import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { api, ApiError, messageOf } from '../api/client'
import { useMe } from '../auth/useMe'
import { Alert, Badge, Button, Field } from '../components/ui'
import { displayTimezone } from '../lib/timezone'
import { lastOutlet } from '../lib/storage'

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
    explanation: 'Pilih paket untuk mulai memakai Trimwait untuk bisnis ini.',
    action: 'Pilih paket',
  },
}

export default function Beranda() {
  const me = useMe()
  const queryClient = useQueryClient()
  const [displayName, setDisplayName] = useState('')

  const saveDisplayName = useMutation({
    mutationFn: async () => {
      const { data, error, response } = await api.PUT('/v1/me/display_name', { body: { display_name: displayName } })
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['me'] })
    },
  })

  const data = me.data
  const outlet = lastOutlet()
  if (!data) return null // RequireLogin sudah memastikan data ada
  return (
    <main className="mx-auto min-h-[70dvh] max-w-3xl px-5 pb-8 pt-8">
      <div className="mb-6">
        <h1 className="mt-1 text-2xl font-bold">{data.user.display_name ? `Halo, ${data.user.display_name}` : 'Halo'}</h1>
        <p className="text-sm text-body-muted">{data.user.email}</p>
        {!data.user.display_name && (
          <form
            className="mt-4 max-w-md space-y-3 rounded-2xl border border-line bg-white p-4"
            onSubmit={(event) => {
              event.preventDefault()
              saveDisplayName.mutate()
            }}
          >
            <Field
              label="Buat nama panggilan"
              name="profile-displayName"
              autoComplete="nickname"
              required
              minLength={3}
              maxLength={24}
              pattern="[A-Za-z][A-Za-z0-9_]{2,23}"
              hint="Maksimal 60 karakter, boleh memakai spasi."
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value.toLowerCase())}
            />
            {saveDisplayName.isError && <Alert>{messageOf(saveDisplayName.error)}</Alert>}
            <Button type="submit" loading={saveDisplayName.isPending}>Simpan nama panggilan</Button>
          </form>
        )}
        {data.is_platform_admin && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge tone="neutral">Pemilik SaaS</Badge>
            <Link to="/pemilik-saas" className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-brand-ink underline focus-visible:outline-2 focus-visible:outline-brand-ink">Buka ringkasan platform</Link>
          </div>
        )}
      </div>

      <section className="grid gap-4 md:grid-cols-2">
        {data.memberships.length === 0 && <Link
          to="/tiket"
          className="block self-start rounded-2xl border border-ink bg-white p-4 font-semibold transition hover:bg-paper-raised"
        >
          Tiket saya
          <span className="block text-sm font-normal text-body-muted">Lihat antrian dan status pembayaran</span>
        </Link>}
        {data.memberships.length === 0 && outlet && (
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
              {m.roles.includes('owner') && <Link to="/pemilik" className="inline-flex min-h-11 items-center rounded-xl border border-line-strong px-4 py-2.5 text-sm font-semibold text-ink focus-visible:outline-2 focus-visible:outline-brand-ink">Atur outlet</Link>}
            </div>
          </article>
          )
        })}
      </section>

    </main>
  )
}
