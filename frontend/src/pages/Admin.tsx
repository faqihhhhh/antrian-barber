import { useState } from 'react'
import { useParams } from 'react-router'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, messageOf } from '../api/client'
import { useMe } from '../auth/useMe'
import { Alert, Badge, Button, ConfirmDialog, Field, RetryAlert, Spinner } from '../components/ui'
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
    <main className="mx-auto min-h-dvh max-w-4xl space-y-4 bg-paper px-5 py-4 sm:space-y-5 sm:py-6">
      <header>
        <h1 className="mt-1 text-2xl font-bold">Meja admin</h1>
      </header>

      {outlets.length === 0 ? (
        <Alert tone="info">Akun ini belum punya akses admin ke outlet. Hubungi owner bisnis untuk mengatur penugasan.</Alert>
      ) : (
        <>
          <div className="grid items-end gap-2 sm:grid-cols-2 sm:gap-3">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-body">Outlet</span>
              <select
                aria-label="Outlet"
                className="w-full rounded-xl border border-line-strong bg-white px-4 py-3 text-base focus-visible:outline-2 focus-visible:outline-brand-ink"
                value={selectedKey}
                onChange={(event) => setOutletChoice(event.target.value)}
              >
                {outlets.map(({ membership, outlet }) => {
                  const key = `${membership.tenant_id}:${outlet.id}`
                  return <option key={key} value={key}>{membership.tenant_name} · {outlet.name}</option>
                })}
              </select>
            </label>
            {selected && <SessionPanel key={`${selectedKey}:${routeSessionID ?? ''}`} selected={selected} routeSessionID={routeSessionID} />}
          </div>
          {selected && (
            <details className="rounded-2xl border border-line bg-white">
              <summary className="min-h-11 cursor-pointer px-4 py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-brand-ink">Tautan publik outlet</summary>
              <div className="border-t border-line p-3"><PublicOutletLink membership={selected.membership} outlet={selected.outlet} /></div>
            </details>
          )}
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
  routeSessionID,
}: {
  selected: { membership: Membership; outlet: Membership['outlets'][number] }
  routeSessionID?: string
}) {
  const queryClient = useQueryClient()
  const today = dateInTimezone(selected.outlet.timezone)
  const [dateChoice, setDateChoice] = useState('')
  const [sessionDate, setSessionDate] = useState(today)
  const [monthChoice, setMonthChoice] = useState('')
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
      setDateChoice(createdSession.session_date)
      setSessionDate(createdSession.session_date)
      setMonthChoice(monthStart(createdSession.session_date))
      await queryClient.invalidateQueries({ queryKey: ['admin-sessions', selected.membership.tenant_id, selected.outlet.id] })
    },
  })

  const routedSession = sessions.data?.find((session) => session.id === routeSessionID)
  const selectedDate = dateChoice || routedSession?.session_date || today
  const visibleMonth = monthChoice || monthStart(routedSession && !dateChoice ? routedSession.session_date : selectedDate)
  const currentSession = sessions.data?.find((session) => session.session_date === selectedDate)

  if (sessions.isPending) return <p className="py-6 text-center text-sm text-muted" role="status">Memuat sesi antrian…</p>
  if (sessions.isError) return <RetryAlert onRetry={() => void sessions.refetch()}>{messageOf(sessions.error)}</RetryAlert>

  const validInitialQuota = Number.isInteger(Number(initialQuota)) && Number(initialQuota) > 0 && Number(initialQuota) <= 1000

  return (
    <>
      <section className="col-span-full space-y-3 rounded-2xl border border-line bg-white p-4" aria-label="Kalender sesi antrian">
        <div>
          <h2 className="font-bold">Pilih tanggal sesi</h2>
          <p className="mt-1 text-sm text-body-muted">Titik menandai tanggal yang sudah memiliki sesi. Pilih tanggal untuk melihat antreannya.</p>
        </div>
        <SessionCalendar
          sessions={sessions.data}
          selectedDate={selectedDate}
          visibleMonth={visibleMonth}
          onMonthChange={setMonthChoice}
          onDateSelect={(date) => {
            setDateChoice(date)
            setSessionDate(date)
            setMonthChoice(monthStart(date))
          }}
        />
      </section>

      {currentSession ? (
        <>
          <section className="col-span-full flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-white p-4" aria-label="Ringkasan sesi terpilih">
            <div>
              <h2 className="font-bold">{formatLongDate(currentSession.session_date)}</h2>
              <p className="mt-1 text-sm text-body-muted">Kuota terpakai {currentSession.used_quota} dari {currentSession.max_quota}</p>
            </div>
            <Badge tone={currentSession.status === 'open' ? 'success' : 'neutral'}>{currentSession.status === 'open' ? 'Dibuka' : 'Ditutup'}</Badge>
          </section>
          <section aria-label="Perlu tindakan" className="col-span-full space-y-4 sm:space-y-5">
            <h2 className="text-lg font-bold">Perlu tindakan</h2>
            <div className="grid gap-5 lg:grid-cols-2">
              <PaymentPanel membership={selected.membership} session={currentSession} />
              <SettlementPanel membership={selected.membership} session={currentSession} />
            </div>
            <OfflineTicketPanel membership={selected.membership} session={currentSession} />
          </section>

          <QueueListPanel membership={selected.membership} session={currentSession} />
          {currentSession.status === 'open' ? <CloseSessionControl membership={selected.membership} session={currentSession} /> : (
            <Alert tone="info">Sesi sudah ditutup. Pelanggan tidak bisa membuat pesanan baru.</Alert>
          )}
        </>
      ) : (
        <div className="col-span-full"><Alert tone="info">Belum ada sesi pada {formatLongDate(selectedDate)}. Pilih tanggal lain atau buka sesi baru untuk tanggal ini.</Alert></div>
      )}

      <details open={!currentSession || currentSession.status !== 'open'} className="col-span-full group rounded-2xl border border-line-strong bg-white">
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
            min={today}
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
    </>
  )
}

