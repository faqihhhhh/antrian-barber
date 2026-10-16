import { useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, messageOf } from '../api/client'
import { useMe } from '../auth/useMe'
import { Alert, Button, Spinner } from '../components/ui'
import type { components } from '../api/schema'
import { formatLongDate, formatRupiah } from '../lib/format'

type Membership = components['schemas']['MembershipInfo']
type QueueSession = components['schemas']['QueueSession']
type PendingPayment = components['schemas']['PendingManualPayment']

const POLL_INTERVAL = 5_000

export default function Admin() {
  const me = useMe()
  const [outletChoice, setOutletChoice] = useState('')
  const [sessionChoice, setSessionChoice] = useState('')

  if (me.isPending) return <Spinner />
  if (me.isError) {
    return <main className="mx-auto max-w-md px-5 py-10"><Alert>{messageOf(me.error)}</Alert></main>
  }

  const memberships = (me.data?.memberships ?? []).filter((item) => item.roles.includes('owner') || item.roles.includes('admin'))
  const outlets = memberships.flatMap((membership) => membership.outlets.map((outlet) => ({ membership, outlet })))
  const selectedKey = outlets.some(({ membership, outlet }) => `${membership.tenant_id}:${outlet.id}` === outletChoice)
    ? outletChoice
    : outlets[0] ? `${outlets[0].membership.tenant_id}:${outlets[0].outlet.id}` : ''
  const selected = outlets.find(({ membership, outlet }) => `${membership.tenant_id}:${outlet.id}` === selectedKey)

  return (
    <main className="mx-auto min-h-dvh max-w-md space-y-5 bg-stone-50 px-5 py-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold tracking-wide text-stone-500">KAPSFLOW</p>
          <h1 className="mt-1 text-2xl font-bold">Meja admin</h1>
        </div>
        <Link to="/" className="pt-1 text-sm font-semibold underline">Beranda</Link>
      </header>

      {outlets.length === 0 ? (
        <Alert tone="info">Akun ini belum punya akses admin ke outlet. Hubungi owner bisnis untuk mengatur penugasan.</Alert>
      ) : (
        <>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-stone-700">Outlet</span>
            <select
              aria-label="Outlet"
              className="w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-base focus-visible:outline-2 focus-visible:outline-stone-900"
              value={selectedKey}
              onChange={(event) => { setOutletChoice(event.target.value); setSessionChoice('') }}
            >
              {outlets.map(({ membership, outlet }) => {
                const key = `${membership.tenant_id}:${outlet.id}`
                return <option key={key} value={key}>{membership.tenant_name} · {outlet.name}</option>
              })}
            </select>
          </label>
          {selected && <SessionPanel selected={selected} sessionChoice={sessionChoice} onSessionChange={setSessionChoice} />}
        </>
      )}
    </main>
  )
}

