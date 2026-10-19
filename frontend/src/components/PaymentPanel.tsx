import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { api, ApiError, messageOf } from '../api/client'
import { useNow } from '../hooks/useNow'
import { MY_TICKETS_KEY, type MyTicket } from '../hooks/useMyTickets'
import { formatCountdown, formatRupiah } from '../lib/format'
import { Alert, Button } from './ui'

// Layar bayar DP. Dua cara, tampilannya hampir sama:
// - midtrans: QR dibuat Midtrans khusus tiket ini, status berubah otomatis.
// - manual: QRIS statis milik owner, nominal sudah memuat kode unik, admin mengonfirmasi.
export default function PaymentPanel({ ticket }: { ticket: MyTicket }) {
  const queryClient = useQueryClient()
  const now = useNow(1000)
  const [imageFailed, setImageFailed] = useState(false)
  const recheck = useMutation({
    mutationFn: async () => {
      const { data, error, response } = await api.POST('/v1/tenants/{tenantID}/tickets/{ticketID}/recheck-payment', {
        params: { path: { tenantID: ticket.tenant_id, ticketID: ticket.ticket_id } },
      })
      if (!response.ok || !data) throw new ApiError(error)
      return data.status
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: MY_TICKETS_KEY }),
  })

  const payment = ticket.payment
  const remaining = payment ? new Date(payment.expires_at).getTime() - now : 0
  const expired = remaining <= 0
  const paymentMethod = payment?.method
  const paymentStatus = payment?.status
  const paymentExpiresAt = payment?.expires_at
  const recheckPending = recheck.isPending
  const recheckPayment = recheck.mutate
  useEffect(() => {
    if (paymentMethod !== 'midtrans' || paymentStatus !== 'pending' || expired) return
    const checkIfVisible = () => {
      if (document.visibilityState === 'visible' && !recheckPending) recheckPayment()
    }
    const interval = window.setInterval(checkIfVisible, 8_000)
    document.addEventListener('visibilitychange', checkIfVisible)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', checkIfVisible)
    }
  }, [paymentMethod, paymentStatus, paymentExpiresAt, expired, recheckPending, recheckPayment])

  if (!payment) return <Alert tone="info">Data pembayaran tiket ini belum tersedia. Muat ulang halaman sebentar lagi.</Alert>

  const isManual = payment.method === 'manual'
  const qrSrc = isManual ? `/v1/me/tickets/${ticket.ticket_id}/qris-image` : payment.qr_code_url

  return (
    <section className="space-y-4" aria-label="Pembayaran DP">
      <div className="rounded-3xl border border-line bg-white p-6 text-center">
        <p className="text-sm text-body-muted">Bayar DP sebesar</p>
        <p className="mt-1 text-4xl font-bold tabular-nums">{formatRupiah(payment.amount_rupiah)}</p>
        {isManual && (
          <p className="mt-2 text-sm text-body-muted">
            Bayar tepat sesuai angka ini, termasuk tiga angka terakhir. Angka itulah yang dipakai admin untuk mengenali
            pembayaran Anda.
          </p>
        )}

        <div className="mx-auto mt-5 flex aspect-square w-full max-w-64 items-center justify-center rounded-2xl border border-line bg-white p-2">
          {qrSrc && !imageFailed ? (
            <img src={qrSrc} alt="Kode QRIS untuk membayar DP" className="h-full w-full object-contain" onError={() => setImageFailed(true)} />
          ) : (
            <p className="px-4 text-sm text-body-muted">Gambar QRIS tidak bisa dimuat. Muat ulang halaman ini.</p>
          )}
        </div>

        <p className="mt-4 text-sm text-body-muted" role="timer">
          {expired ? (
            <strong>Waktu pembayaran habis</strong>
          ) : (
            <>
              Selesaikan dalam <strong className="tabular-nums">{formatCountdown(remaining)}</strong>
            </>
          )}
        </p>
      </div>

      {expired ? (
        <>
          <Alert tone="info">
            Pesanan yang tidak dibayar tepat waktu dibatalkan otomatis dan kuotanya dikembalikan. Pesan ulang kalau masih
            ingin antri.
          </Alert>
          <Link
            to={`/o/${ticket.outlet_slug}`}
            className="inline-flex w-full items-center justify-center rounded-xl bg-ink px-4 py-3 text-sm font-semibold text-white"
          >
            Pesan ulang
          </Link>
        </>
      ) : (
        <>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-body">
            <li>Buka aplikasi e-wallet atau mobile banking yang mendukung QRIS.</li>
            <li>Scan kode di atas. Di HP yang sama, simpan gambar QR lalu pilih dari galeri di aplikasi pembayaran.</li>
            <li>Kembali ke halaman ini dan tekan tombol di bawah.</li>
          </ol>

          {recheck.isError && <Alert>{messageOf(recheck.error)}</Alert>}
          {recheck.isSuccess && recheck.data === 'pending' && (
            <Alert tone="info">
              {isManual
                ? 'Pembayaran belum dikonfirmasi admin. Halaman ini berubah sendiri begitu admin mengonfirmasi.'
                : 'Pembayaran belum terdeteksi. Tunggu beberapa detik, lalu tekan tombol lagi.'}
            </Alert>
          )}
          {recheck.isSuccess && recheck.data === 'failed' && <Alert>Pembayaran gagal atau dibatalkan. Pesan ulang untuk mencoba lagi.</Alert>}

          <Button type="button" loading={recheck.isPending} onClick={() => recheck.mutate()}>
            Saya sudah bayar
          </Button>
        </>
      )}
    </section>
  )
}