const WEEKDAYS = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']

function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`
}

function shiftMonth(date: string, amount: number): string {
  const parsed = new Date(`${monthStart(date)}T00:00:00Z`)
  parsed.setUTCMonth(parsed.getUTCMonth() + amount)
  return parsed.toISOString().slice(0, 10)
}

function SessionCalendar({
  sessions,
  selectedDate,
  visibleMonth,
  onMonthChange,
  onDateSelect,
}: {
  sessions: QueueSession[]
  selectedDate: string
  visibleMonth: string
  onMonthChange: (month: string) => void
  onDateSelect: (date: string) => void
}) {
  const firstDay = new Date(`${monthStart(visibleMonth)}T00:00:00Z`)
  const year = firstDay.getUTCFullYear()
  const month = firstDay.getUTCMonth()
  const dayCount = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const leadingDays = (firstDay.getUTCDay() + 6) % 7
  const monthLabel = firstDay.toLocaleDateString('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const sessionsByDate = new Map(sessions.map((session) => [session.session_date, session]))
  const days = [
    ...Array.from({ length: leadingDays }, (_, index) => ({ key: `empty-${index}`, date: '', day: 0 })),
    ...Array.from({ length: dayCount }, (_, index) => {
      const day = index + 1
      const date = `${visibleMonth.slice(0, 7)}-${String(day).padStart(2, '0')}`
      return { key: date, date, day }
    }),
  ]

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <Button type="button" variant="secondary" className="w-11 px-0" aria-label="Bulan sebelumnya" onClick={() => onMonthChange(shiftMonth(visibleMonth, -1))}>‹</Button>
        <h3 className="text-sm font-semibold capitalize" aria-live="polite">{monthLabel}</h3>
        <Button type="button" variant="secondary" className="w-11 px-0" aria-label="Bulan berikutnya" onClick={() => onMonthChange(shiftMonth(visibleMonth, 1))}>›</Button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((weekday) => <span key={weekday} className="py-2 text-xs font-medium text-body-muted">{weekday}</span>)}
        {days.map(({ key, date, day }) => {
          if (!date) return <span key={key} aria-hidden="true" />
          const session = sessionsByDate.get(date)
          const selected = date === selectedDate
          return (
            <button
              key={key}
              type="button"
              aria-label={`${day} ${monthLabel}${session ? `, sesi ${session.status === 'open' ? 'dibuka' : 'ditutup'}, kuota ${session.used_quota} dari ${session.max_quota}` : ', belum ada sesi'}`}
              aria-pressed={selected}
              onClick={() => onDateSelect(date)}
              className={`relative mx-auto flex min-h-11 w-full max-w-12 flex-col items-center justify-center rounded-xl text-sm focus-visible:outline-2 focus-visible:outline-brand-ink ${selected ? 'bg-ink font-semibold text-white' : 'text-ink hover:bg-paper-raised'}`}
            >
              {day}
              {session && <span aria-hidden="true" className={`mt-0.5 h-1.5 w-1.5 rounded-full ${selected ? 'bg-white' : session.status === 'open' ? 'bg-emerald-600' : 'bg-muted'}`} />}
            </button>
          )
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-body-muted">
        <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-600" /> Sesi dibuka</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-muted" /> Sesi ditutup</span>
      </div>
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
  const quotaValue = Number(quotaBy)
  const validQuotaIncrease = Number.isInteger(quotaValue) && quotaValue > 0 && quotaValue <= 1000

  return (
    <section aria-label="Pelanggan datang langsung" className="space-y-3 border-t border-line pt-5">
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

    </section>
  )
}

function QueueListPanel({ membership, session }: { membership: Membership; session: QueueSession }) {
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
  const recentTickets = [...(tickets.data ?? [])].reverse().slice(0, 5)

  return (
    <section aria-label="Daftar antrean yang sedang berjalan" className="col-span-full space-y-3 border-t border-line pt-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold">Antrean saat ini</h2>
        <span className="text-sm text-body-muted">{tickets.data?.length ?? '…'} tiket</span>
      </div>
      {tickets.isPending ? (
        <p className="py-3 text-center text-sm text-muted" role="status">Memuat tiket sesi…</p>
      ) : tickets.isError ? (
        <Alert>{messageOf(tickets.error)}</Alert>
      ) : recentTickets.length > 0 ? (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-white px-4">
          {recentTickets.map((ticket) => (
            <li key={ticket.id} className="flex items-center justify-between gap-3 py-3 text-sm">
              <span className="min-w-0">
                <span className="block truncate"><strong>#{ticket.ticket_number}</strong> · {ticket.customer_name || 'Pelanggan'}</span>
                {ticket.has_been_called && <span className="mt-1 inline-flex"><Badge tone="warning">Pernah dipanggil</Badge></span>}
              </span>
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
        <Badge tone="accent">{payments.data.length}</Badge>
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
            <div className="text-right">
              <p className="text-lg font-bold tabular-nums">{formatRupiah(payment.amount_rupiah)}</p>
              <p className="mt-1 text-xs text-muted">Tiga digit terakhir adalah kode unik pembayaran: {payment.unique_code ?? '—'}.</p>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-2 rounded-xl bg-paper p-3 text-sm">
            <div><dt className="text-muted">Kode untuk kapster</dt><dd className="font-semibold">{payment.match_code}</dd></div>
            <div><dt className="text-muted">Kode unik pembayaran</dt><dd className="font-semibold">{payment.unique_code ?? '—'}</dd></div>
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
        <Badge tone="accent">{tickets.data.length}</Badge>
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