function SessionPanel({
  selected,
  sessionChoice,
  onSessionChange,
}: {
  selected: { membership: Membership; outlet: Membership['outlets'][number] }
  sessionChoice: string
  onSessionChange: (sessionID: string) => void
}) {
  const sessions = useQuery({
    queryKey: ['admin-sessions', selected.membership.tenant_id, selected.outlet.id],
    queryFn: async (): Promise<QueueSession[]> => {
      const { data, error, response } = await api.GET('/v1/tenants/{tenantID}/outlets/{outletID}/queue-sessions', {
        params: { path: { tenantID: selected.membership.tenant_id, outletID: selected.outlet.id } },
      })
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
    refetchInterval: POLL_INTERVAL,
  })

  const currentSession = sessions.data?.find((session) => session.id === sessionChoice)
    ?? sessions.data?.find((session) => session.status === 'open')
    ?? sessions.data?.[0]

  if (sessions.isPending) return <p className="py-6 text-center text-sm text-stone-500" role="status">Memuat sesi antrian…</p>
  if (sessions.isError) return <Alert>{messageOf(sessions.error)}</Alert>
  if (!currentSession) return <Alert tone="info">Belum ada sesi antrian di outlet ini.</Alert>

  return (
    <>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-stone-700">Sesi antrian</span>
        <select
          aria-label="Sesi antrian"
          className="w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-base focus-visible:outline-2 focus-visible:outline-stone-900"
          value={currentSession.id}
          onChange={(event) => onSessionChange(event.target.value)}
        >
          {sessions.data.map((session) => (
            <option key={session.id} value={session.id}>
              {formatLongDate(session.session_date)} · {session.status === 'open' ? 'Dibuka' : 'Ditutup'}
            </option>
          ))}
        </select>
      </label>
      <PaymentPanel membership={selected.membership} session={currentSession} />
    </>
  )
}

function PaymentPanel({ membership, session }: { membership: Membership; session: QueueSession }) {
  const queryClient = useQueryClient()
  const payments = useQuery({
    queryKey: ['admin-pending-manual-payments', membership.tenant_id, session.id],
    queryFn: async (): Promise<PendingPayment[]> => {
      const { data, error, response } = await api.GET('/v1/tenants/{tenantID}/queue-sessions/{sessionID}/pending-manual-payments', {
        params: { path: { tenantID: membership.tenant_id, sessionID: session.id } },
      })
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
    refetchInterval: POLL_INTERVAL,
  })
  const confirm = useMutation({
    mutationFn: async (ticketID: string) => {
      const { error, response } = await api.POST('/v1/tenants/{tenantID}/tickets/{ticketID}/confirm-manual-payment', {
        params: { path: { tenantID: membership.tenant_id, ticketID } },
      })
      if (!response.ok) throw new ApiError(error)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-pending-manual-payments', membership.tenant_id, session.id] })
      await queryClient.invalidateQueries({ queryKey: ['kapster-tickets', membership.tenant_id, session.id] })
    },
  })

  if (payments.isPending) return <p className="py-6 text-center text-sm text-stone-500" role="status">Memuat DP yang menunggu…</p>
  if (payments.isError) return <Alert>{messageOf(payments.error)}</Alert>

  return (
    <section aria-label="DP menunggu konfirmasi" className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">DP menunggu konfirmasi</h2>
        <span className="rounded-full bg-stone-200 px-3 py-1 text-sm font-semibold">{payments.data.length}</span>
      </div>
      {confirm.isError && <Alert>{messageOf(confirm.error)}</Alert>}
      {payments.data.length === 0 ? (
        <Alert tone="info">Tidak ada DP manual yang menunggu di sesi ini.</Alert>
      ) : payments.data.map((payment) => (
        <article key={payment.ticket_id} className="space-y-3 rounded-3xl border border-stone-200 bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Tiket #{payment.ticket_number}</p>
              <h3 className="mt-1 text-lg font-bold">{payment.customer_name || 'Pelanggan'}</h3>
            </div>
            <p className="text-right text-lg font-bold tabular-nums">{formatRupiah(payment.amount_rupiah)}</p>
          </div>
          <dl className="grid grid-cols-2 gap-2 rounded-xl bg-stone-50 p-3 text-sm">
            <div><dt className="text-stone-500">Kode cocok</dt><dd className="font-semibold">{payment.match_code}</dd></div>
            <div><dt className="text-stone-500">Kode unik</dt><dd className="font-semibold">{payment.unique_code ?? '—'}</dd></div>
          </dl>
          <p className="text-xs text-stone-500">Batas bayar {new Date(payment.expires_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</p>
          <Button
            type="button"
            loading={confirm.isPending && confirm.variables === payment.ticket_id}
            disabled={confirm.isPending || session.status !== 'open'}
            onClick={() => confirm.mutate(payment.ticket_id)}
          >
            Konfirmasi DP dan masukkan ke antrean
          </Button>
          {confirm.isSuccess && confirm.variables === payment.ticket_id && (
            <p className="text-sm text-stone-600" role="status">DP dikonfirmasi. Data tiket akan diperbarui otomatis.</p>
          )}
        </article>
      ))}
    </section>
  )
}
