import { useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, messageOf } from '../api/client'
import { useMe } from '../auth/useMe'
import { Alert, Spinner } from '../components/ui'
import type { components } from '../api/schema'
import { formatLongDate } from '../lib/format'

type Membership = components['schemas']['MembershipInfo']
type QueueSession = components['schemas']['QueueSession']
type QueueTicket = components['schemas']['QueueTicket']

const POLL_INTERVAL = 5_000

export default function Kapster() {
  const me = useMe()
  const [outletChoice, setOutletChoice] = useState('')
  const [sessionChoice, setSessionChoice] = useState('')

  if (me.isPending) return <Spinner />
  if (me.isError) {
    return (
      <main className="mx-auto max-w-md px-5 py-10">
        <Alert>{messageOf(me.error)}</Alert>
      </main>
    )
  }

  const memberships = (me.data?.memberships ?? []).filter((membership) => membership.roles.includes('kapster'))
  const outlets = memberships.flatMap((membership) =>
    membership.outlets.map((outlet) => ({ membership, outlet })),
  )
  const selectedOutletKey = outlets.some(({ membership, outlet }) => `${membership.tenant_id}:${outlet.id}` === outletChoice)
    ? outletChoice
    : outlets[0]
      ? `${outlets[0].membership.tenant_id}:${outlets[0].outlet.id}`
      : ''
  const selected = outlets.find(({ membership, outlet }) => `${membership.tenant_id}:${outlet.id}` === selectedOutletKey)

  return (
    <main className="mx-auto min-h-dvh max-w-md space-y-5 bg-stone-50 px-5 py-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold tracking-wide text-stone-500">KAPSFLOW</p>
          <h1 className="mt-1 text-2xl font-bold">Meja kapster</h1>
        </div>
        <Link to="/" className="pt-1 text-sm font-semibold underline">Beranda</Link>
      </header>

      {outlets.length === 0 ? (
        <Alert tone="info">Akun ini belum punya penugasan sebagai kapster. Hubungi owner bisnis untuk mengatur outlet tugas.</Alert>
      ) : (
        <>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-stone-700">Outlet tugas</span>
            <select
              aria-label="Outlet tugas"
              className="w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-base focus-visible:outline-2 focus-visible:outline-stone-900"
              value={selectedOutletKey}
              onChange={(event) => {
                setOutletChoice(event.target.value)
                setSessionChoice('')
              }}
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
    queryKey: ['kapster-sessions', selected.membership.tenant_id, selected.outlet.id],
    queryFn: async (): Promise<QueueSession[]> => {
      const { data, error, response } = await api.GET('/v1/tenants/{tenantID}/outlets/{outletID}/queue-sessions', {
        params: { path: { tenantID: selected.membership.tenant_id, outletID: selected.outlet.id } },
      })
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
    refetchInterval: POLL_INTERVAL,
  })

  const selectedSession = sessions.data?.find((session) => session.id === sessionChoice)
    ?? sessions.data?.find((session) => session.status === 'open')
    ?? sessions.data?.[0]

  if (sessions.isPending) return <p className="py-6 text-center text-sm text-stone-500" role="status">Memuat sesi antrian…</p>
  if (sessions.isError) return <Alert>{messageOf(sessions.error)}</Alert>
  if (!selectedSession) {
    return (
      <Alert tone="info">
        Belum ada sesi antrian di outlet ini. Sesi akan muncul otomatis setelah admin membukanya.
      </Alert>
    )
  }

  return (
    <>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-stone-700">Sesi antrian</span>
        <select
          aria-label="Sesi antrian"
          className="w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-base focus-visible:outline-2 focus-visible:outline-stone-900"
          value={selectedSession.id}
          onChange={(event) => onSessionChange(event.target.value)}
        >
          {sessions.data.map((session) => (
            <option key={session.id} value={session.id}>
              {formatLongDate(session.session_date)} · {session.status === 'open' ? 'Dibuka' : 'Ditutup'}
            </option>
          ))}
        </select>
      </label>
      <QueuePanel membership={selected.membership} session={selectedSession} />
    </>
  )
}

function QueuePanel({ membership, session }: { membership: Membership; session: QueueSession }) {
  const queryClient = useQueryClient()
  const tickets = useQuery({
    queryKey: ['kapster-tickets', membership.tenant_id, session.id],
    queryFn: async (): Promise<QueueTicket[]> => {
      const { data, error, response } = await api.GET('/v1/tenants/{tenantID}/queue-sessions/{sessionID}/tickets', {
        params: { path: { tenantID: membership.tenant_id, sessionID: session.id } },
      })
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
    refetchInterval: POLL_INTERVAL,
  })
  const kapsterStates = useQuery({
    queryKey: ['kapster-states', membership.tenant_id, session.id],
    queryFn: async () => {
      const { data, error, response } = await api.GET('/v1/tenants/{tenantID}/queue-sessions/{sessionID}/kapster-states', {
        params: { path: { tenantID: membership.tenant_id, sessionID: session.id } },
      })
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
    refetchInterval: POLL_INTERVAL,
  })
  const action = useMutation({
    mutationFn: async (name: 'ready' | 'start' | 'skip' | 'complete') => {
      const params = { params: { path: { tenantID: membership.tenant_id, sessionID: session.id } } }
      switch (name) {
        case 'ready': {
          const { error, response } = await api.POST('/v1/tenants/{tenantID}/queue-sessions/{sessionID}/ready', params)
          if (!response.ok) throw new ApiError(error)
          return
        }
        case 'start': {
          const { error, response } = await api.POST('/v1/tenants/{tenantID}/queue-sessions/{sessionID}/start', params)
          if (!response.ok) throw new ApiError(error)
          return
        }
        case 'skip': {
          const { error, response } = await api.POST('/v1/tenants/{tenantID}/queue-sessions/{sessionID}/skip', params)
          if (!response.ok) throw new ApiError(error)
          return
        }
        case 'complete': {
          const { error, response } = await api.POST('/v1/tenants/{tenantID}/queue-sessions/{sessionID}/complete', params)
          if (!response.ok) throw new ApiError(error)
        }
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['kapster-tickets', membership.tenant_id, session.id] }),
        queryClient.invalidateQueries({ queryKey: ['kapster-states', membership.tenant_id, session.id] }),
      ])
    },
  })

  if (tickets.isPending || kapsterStates.isPending) {
    return <p className="py-6 text-center text-sm text-stone-500" role="status">Memuat kondisi antrian…</p>
  }
  if (tickets.isError) return <Alert>{messageOf(tickets.error)}</Alert>
  if (kapsterStates.isError) return <Alert>{messageOf(kapsterStates.error)}</Alert>

  const myState = kapsterStates.data.find((state) => state.membership_id === membership.membership_id)
  const currentTicket = tickets.data.find((ticket) => ticket.id === myState?.current_ticket_id)
  const waiting = tickets.data
    .filter((ticket) => ticket.status === 'waiting')
    .sort((a, b) => a.queue_position - b.queue_position)

  return (
    <>
      <section aria-label="Pelanggan aktif" className="rounded-3xl bg-stone-900 p-6 text-white">
        <p className="text-sm text-stone-300">Pelanggan aktif · {myState?.status === 'busy' ? 'Sedang ditangani' : 'Belum ada'}</p>
        {currentTicket ? (
          <>
            <p className="mt-2 text-6xl font-bold tabular-nums">{currentTicket.ticket_number}</p>
            <p className="mt-2 text-xl font-semibold">{currentTicket.customer_name || 'Pelanggan'}</p>
            {currentTicket.match_code && <p className="mt-1 text-sm text-stone-300">Kode cocok: {currentTicket.match_code}</p>}
          </>
        ) : (
          <p className="mt-3 text-lg font-semibold">
            {myState?.status === 'busy' ? 'Menyinkronkan tiket aktif…' : 'Belum ada pelanggan aktif'}
          </p>
        )}
        <p className="mt-4 border-t border-stone-700 pt-3 text-sm text-stone-300">
          Status sesi: {session.status === 'open' ? 'Dibuka' : 'Ditutup'}
        </p>
      </section>

      <section aria-label="Aksi kapster" className="space-y-3">
        {!currentTicket && myState?.status !== 'busy' && (
          <button
            type="button"
            disabled={action.isPending || waiting.length === 0}
            onClick={() => action.mutate('ready')}
            className="w-full rounded-xl bg-stone-900 px-4 py-4 text-base font-semibold text-white transition hover:bg-stone-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900 disabled:opacity-60"
          >
            {action.isPending && action.variables === 'ready' ? 'Memanggil…' : 'Panggil pelanggan berikutnya'}
          </button>
        )}
        {currentTicket?.status === 'called' && (
          <button
            type="button"
            disabled={action.isPending}
            onClick={() => action.mutate('start')}
            className="w-full rounded-xl bg-stone-900 px-4 py-4 text-base font-semibold text-white transition hover:bg-stone-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900 disabled:opacity-60"
          >
            {action.isPending && action.variables === 'start' ? 'Memulai…' : 'Mulai layanan'}
          </button>
        )}
        {currentTicket?.status === 'called' && (
          <button
            type="button"
            disabled={action.isPending}
            onClick={() => action.mutate('skip')}
            className="w-full rounded-xl border border-stone-300 bg-white px-3 py-4 text-sm font-semibold text-stone-900 transition hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900 disabled:opacity-60"
          >
            {action.isPending && action.variables === 'skip' ? 'Melewati…' : 'Lewati pelanggan'}
          </button>
        )}
        {currentTicket?.status === 'in_progress' && (
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              disabled={action.isPending}
              onClick={() => action.mutate('complete')}
              className="rounded-xl bg-stone-900 px-3 py-4 text-sm font-semibold text-white transition hover:bg-stone-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900 disabled:opacity-60"
            >
              {action.isPending && action.variables === 'complete' ? 'Menyelesaikan…' : 'Selesaikan'}
            </button>
            <button
              type="button"
              disabled={action.isPending}
              onClick={() => action.mutate('skip')}
              className="rounded-xl border border-stone-300 bg-white px-3 py-4 text-sm font-semibold text-stone-900 transition hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900 disabled:opacity-60"
            >
              {action.isPending && action.variables === 'skip' ? 'Melewati…' : 'Lewati pelanggan'}
            </button>
          </div>
        )}
        {action.isError && <Alert>{messageOf(action.error)}</Alert>}
        {session.status !== 'open' && <Alert tone="info">Sesi ditutup untuk pesanan baru. Selesaikan tiket yang masih tersisa.</Alert>}
      </section>

      <section aria-label="Antrian menunggu" className="rounded-3xl border border-stone-200 bg-white p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-bold">Menunggu</h2>
          <span className="text-sm text-stone-500">{waiting.length} pelanggan</span>
        </div>
        {waiting.length === 0 ? (
          <p className="mt-3 text-sm text-stone-600">Belum ada pelanggan yang menunggu.</p>
        ) : (
          <ol className="mt-3 divide-y divide-stone-100">
            {waiting.map((ticket) => (
              <li key={ticket.id} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
                <span className="w-10 text-center text-2xl font-bold tabular-nums">{ticket.ticket_number}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{ticket.customer_name || 'Pelanggan'}</span>
                  <span className="block text-sm text-stone-500">{ticket.channel === 'offline' ? 'Datang langsung' : 'Pesan online'}</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
      <p className="text-center text-xs text-stone-500">Data diperbarui otomatis setiap 5 detik.</p>
    </>
  )
}
