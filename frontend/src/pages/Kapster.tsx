import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, messageOf } from '../api/client'
import { useMe } from '../auth/useMe'
import { Alert, Badge, Button, ConfirmDialog, ConnectionStatus, RetryAlert, Spinner } from '../components/ui'
import type { components } from '../api/schema'
import { formatLongDate } from '../lib/format'
import { useQueueStream } from '../hooks/useQueueStream'

type Membership = components['schemas']['MembershipInfo']
type QueueSession = components['schemas']['QueueSession']
type QueueTicket = components['schemas']['QueueTicket']

const POLL_INTERVAL = 5_000

export default function Kapster() {
  const me = useMe()
  const [outletChoice, setOutletChoice] = useState('')

  if (me.isPending) return <Spinner />
  if (me.isError) {
    return (
      <main className="mx-auto max-w-md px-5 py-10">
        <RetryAlert onRetry={() => void me.refetch()}>{messageOf(me.error)}</RetryAlert>
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
    <main className="mx-auto min-h-dvh max-w-md space-y-5 bg-paper px-5 py-6">
      <header>
        <h1 className="mt-1 text-2xl font-bold">Meja kapster</h1>
      </header>

      {outlets.length === 0 ? (
        <Alert tone="info">Akun ini belum punya penugasan sebagai kapster. Hubungi owner bisnis untuk mengatur outlet tugas.</Alert>
      ) : (
        <>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-body">Outlet tugas</span>
            <select
              aria-label="Outlet tugas"
              className="w-full rounded-xl border border-line-strong bg-white px-4 py-3 text-base focus-visible:outline-2 focus-visible:outline-brand-ink"
              value={selectedOutletKey}
              onChange={(event) => setOutletChoice(event.target.value)}
            >
              {outlets.map(({ membership, outlet }) => {
                const key = `${membership.tenant_id}:${outlet.id}`
                return <option key={key} value={key}>{membership.tenant_name} · {outlet.name}</option>
              })}
            </select>
          </label>

          {selected && <SessionPanel selected={selected} />}
        </>
      )}
    </main>
  )
}

function SessionPanel({ selected }: {
  selected: { membership: Membership; outlet: Membership['outlets'][number] }
}) {
  const [streamConnected, setStreamConnected] = useState(false)
  const sessions = useQuery({
    queryKey: ['kapster-sessions', selected.membership.tenant_id, selected.outlet.id],
    queryFn: async (): Promise<QueueSession[]> => {
      const { data, error, response } = await api.GET('/v1/tenants/{tenantID}/outlets/{outletID}/queue-sessions', {
        params: { path: { tenantID: selected.membership.tenant_id, outletID: selected.outlet.id } },
      })
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
    refetchInterval: streamConnected ? false : POLL_INTERVAL,
  })

  const today = dateInTimezone(selected.outlet.timezone)
  const todaySession = sessions.data?.find((session) => session.session_date === today)

  if (sessions.isPending) return <p className="py-6 text-center text-sm text-muted" role="status">Memuat sesi antrian…</p>
  if (sessions.isError) return <RetryAlert onRetry={() => void sessions.refetch()}>{messageOf(sessions.error)}</RetryAlert>
  if (!todaySession) {
    return (
      <Alert tone="info">
        Belum ada sesi antrian untuk hari ini. Kapster hanya dapat melayani antrean pada tanggal layanan hari ini.
      </Alert>
    )
  }

  return (
    <>
      <p className="text-sm text-body-muted">Sesi hari ini · {formatLongDate(todaySession.session_date)}</p>
      <QueuePanel membership={selected.membership} session={todaySession} onStreamConnectionChange={setStreamConnected} />
    </>
  )
}

function dateInTimezone(timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const part = (type: string) => parts.find((value) => value.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function QueuePanel({ membership, session, onStreamConnectionChange }: {
  membership: Membership
  session: QueueSession
  onStreamConnectionChange: (connected: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [toast, setToast] = useState('')
  const [confirmSkip, setConfirmSkip] = useState(false)
  const stream = useQueueStream(session.id, () => {
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ['kapster-tickets', membership.tenant_id, session.id] }),
      queryClient.invalidateQueries({ queryKey: ['kapster-states', membership.tenant_id, session.id] }),
    ])
  }, () => {
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ['kapster-tickets', membership.tenant_id, session.id] }),
      queryClient.invalidateQueries({ queryKey: ['kapster-states', membership.tenant_id, session.id] }),
    ])
  })
  useEffect(() => onStreamConnectionChange(stream.connected), [onStreamConnectionChange, stream.connected])
  const tickets = useQuery({
    queryKey: ['kapster-tickets', membership.tenant_id, session.id],
    queryFn: async (): Promise<QueueTicket[]> => {
      const { data, error, response } = await api.GET('/v1/tenants/{tenantID}/queue-sessions/{sessionID}/tickets', {
        params: { path: { tenantID: membership.tenant_id, sessionID: session.id } },
      })
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
    refetchInterval: stream.connected ? false : POLL_INTERVAL,
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
    refetchInterval: stream.connected ? false : POLL_INTERVAL,
  })
  const action = useMutation({
    mutationFn: async (name: 'ready' | 'pause' | 'start' | 'skip' | 'complete') => {
      const params = { params: { path: { tenantID: membership.tenant_id, sessionID: session.id } } }
      switch (name) {
        case 'ready': {
          const { data, error, response } = await api.POST('/v1/tenants/{tenantID}/queue-sessions/{sessionID}/ready', params)
          if (!response.ok) throw new ApiError(error)
          return data && 'message' in data ? data.message : 'Pelanggan berikutnya dipanggil.'
        }
        case 'pause': {
          const { data, error, response } = await api.POST('/v1/tenants/{tenantID}/queue-sessions/{sessionID}/pause', params)
          if (!response.ok || !data) throw new ApiError(error)
          return data.message
        }
        case 'start': {
          const { data, error, response } = await api.POST('/v1/tenants/{tenantID}/queue-sessions/{sessionID}/start', params)
          if (!response.ok || !data) throw new ApiError(error)
          return data.message
        }
        case 'skip': {
          const { data, error, response } = await api.POST('/v1/tenants/{tenantID}/queue-sessions/{sessionID}/skip', params)
          if (!response.ok) throw new ApiError(error)
          return data && 'message' in data ? data.message : 'Pelanggan berikutnya dipanggil.'
        }
        case 'complete': {
          const { data, error, response } = await api.POST('/v1/tenants/{tenantID}/queue-sessions/{sessionID}/complete', params)
          if (!response.ok || !data) throw new ApiError(error)
          return data.message
        }
      }
    },
    onSuccess: async (message) => {
      setToast(message)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['kapster-tickets', membership.tenant_id, session.id] }),
        queryClient.invalidateQueries({ queryKey: ['kapster-states', membership.tenant_id, session.id] }),
      ])
    },
  })

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 3500)
    return () => window.clearTimeout(timer)
  }, [toast])

  if (tickets.isPending || kapsterStates.isPending) {
    return <p className="py-6 text-center text-sm text-muted" role="status">Memuat kondisi antrian…</p>
  }
  if (tickets.isError) return <RetryAlert onRetry={() => void tickets.refetch()}>{messageOf(tickets.error)}</RetryAlert>
  if (kapsterStates.isError) return <RetryAlert onRetry={() => void kapsterStates.refetch()}>{messageOf(kapsterStates.error)}</RetryAlert>

  const myState = kapsterStates.data.find((state) => state.membership_id === membership.membership_id)
  const currentTicket = tickets.data.find((ticket) => ticket.id === myState?.current_ticket_id)
  const waiting = tickets.data
    .filter((ticket) => ticket.status === 'waiting')
    .sort((a, b) => a.queue_position - b.queue_position)

  return (
    <>
      <section aria-label="Pelanggan aktif" className="rounded-3xl bg-ink p-6 text-white">
        <p className="text-sm text-paper-muted">Pelanggan aktif · {myState?.status === 'busy' ? 'Sedang ditangani' : 'Belum ada'}</p>
        {currentTicket ? (
          <>
            <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-paper-muted">Nomor tiket</p>
            <p className="mt-0.5 text-base font-semibold tabular-nums">#{currentTicket.ticket_number}</p>
            <h2 className="mt-2 text-2xl font-bold leading-tight">{currentTicket.customer_name || 'Pelanggan'}</h2>
            {currentTicket.match_code && (
              <div className="mt-4 rounded-2xl border border-white/20 bg-white/10 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-paper-muted">Kode untuk kapster</p>
                <p className="mt-1 font-mono text-3xl font-bold tracking-[0.3em] tabular-nums" aria-label={`Kode untuk kapster ${currentTicket.match_code.split('').join(' ')}`}>
                  {currentTicket.match_code}
                </p>
              </div>
            )}
          </>
        ) : (
          <p className="mt-3 text-lg font-semibold">
            {myState?.status === 'busy' ? 'Menyinkronkan tiket aktif…' : 'Belum ada pelanggan aktif'}
          </p>
        )}
        <p className="mt-4 border-t border-ink-muted pt-3 text-sm text-paper-muted">
          Status sesi: {session.status === 'open' ? 'Dibuka' : 'Ditutup'}
        </p>
      </section>

      <section aria-label="Aksi kapster" className="sticky bottom-2 z-10 space-y-3 rounded-2xl border border-line bg-paper/95 p-3 shadow-lg backdrop-blur">
        {!currentTicket && (!myState || myState.status === 'idle') && (
          <Button type="button" loading={action.isPending && action.variables === 'ready'} disabled={action.isPending} onClick={() => action.mutate('ready')} className="py-3 text-base">
            {action.isPending && action.variables === 'ready' ? 'Memanggil…' : 'Siap'}
          </Button>
        )}
        {!currentTicket && myState?.status === 'ready' && (
          <div className="space-y-3 rounded-2xl border border-line bg-white px-4 py-4 text-center">
            <p className="font-semibold" role="status">Menunggu pelanggan berikutnya…</p>
            <p className="text-sm text-body-muted">Jika perlu meninggalkan tempat, berhenti sementara. Pelanggan baru tetap masuk antrean dan dilayani saat kapster siap.</p>
            <Button type="button" variant="secondary" loading={action.isPending && action.variables === 'pause'} disabled={action.isPending} onClick={() => action.mutate('pause')}>
              {action.isPending && action.variables === 'pause' ? 'Mengubah status…' : 'Berhenti sementara'}
            </Button>
          </div>
        )}
        {currentTicket?.status === 'called' && (
          <Button type="button" loading={action.isPending && action.variables === 'start'} disabled={action.isPending} onClick={() => action.mutate('start')} className="py-3 text-base">
            {action.isPending && action.variables === 'start' ? 'Memulai…' : 'Mulai layanan'}
          </Button>
        )}
        {currentTicket?.status === 'called' && (
          <div className="mt-5 border-t border-line pt-3">
            <p className="mb-2 text-xs font-medium text-body-muted">Aksi lainnya</p>
            <Button type="button" variant="secondary" disabled={action.isPending} onClick={() => setConfirmSkip(true)} className="py-3">
              Ganti pelanggan
            </Button>
          </div>
        )}
        {currentTicket?.status === 'in_progress' && (
          <div className="w-full">
            <Button type="button" loading={action.isPending && action.variables === 'complete'} disabled={action.isPending} onClick={() => action.mutate('complete')} className="w-full py-3 text-base">
              {action.isPending && action.variables === 'complete' ? 'Menyelesaikan…' : 'Selesaikan'}
            </Button>
          </div>
        )}
        {action.isError && <Alert>{action.error instanceof ApiError && action.error.code === 'berlangganan_diperlukan'
          ? 'Langganan bisnis ini tidak aktif. Minta owner bisnis memperbarui langganannya.'
          : messageOf(action.error)}</Alert>}
        {toast && <Alert tone="success">{toast}</Alert>}
        {session.status !== 'open' && <Alert tone="info">Sesi ditutup untuk pesanan baru. Selesaikan tiket yang masih tersisa.</Alert>}
      </section>
      <ConfirmDialog
        open={confirmSkip}
        title="Ganti pelanggan?"
        description="Tiket ini akan dilewati dan sistem akan memanggil pelanggan berikutnya."
        confirmLabel="Ya, ganti pelanggan"
        loading={action.isPending && action.variables === 'skip'}
        onCancel={() => setConfirmSkip(false)}
        onConfirm={() => {
          action.mutate('skip', { onSettled: () => setConfirmSkip(false) })
        }}
      />

      <div className="flex justify-end"><ConnectionStatus connected={stream.connected} /></div>

      <section aria-label="Antrian menunggu" className="rounded-3xl border border-line bg-white p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-bold">Menunggu</h2>
          <span className="inline-flex items-center gap-2 text-sm text-muted"><Badge tone="accent">{waiting.length}</Badge> pelanggan</span>
        </div>
        {waiting.length === 0 ? (
          <p className="mt-3 text-sm text-body-muted">Belum ada pelanggan yang menunggu.</p>
        ) : (
          <ol className="mt-3 divide-y divide-line-soft">
            {waiting.map((ticket) => (
              <li key={ticket.id} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
                <span className="w-10 text-center text-2xl font-bold tabular-nums">{ticket.ticket_number}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{ticket.customer_name || 'Pelanggan'}</span>
                  <span className="block text-sm text-muted">{ticket.channel === 'offline' ? 'Datang langsung' : 'Pesan online'}</span>
                  {ticket.has_been_called && <span className="mt-1 inline-flex"><Badge tone="warning">Pernah dipanggil</Badge></span>}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  )
}
