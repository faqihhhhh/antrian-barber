import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, messageOf } from '../api/client'
import { useMe } from '../auth/useMe'
import { Alert, Button, Spinner } from '../components/ui'
import { formatDateTime, formatLongDate, formatRupiah } from '../lib/format'

export default function PemilikRefund() {
  const me = useMe()
  const queryClient = useQueryClient()
  const [tenantChoice, setTenantChoice] = useState('')
  const owners = me.data?.memberships.filter((item) => item.roles.includes('owner')) ?? []
  const tenantID = owners.some((item) => item.tenant_id === tenantChoice) ? tenantChoice : owners[0]?.tenant_id ?? ''
  const reports = useQuery({
    queryKey: ['owner-refund-reports', tenantID], enabled: !!tenantID,
    queryFn: async () => {
      const { data, error, response } = await api.GET('/v1/tenants/{tenantID}/refund-reports', { params: { path: { tenantID } } })
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
  })
  const markSent = useMutation({
    mutationFn: async (reportID: string) => {
      const { data, error, response } = await api.POST('/v1/tenants/{tenantID}/refund-reports/{reportID}/mark-sent', { params: { path: { tenantID, reportID } } })
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['owner-refund-reports', tenantID] }),
  })

  if (me.isPending) return <Spinner />
  if (me.isError) return <main className="mx-auto max-w-2xl px-5 py-10"><Alert>{messageOf(me.error)}</Alert></main>
  if (!tenantID) return <main className="mx-auto max-w-2xl px-5 py-10"><Alert tone="info">Akun ini belum menjadi owner bisnis.</Alert></main>

  return (
    <main className="mx-auto min-h-dvh max-w-3xl space-y-5 px-5 py-6">
      <header><h1 className="text-2xl font-bold">Laporan refund DP</h1><p className="mt-1 text-sm text-body-muted">Laporan dari pelanggan dengan tiket ber-DP yang belum diproses setelah hari sesi berakhir.</p></header>
      {owners.length > 1 && <label className="block"><span className="mb-1 block text-sm font-medium text-body">Bisnis</span><select aria-label="Bisnis" className="w-full rounded-xl border border-line-strong bg-white px-4 py-3 text-base" value={tenantID} onChange={(event) => setTenantChoice(event.target.value)}>{owners.map((item) => <option key={item.tenant_id} value={item.tenant_id}>{item.tenant_name}</option>)}</select></label>}
      {reports.isPending ? <Spinner /> : reports.isError ? <Alert>{messageOf(reports.error)}</Alert> : reports.data.length === 0 ? <Alert tone="info">Belum ada laporan refund dari pelanggan.</Alert> : (
        <section className="space-y-4" aria-label="Daftar laporan refund">
          {reports.data.map((item) => <article key={item.id} className="space-y-3 rounded-2xl border border-line bg-white p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-2"><div><h2 className="font-bold">Tiket #{item.ticket_number} · {item.outlet_name}</h2><p className="text-sm text-body-muted">Sesi {formatLongDate(item.session_date)} · dibuat {formatDateTime(item.ticket_created_at)}</p></div><strong className="tabular-nums">{formatRupiah(item.amount_rupiah)}</strong></div>
            <dl className="grid gap-2 text-sm sm:grid-cols-2"><div><dt className="text-body-muted">Pelanggan</dt><dd className="font-medium">{item.customer_name || item.customer_display_name || 'Nama tidak tersedia'}</dd></div><div><dt className="text-body-muted">Email</dt><dd className="break-all font-medium">{item.customer_email}</dd></div><div><dt className="text-body-muted">DP dibayar</dt><dd>{item.paid_at ? formatDateTime(item.paid_at) : 'Waktu tidak tersedia'} · {item.payment_method === 'midtrans' ? 'Midtrans' : 'Manual'}</dd></div><div><dt className="text-body-muted">Status tiket</dt><dd>{item.ticket_status === 'called' ? 'Dipanggil' : 'Menunggu'}</dd></div><div><dt className="text-body-muted">Posisi antrean sekarang</dt><dd>{item.queue_position}</dd></div><div><dt className="text-body-muted">Jumlah pernah dipanggil</dt><dd>{item.call_count} kali{item.first_called_at ? ` · pertama ${formatDateTime(item.first_called_at)}` : ''}{item.last_called_at ? ` · terakhir ${formatDateTime(item.last_called_at)}` : ''}</dd></div>{item.outlet_address && <div><dt className="text-body-muted">Alamat outlet</dt><dd>{item.outlet_address}</dd></div>}</dl>
            <div className="rounded-xl bg-paper-raised p-3"><p className="text-xs font-semibold text-body-muted">Komentar pelanggan · {formatDateTime(item.reported_at)}</p><p className="mt-1 whitespace-pre-wrap text-sm">{item.comment}</p></div>
            {item.refund_sent_at ? <Alert tone="success">Refund ditandai sudah dikirim pada {formatDateTime(item.refund_sent_at)}.</Alert> : <div className="space-y-2"><p className="text-xs text-body-muted">Pengembalian dilakukan manual di luar Trimwait.</p><Button type="button" loading={markSent.isPending && markSent.variables === item.id} disabled={markSent.isPending} onClick={() => markSent.mutate(item.id)}>Tandai refund sudah dikirim</Button></div>}
          </article>)}
          {markSent.isError && <Alert>{messageOf(markSent.error)}</Alert>}
        </section>
      )}
    </main>
  )
}
