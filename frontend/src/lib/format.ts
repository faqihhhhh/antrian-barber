const rupiah = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 })

// 15000 -> "Rp 15.000"
export function formatRupiah(n: number): string {
  return rupiah.format(n).replace(/ /g, ' ')
}

// Tanggal dari API berbentuk "2026-10-13" (tanggal lokal outlet, tanpa jam).
// Dibaca sebagai UTC lalu ditampilkan sebagai UTC supaya tidak bergeser
// ke hari lain karena zona waktu perangkat.
function dateOnly(date: string): Date | '' {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return ''
  const parsed = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return ''
  return parsed
}

export function formatLongDate(date: string): string {
  const parsed = dateOnly(date)
  if (!parsed) return ''
  return parsed.toLocaleDateString('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export function formatMonthYear(date: string): string {
  const parsed = dateOnly(date)
  if (!parsed) return ''
  return parsed.toLocaleDateString('id-ID', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export function timezoneLabel(timezone: string): string {
  if (timezone === 'Asia/Jakarta') return 'WIB'
  if (timezone === 'Asia/Makassar') return 'WITA'
  if (timezone === 'Asia/Jayapura') return 'WIT'
  return timezone
}

export function formatDateTime(dateTime: string, timezone?: string): string {
  const date = new Date(dateTime)
  const zone = timezone ? { timeZone: timezone } : {}
  const formatted = `${date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', ...zone })}, ${date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', ...zone })}`
  return timezone ? `${formatted} ${timezoneLabel(timezone)}` : formatted
}

export function weekdayShort(date: string): string {
  const parsed = dateOnly(date)
  if (!parsed) return ''
  return parsed.toLocaleDateString('id-ID', { weekday: 'short', timeZone: 'UTC' })
}

export function dayOfMonth(date: string): string {
  const parsed = dateOnly(date)
  if (!parsed) return ''
  return parsed.toLocaleDateString('id-ID', { day: 'numeric', timeZone: 'UTC' })
}

// Estimasi sengaja dibulatkan ke atas per 5 menit. Angka seperti "13 menit"
// terkesan pasti, padahal hanya perkiraan.
export function formatWait(minutes: number, activeKapsters: number): string {
  if (activeKapsters <= 0) return 'Belum bisa dihitung, belum ada kapster yang aktif'
  if (minutes <= 0) return 'Tidak perlu menunggu'
  if (minutes < 5) return 'Kurang dari 5 menit'
  return `Sekitar ${Math.ceil(minutes / 5) * 5} menit`
}

// 125000 ms -> "02:05"
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export const TICKET_STATUS_LABEL: Record<string, string> = {
  pending_payment: 'Menunggu pembayaran',
  waiting: 'Menunggu giliran',
  called: 'Dipanggil',
  in_progress: 'Sedang dilayani',
  completed: 'Selesai',
  canceled: 'Dibatalkan',
}

export function isActiveStatus(status: string): boolean {
  return status === 'pending_payment' || status === 'waiting' || status === 'called' || status === 'in_progress'
}
