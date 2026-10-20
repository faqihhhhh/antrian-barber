import { useState } from 'react'
import { useParams } from 'react-router'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, messageOf } from '../api/client'
import { useMe } from '../auth/useMe'
import { Alert, Button, ConfirmDialog, Field, RetryAlert, Spinner } from '../components/ui'
import type { components } from '../api/schema'
import { formatDateTime, formatLongDate, formatRupiah } from '../lib/format'

type Membership = components['schemas']['MembershipInfo']
type QueueSession = components['schemas']['QueueSession']
type PendingPayment = components['schemas']['PendingManualPayment']

const POLL_INTERVAL = 5_000
const TICKET_STATUS_LABEL: Record<string, string> = {
  pending_payment: 'Menunggu DP',
  waiting: 'Menunggu giliran',
  called: 'Dipanggil',
  in_progress: 'Sedang dilayani',
  completed: 'Selesai',
  canceled: 'Dibatalkan',
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

async function loadQueueSessions(tenantID: string, outletID: string): Promise<QueueSession[]> {
  const { data, error, response } = await api.GET('/v1/tenants/{tenantID}/outlets/{outletID}/queue-sessions', {
    params: { path: { tenantID, outletID } },
  })
  if (!response.ok || !data) throw new ApiError(error)
  return data
}

export default function Admin() {
  const me = useMe()
  const [outletChoice, setOutletChoice] = useState('')
  const [sessionChoice, setSessionChoice] = useState('')
  const { tenantId: routeTenantID, outletId: routeOutletID, sessionId: routeSessionID } = useParams()

  const memberships = (me.data?.memberships ?? []).filter((item) => item.roles.includes('owner') || item.roles.includes('admin'))
  const outlets = memberships.flatMap((membership) => membership.outlets.map((outlet) => ({ membership, outlet })))
  const sessionLookups = useQueries({
    queries: outlets.map(({ membership, outlet }) => ({
      queryKey: ['admin-sessions', membership.tenant_id, outlet.id],
      queryFn: () => loadQueueSessions(membership.tenant_id, outlet.id),
      enabled: !!routeSessionID && membership.tenant_id === routeTenantID,
    })),
  })
  const routeSessionLookupPending = !!routeSessionID && sessionLookups.some((query, index) =>
    outlets[index]?.membership.tenant_id === routeTenantID && query.isPending,
  )

  if (me.isPending) return <Spinner />
  if (me.isError) {
    return <main className="mx-auto max-w-md px-5 py-10"><RetryAlert onRetry={() => void me.refetch()}>{messageOf(me.error)}</RetryAlert></main>
  }
  if (routeSessionLookupPending) return <Spinner />

  const sessionOutletIndex = routeSessionID
    ? sessionLookups.findIndex((query) => query.data?.some((session) => session.id === routeSessionID))
    : -1
  const sessionOutlet = sessionOutletIndex >= 0 ? outlets[sessionOutletIndex] : undefined
  const routeOutlet = outlets.find(({ membership, outlet }) =>
    membership.tenant_id === routeTenantID && (!routeOutletID || outlet.id === routeOutletID),
  )
  const preferredOutlet = routeSessionID ? sessionOutlet ?? routeOutlet : routeOutlet
  const preferredKey = preferredOutlet ? `${preferredOutlet.membership.tenant_id}:${preferredOutlet.outlet.id}` : ''
  const selectedKey = preferredKey || (outlets.some(({ membership, outlet }) => `${membership.tenant_id}:${outlet.id}` === outletChoice)
    ? outletChoice
    : outlets[0] ? `${outlets[0].membership.tenant_id}:${outlets[0].outlet.id}` : '')
  const selected = outlets.find(({ membership, outlet }) => `${membership.tenant_id}:${outlet.id}` === selectedKey)

  return (
    <main className="mx-auto min-h-dvh max-w-4xl space-y-5 bg-paper px-5 py-6">
      <header>
        <h1 className="mt-1 text-2xl font-bold">Meja admin</h1>
      </header>

      {outlets.length === 0 ? (
        <Alert tone="info">Akun ini belum punya akses admin ke outlet. Hubungi owner bisnis untuk mengatur penugasan.</Alert>
      ) : (
        <>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-body">Outlet</span>
            <select
              aria-label="Outlet"
              className="w-full rounded-xl border border-line-strong bg-white px-4 py-3 text-base focus-visible:outline-2 focus-visible:outline-brand-ink"
              value={selectedKey}
              onChange={(event) => { setOutletChoice(event.target.value); setSessionChoice('') }}
            >
              {outlets.map(({ membership, outlet }) => {
                const key = `${membership.tenant_id}:${outlet.id}`
                return <option key={key} value={key}>{membership.tenant_name} · {outlet.name}</option>
              })}
            </select>
          </label>
          {selected && <PublicOutletLink membership={selected.membership} outlet={selected.outlet} />}
          {selected && <SessionPanel selected={selected} sessionChoice={routeSessionID ?? sessionChoice} onSessionChange={setSessionChoice} />}
        </>
      )}
    </main>
  )
}

function PublicOutletLink({ membership, outlet }: { membership: Membership; outlet: Membership['outlets'][number] }) {
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const isOwner = membership.roles.includes('owner')
  const outlets = useQuery({
    queryKey: ['admin-public-outlet-link', membership.tenant_id],
    enabled: isOwner,
    queryFn: async () => {
      const { data, error, response } = await api.GET('/v1/tenants/{tenantID}/outlets', {
        params: { path: { tenantID: membership.tenant_id } },
      })
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
  })
  if (!isOwner) {
    return <p className="rounded-xl bg-paper-raised px-4 py-3 text-sm text-body-muted">Minta owner bisnis membagikan tautan publik outlet ini.</p>
  }
  if (outlets.isPending) return <p className="text-sm text-muted" role="status">Memuat tautan publik…</p>
  if (outlets.isError) return <RetryAlert onRetry={() => void outlets.refetch()}>{messageOf(outlets.error)}</RetryAlert>
  const selectedOutlet = outlets.data.find((item) => item.id === outlet.id)
  if (!selectedOutlet) return <Alert>Data tautan outlet belum tersedia.</Alert>
  const publicURL = `${window.location.origin}/o/${selectedOutlet.slug}`
  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-white p-4">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">Tautan publik outlet</h2>
        <a href={publicURL} target="_blank" rel="noreferrer" className="mt-1 inline-flex min-h-11 max-w-full items-center break-all text-sm font-semibold text-brand-ink underline focus-visible:outline-2 focus-visible:outline-brand-ink">{publicURL}</a>
      </div>
      <Button
        type="button"
        variant="primary"
        className="w-full sm:w-auto"
        onClick={() => {
          if (!navigator.clipboard?.writeText) {
            setCopyFailed(true)
            return
          }
          void navigator.clipboard.writeText(publicURL)
            .then(() => { setCopied(true); setCopyFailed(false) })
            .catch(() => { setCopied(false); setCopyFailed(true) })
        }}
      >
        {copied ? 'Tersalin' : 'Salin tautan'}
      </Button>
      {copied && <span className="sr-only" role="status">Tautan outlet disalin.</span>}
      {copyFailed && <p className="w-full text-sm text-body-muted" role="status">Salin alamat tautan di atas secara manual.</p>}
    </section>
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
  const queryClient = useQueryClient()
  const [sessionDate, setSessionDate] = useState(() => dateInTimezone(selected.outlet.timezone))
  const [initialQuota, setInitialQuota] = useState('10')
  const sessions = useQuery({
    queryKey: ['admin-sessions', selected.membership.tenant_id, selected.outlet.id],
    queryFn: () => loadQueueSessions(selected.membership.tenant_id, selected.outlet.id),
    refetchInterval: POLL_INTERVAL,
  })

  const openSession = useMutation({
    mutationFn: async () => {
      const { data, error, response } = await api.POST('/v1/tenants/{tenantID}/outlets/{outletID}/queue-sessions', {
        params: { path: { tenantID: selected.membership.tenant_id, outletID: selected.outlet.id } },
        body: { session_date: sessionDate, max_quota: Number(initialQuota) },
      })
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
    onSuccess: async (createdSession) => {
      onSessionChange(createdSession.id)
      await queryClient.invalidateQueries({ queryKey: ['admin-sessions', selected.membership.tenant_id, selected.outlet.id] })
    },
  })

  const currentSession = sessions.data?.find((session) => session.id === sessionChoice)
    ?? sessions.data?.find((session) => session.status === 'open')
    ?? sessions.data?.[0]

  if (sessions.isPending) return <p className="py-6 text-center text-sm text-muted" role="status">Memuat sesi antrian…</p>
  if (sessions.isError) return <RetryAlert onRetry={() => void sessions.refetch()}>{messageOf(sessions.error)}</RetryAlert>

  const outletToday = dateInTimezone(selected.outlet.timezone)
  const validInitialQuota = Number.isInteger(Number(initialQuota)) && Number(initialQuota) > 0 && Number(initialQuota) <= 1000

  return (
    <div className="space-y-5">
      {currentSession ? (
        <>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-body">Sesi antrian</span>
            <select
              aria-label="Sesi antrian"
              className="w-full rounded-xl border border-line-strong bg-white px-4 py-3 text-base focus-visible:outline-2 focus-visible:outline-brand-ink"
              value={currentSession.id}
              onChange={(event) => onSessionChange(event.target.value)}
            >
              {sessions.data.map((session) => (
                <option key={session.id} value={session.id}>
                  {formatLongDate(session.session_date)} · Kuota {session.used_quota}/{session.max_quota} · {session.status === 'open' ? 'Dibuka' : 'Ditutup'}
                </option>
              ))}
            </select>
          </label>

          <div className="grid gap-5 lg:grid-cols-2">
            <PaymentPanel membership={selected.membership} session={currentSession} />
            <SettlementPanel membership={selected.membership} session={currentSession} />
          </div>

          <OfflineTicketPanel membership={selected.membership} session={currentSession} />
          {currentSession.status === 'open' ? (
            <CloseSessionControl membership={selected.membership} session={currentSession} />
          ) : (
            <Alert tone="info">Sesi sudah ditutup. Pelanggan tidak bisa membuat pesanan baru.</Alert>
          )}
        </>
      ) : (
        <Alert tone="info">Belum ada sesi antrian di outlet ini. Buka sesi baru untuk mulai menerima pelanggan.</Alert>
      )}

      <details className="group rounded-2xl border border-line-strong bg-white">
        <summary className="flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-2xl px-4 py-3 font-semibold focus-visible:outline-2 focus-visible:outline-brand-ink">
          Buka sesi baru
          <span aria-hidden="true" className="text-lg text-body-muted group-open:rotate-45">+</span>
        </summary>
        <form
          className="space-y-3 border-t border-line p-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (sessionDate && validInitialQuota) openSession.mutate()
          }}
        >
          <p className="text-sm text-body-muted">Buat sesi untuk tanggal layanan yang belum tersedia.</p>
          <Field
            label="Tanggal sesi"
            name="new-session-date"
            type="date"
            min={outletToday}
            value={sessionDate}
            onChange={(event) => setSessionDate(event.target.value)}
          />
          <Field
            label="Kuota awal"
            name="new-session-quota"
            type="number"
            min={1}
            max={1000}
            step={1}
            inputMode="numeric"
            value={initialQuota}
            onChange={(event) => setInitialQuota(event.target.value)}
            hint="Masukkan 1–1.000 tiket."
          />
          {openSession.isError && <Alert>{messageOf(openSession.error)}</Alert>}
          {openSession.isSuccess && <Alert tone="info">Sesi berhasil dibuka.</Alert>}
          <Button type="submit" loading={openSession.isPending} disabled={!sessionDate || !validInitialQuota}>
            Buka sesi
          </Button>
        </form>
      </details>
    </div>
  )
}

function CloseSessionControl({ membership, session }: { membership: Membership; session: QueueSession }) {
  const queryClient = useQueryClient()
  const [confirmClose, setConfirmClose] = useState(false)
  const closeSession = useMutation({
    mutationFn: async () => {
      const { data, error, response } = await api.POST('/v1/tenants/{tenantID}/queue-sessions/{sessionID}/close', {
        params: { path: { tenantID: membership.tenant_id, sessionID: session.id } },
      })
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-sessions', membership.tenant_id, session.outlet_id] })
    },
  })

  return (
    <section className="space-y-3 rounded-2xl border border-line bg-white p-4">
      <div>
        <h2 className="font-bold">Tutup sesi</h2>
        <p className="mt-1 text-sm text-body-muted">Selesaikan semua tiket dan pembayaran tertunda sebelum menutup sesi.</p>
      </div>
      {closeSession.isError && <Alert>{messageOf(closeSession.error)}</Alert>}
      <Button
        type="button"
        variant="secondary"
        className="w-full border-red-300 text-red-800 hover:bg-red-50 sm:w-auto"
        loading={closeSession.isPending}
        onClick={() => setConfirmClose(true)}
      >
        Tutup sesi antrian
      </Button>
      <ConfirmDialog
        open={confirmClose}
        title="Tutup sesi antrian?"
        description="Tiket yang masih menunggu pembayaran atau layanan harus diselesaikan terlebih dahulu."
        confirmLabel="Tutup sesi"
        loading={closeSession.isPending}
        onCancel={() => setConfirmClose(false)}
        onConfirm={() => closeSession.mutate(undefined, { onSettled: () => setConfirmClose(false) })}
      />
    </section>
  )
}

function OfflineTicketPanel({ membership, session }: { membership: Membership; session: QueueSession }) {
  const [customerName, setCustomerName] = useState('')
  const [quotaBy, setQuotaBy] = useState('')
  const queryClient = useQueryClient()
  const tickets = useQuery({
    queryKey: ['admin-tickets', membership.tenant_id, session.id],
    queryFn: async (): Promise<components['schemas']['QueueTicket'][]> => {
      const { data, error, response } = await api.GET('/v1/tenants/{tenantID}/queue-sessions/{sessionID}/tickets', {
        params: { path: { tenantID: membership.tenant_id, sessionID: session.id } },
      })
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
    refetchInterval: POLL_INTERVAL,
  })
  const addTicket = useMutation({
    mutationFn: async (name: string) => {
      const { data, error, response } = await api.POST('/v1/tenants/{tenantID}/queue-sessions/{sessionID}/tickets', {
        params: { path: { tenantID: membership.tenant_id, sessionID: session.id } },
        body: { customer_name: name },
      })
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
    onSuccess: async () => {
      setCustomerName('')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-tickets', membership.tenant_id, session.id] }),
        queryClient.invalidateQueries({ queryKey: ['admin-sessions', membership.tenant_id] }),
      ])
    },
  })
  const increaseQuota = useMutation({
    mutationFn: async (by: number) => {
      const { data, error, response } = await api.POST('/v1/tenants/{tenantID}/queue-sessions/{sessionID}/increase-quota', {
        params: { path: { tenantID: membership.tenant_id, sessionID: session.id } },
        body: { by },
      })
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
    onSuccess: async () => {
      setQuotaBy('')
      await queryClient.invalidateQueries({ queryKey: ['admin-sessions', membership.tenant_id, session.outlet_id] })
    },
  })
  const quotaFull = session.used_quota >= session.max_quota
  const recentTickets = [...(tickets.data ?? [])].reverse().slice(0, 5)
  const quotaValue = Number(quotaBy)
  const validQuotaIncrease = Number.isInteger(quotaValue) && quotaValue > 0 && quotaValue <= 1000

  return (
    <section aria-label="Tiket pelanggan datang langsung" className="space-y-3 border-t border-line pt-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold">Pelanggan datang langsung</h2>
        <span className="text-sm text-body-muted">Sisa kuota {Math.max(0, session.max_quota - session.used_quota)}</span>
      </div>
      {session.status !== 'open' && <Alert tone="info">Sesi ditutup. Buka sesi untuk menambah tiket.</Alert>}
      {quotaFull && session.status === 'open' && <Alert tone="info">Kuota sesi penuh. Tambah kuota sebelum membuat tiket lagi.</Alert>}
      <form
        className="space-y-3 rounded-2xl border border-line bg-white p-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (validQuotaIncrease) increaseQuota.mutate(quotaValue)
        }}
      >
        <Field
          label="Tambahan kuota"
          name="quota-increase"
          type="number"
          min={1}
          max={1000}
          step={1}
          inputMode="numeric"
          value={quotaBy}
          onChange={(event) => setQuotaBy(event.target.value)}
          hint="Masukkan jumlah kursi tambahan, maksimal 1.000 per aksi."
        />
        {increaseQuota.isError && <Alert>{messageOf(increaseQuota.error)}</Alert>}
        {increaseQuota.isSuccess && <Alert tone="info">Kuota berhasil ditambahkan.</Alert>}
        <Button type="submit" loading={increaseQuota.isPending} disabled={!validQuotaIncrease || session.status !== 'open'}>
          Tambah kuota sesi
        </Button>
      </form>
      <form
        className="space-y-3 rounded-2xl border border-line bg-white p-4"
        onSubmit={(event) => {
          event.preventDefault()
          const name = customerName.trim()
          if (name) addTicket.mutate(name)
        }}
      >
        <Field
          label="Nama pelanggan"
          name="offline-customer-name"
          autoComplete="off"
          maxLength={60}
          value={customerName}
          onChange={(event) => setCustomerName(event.target.value)}
          placeholder="Contoh: Budi"
        />
        {addTicket.isError && <Alert>{messageOf(addTicket.error)}</Alert>}
        {addTicket.isSuccess && <Alert tone="info">Tiket #{addTicket.data.ticket_number} berhasil ditambahkan.</Alert>}
        <Button
          type="submit"
          loading={addTicket.isPending}
          disabled={!customerName.trim() || quotaFull || session.status !== 'open'}
        >
          Tambahkan ke antrean
        </Button>
      </form>

      {tickets.isPending ? (
        <p className="py-3 text-center text-sm text-muted" role="status">Memuat tiket sesi…</p>
      ) : tickets.isError ? (
        <Alert>{messageOf(tickets.error)}</Alert>
      ) : recentTickets.length > 0 ? (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-white px-4">
          {recentTickets.map((ticket) => (
            <li key={ticket.id} className="flex items-center justify-between gap-3 py-3 text-sm">
              <span><strong>#{ticket.ticket_number}</strong> · {ticket.customer_name || 'Pelanggan'}</span>
              <span className="shrink-0 text-muted">{TICKET_STATUS_LABEL[ticket.status] ?? ticket.status}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">Belum ada tiket di sesi ini.</p>
      )}
    </section>
  )
}

function PaymentPanel({ membership, session }: { membership: Membership; session: QueueSession }) {
  const queryClient = useQueryClient()
  const outletTimezone = membership.outlets.find((outlet) => outlet.id === session.outlet_id)?.timezone
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

  if (payments.isPending) return <p className="py-6 text-center text-sm text-muted" role="status">Memuat DP yang menunggu…</p>
  if (payments.isError) return <RetryAlert onRetry={() => void payments.refetch()}>{messageOf(payments.error)}</RetryAlert>

  return (
    <section aria-label="DP menunggu konfirmasi" className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">DP menunggu konfirmasi</h2>
        <span className="rounded-full bg-paper-raised px-3 py-1 text-sm font-semibold">{payments.data.length}</span>
      </div>
      {confirm.isError && <Alert>{messageOf(confirm.error)}</Alert>}
      {payments.data.length === 0 ? (
        <Alert tone="info">Tidak ada DP manual yang menunggu di sesi ini.</Alert>
      ) : payments.data.map((payment) => (
        <article key={payment.ticket_id} className="space-y-3 rounded-3xl border border-line bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Tiket #{payment.ticket_number}</p>
              <h3 className="mt-1 text-lg font-bold">{payment.customer_name || 'Pelanggan'}</h3>
            </div>
            <p className="text-right text-lg font-bold tabular-nums">{formatRupiah(payment.amount_rupiah)}</p>
          </div>
          <dl className="grid grid-cols-2 gap-2 rounded-xl bg-paper p-3 text-sm">
            <div><dt className="text-muted">Kode cocok</dt><dd className="font-semibold">{payment.match_code}</dd></div>
            <div><dt className="text-muted">Kode unik</dt><dd className="font-semibold">{payment.unique_code ?? '—'}</dd></div>
          </dl>
          <p className="text-xs text-muted">Batas bayar {formatDateTime(payment.expires_at, outletTimezone)}</p>
          <Button
            type="button"
            loading={confirm.isPending && confirm.variables === payment.ticket_id}
            disabled={confirm.isPending}
            onClick={() => confirm.mutate(payment.ticket_id)}
          >
            Konfirmasi DP dan masukkan ke antrean
          </Button>
          {confirm.isSuccess && confirm.variables === payment.ticket_id && (
            <p className="text-sm text-body-muted" role="status">DP dikonfirmasi. Data tiket akan diperbarui otomatis.</p>
          )}
        </article>
      ))}
    </section>
  )
}

function SettlementPanel({ membership, session }: { membership: Membership; session: QueueSession }) {
  const queryClient = useQueryClient()
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [pendingSettlement, setPendingSettlement] = useState<{ ticketID: string; amount: number; ticketNumber: number } | null>(null)
  const queryKey = ['admin-awaiting-settlement', membership.tenant_id, session.id] as const
  const tickets = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error, response } = await api.GET('/v1/tenants/{tenantID}/queue-sessions/{sessionID}/awaiting-settlement', {
        params: { path: { tenantID: membership.tenant_id, sessionID: session.id } },
      })
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
    refetchInterval: POLL_INTERVAL,
  })
  const confirm = useMutation({
    mutationFn: async ({ ticketID, amount }: { ticketID: string; amount: number }) => {
      const { data, error, response } = await api.POST('/v1/tenants/{tenantID}/tickets/{ticketID}/confirm-final-payment', {
        params: { path: { tenantID: membership.tenant_id, ticketID } },
        body: { total_amount_rupiah: amount },
      })
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey })
      await queryClient.invalidateQueries({ queryKey: ['admin-tickets', membership.tenant_id, session.id] })
    },
  })

  if (tickets.isPending) return <p className="py-4 text-center text-sm text-muted" role="status">Memuat pelunasan…</p>
  if (tickets.isError) return <RetryAlert onRetry={() => void tickets.refetch()}>{messageOf(tickets.error)}</RetryAlert>

  return (
    <section aria-label="Pelunasan menunggu konfirmasi" className="space-y-3 border-t border-line pt-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold">Konfirmasi pelunasan</h2>
        <span className="rounded-full bg-paper-raised px-3 py-1 text-sm font-semibold">{tickets.data.length}</span>
      </div>
      {confirm.isError && <Alert>{messageOf(confirm.error)}</Alert>}
      {tickets.data.length === 0 ? (
        <Alert tone="info">Belum ada tiket selesai yang menunggu pelunasan.</Alert>
      ) : tickets.data.map((ticket) => {
        const rawAmount = amounts[ticket.id] ?? ''
        const amount = Number(rawAmount)
        const validAmount = Number.isSafeInteger(amount) && amount > 0
        return (
          <form
            key={ticket.id}
            className="space-y-3 rounded-2xl border border-line bg-white p-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (!validAmount || confirm.isPending) return
              setPendingSettlement({ ticketID: ticket.id, amount, ticketNumber: ticket.ticket_number })
            }}
          >
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Tiket #{ticket.ticket_number}</p>
              <p className="mt-1 font-semibold">{ticket.customer_name || 'Pelanggan'}</p>
            </div>
            <Field
              label="Total pembayaran akhir (rupiah)"
              name={`settlement-${ticket.id}`}
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={rawAmount}
              onChange={(event) => setAmounts((current) => ({ ...current, [ticket.id]: event.target.value }))}
              hint="Masukkan jumlah yang benar-benar dibayar pelanggan."
            />
            <Button type="submit" loading={confirm.isPending && confirm.variables?.ticketID === ticket.id} disabled={!validAmount || confirm.isPending}>
              Konfirmasi pelunasan
            </Button>
            {confirm.isSuccess && confirm.variables.ticketID === ticket.id && (
              <p className="text-sm text-body-muted" role="status">Pelunasan tercatat: {confirm.data.message}.</p>
            )}
          </form>
        )
      })}
      <ConfirmDialog
        open={pendingSettlement !== null}
        title="Konfirmasi pelunasan?"
        description={pendingSettlement ? `Tiket #${pendingSettlement.ticketNumber} akan ditandai lunas sebesar ${formatRupiah(pendingSettlement.amount)}.` : ''}
        confirmLabel="Konfirmasi pelunasan"
        loading={confirm.isPending}
        onCancel={() => setPendingSettlement(null)}
        onConfirm={() => {
          if (pendingSettlement) confirm.mutate(pendingSettlement, { onSettled: () => setPendingSettlement(null) })
        }}
      />
    </section>
  )
}
