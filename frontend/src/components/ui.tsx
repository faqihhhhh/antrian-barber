import { useEffect, useId, useRef, useState } from 'react'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import { Link } from 'react-router'
import { Logo } from './Logo'

type ButtonStyle = 'primary' | 'secondary' | 'ghost'
type SharedButtonProps = { variant?: ButtonStyle; loading?: boolean; className?: string; children: ReactNode }
type ButtonProps = SharedButtonProps &
  ({ to: string; state?: unknown } | (ButtonHTMLAttributes<HTMLButtonElement> & { to?: never; state?: never }))

const buttonBase =
  'inline-flex min-h-11 w-full items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold transition focus:outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ink focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60'

const buttonStyles: Record<ButtonStyle, string> = {
  primary: 'bg-ink text-white hover:bg-ink-hover',
  secondary: 'border border-line-strong bg-white text-ink hover:bg-paper-raised',
  ghost: 'bg-transparent text-body hover:bg-paper-raised',
}

export function Button(props: ButtonProps) {
  const { variant = 'primary', className = '', children } = props
  const classes = `${buttonBase} ${buttonStyles[variant]} ${className}`

  if ('to' in props) {
    return (
      <Link to={props.to} state={props.state} className={classes}>
        {children}
      </Link>
    )
  }

  const { loading, disabled, ...rest } = props
  return (
    <button className={classes} disabled={disabled || loading} {...rest}>
      {loading ? 'Memproses…' : children}
    </button>
  )
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  loading = false,
  onCancel,
  onConfirm,
}: {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  loading?: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleID = useId()
  const descriptionID = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleID}
      aria-describedby={descriptionID}
      onCancel={(event) => {
        event.preventDefault()
        if (!loading) onCancel()
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-line bg-paper p-0 text-ink shadow-2xl backdrop:bg-ink/50"
    >
      <div className="space-y-4 p-5">
        <div>
          <h2 id={titleID} className="text-lg font-bold">{title}</h2>
          <p id={descriptionID} className="mt-2 text-sm leading-6 text-body-muted">{description}</p>
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" disabled={loading} onClick={onCancel} className="sm:w-auto">Batal</Button>
          <Button type="button" loading={loading} onClick={onConfirm} className="sm:w-auto">{confirmLabel}</Button>
        </div>
      </div>
    </dialog>
  )
}

type FieldProps = InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }

// Ukuran teks input 16px mencegah iPhone memperbesar layar saat fokus.
export function Field({
  label,
  hint,
  error,
  id,
  type = 'text',
  className = '',
  'aria-describedby': existingDescription,
  'aria-invalid': existingInvalid,
  ...rest
}: FieldProps) {
  const generatedID = useId()
  const inputID = id ?? rest.name ?? generatedID
  const hintID = `${inputID}-hint`
  const errorID = `${inputID}-error`
  const [revealed, setRevealed] = useState(false)
  const isPassword = type === 'password'
  const describedBy = [existingDescription, hint ? hintID : undefined, error ? errorID : undefined]
    .filter(Boolean)
    .join(' ') || undefined

  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-body" htmlFor={inputID}>
        {label}
      </label>
      <div className="relative">
        <input
          id={inputID}
          type={isPassword && revealed ? 'text' : type}
          aria-describedby={describedBy}
          aria-invalid={error ? true : existingInvalid}
          className={`w-full rounded-xl border border-line-strong bg-white px-4 py-3 text-base text-ink outline-none placeholder:text-muted focus-visible:border-brand-ink focus-visible:ring-2 focus-visible:ring-brand-ink ${isPassword ? 'pr-24' : ''} ${className}`}
          {...rest}
        />
        {isPassword && (
          <button
            type="button"
            className="absolute inset-y-0 right-1 my-auto min-h-11 min-w-11 rounded-lg px-2 text-xs font-semibold text-brand-ink underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
            aria-label={revealed ? 'Sembunyikan password' : 'Tampilkan password'}
            aria-pressed={revealed}
            onClick={() => setRevealed((value) => !value)}
          >
            {revealed ? 'Sembunyikan' : 'Tampilkan'}
          </button>
        )}
      </div>
      {hint && <p id={hintID} className="mt-1 text-xs text-muted">{hint}</p>}
      {error && <p id={errorID} className="mt-1 text-sm font-medium text-red-800">{error}</p>}
    </div>
  )
}

type AlertTone = 'error' | 'success' | 'info' | 'warning'

export function Alert({ tone = 'error', children }: { tone?: AlertTone; children: ReactNode }) {
  const tones: Record<AlertTone, string> = {
    error: 'border-red-200 bg-red-50 text-red-800',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    info: 'border border-accent/20 bg-accent-soft text-body',
    warning: 'border-amber-300 bg-amber-50 text-amber-900',
  }
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-xl border px-4 py-3 text-sm ${tones[tone]}`}>
      {children}
    </div>
  )
}

export function RetryAlert({ children, onRetry }: { children: ReactNode; onRetry: () => void }) {
  return (
    <div className="space-y-2">
      <Alert>{children}</Alert>
      <Button type="button" variant="secondary" onClick={onRetry}>Coba lagi</Button>
    </div>
  )
}

export function ConnectionStatus({ connected }: { connected: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-2 text-xs ${connected ? 'text-emerald-800' : 'text-amber-800'}`}
      role="status"
      data-connection-status
    >
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-600' : 'bg-amber-700'}`} data-connection-dot />
      {connected ? 'Terhubung langsung' : 'Menyambungkan ulang…'}
    </span>
  )
}

export type BadgeTone = 'success' | 'warning' | 'danger' | 'neutral' | 'accent'

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  const tones: Record<BadgeTone, string> = {
    success: 'bg-emerald-100 text-emerald-900',
    warning: 'bg-amber-100 text-amber-950',
    danger: 'bg-red-100 text-red-900',
    neutral: 'bg-paper-raised text-body',
    accent: 'bg-accent-soft text-accent-ink',
  }
  return <span className={`inline-flex min-h-6 items-center rounded-full px-2.5 py-1 text-xs font-semibold ${tones[tone]}`}>{children}</span>
}

export function Spinner() {
  return (
    <div className="flex min-h-dvh items-center justify-center text-sm text-muted" role="status">
      Memuat…
    </div>
  )
}

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <main className="min-h-dvh bg-paper lg:grid lg:grid-cols-2">
      <aside className="relative hidden overflow-hidden bg-ink px-12 py-14 text-white lg:flex lg:flex-col lg:justify-between xl:px-20">
        <div className="absolute -right-28 -top-28 size-96 rounded-full border border-white/10" aria-hidden="true" />
        <div className="absolute -bottom-40 -left-24 size-[30rem] rounded-full border border-white/10" aria-hidden="true" />
        <div className="relative z-10"><Logo light /></div>
        <div className="relative z-10 grid grid-cols-[1fr_auto] items-center gap-8">
          <div className="max-w-lg">
            <p className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-white/70">Rapi dari kursi pertama</p>
            <p className="text-4xl font-bold leading-tight xl:text-5xl">Antrian lancar, pelanggan nyaman.</p>
            <p className="mt-5 max-w-md text-base leading-7 text-white/80">Atur outlet dan layanan, lalu biarkan pelanggan memantau giliran mereka dari ponsel.</p>
          </div>
          <svg aria-hidden="true" viewBox="0 0 132 280" className="h-56 w-28 xl:h-72 xl:w-32">
            <defs><clipPath id="barber-pole"><rect x="30" y="36" width="72" height="208" rx="30" /></clipPath></defs>
            <rect x="24" y="30" width="84" height="220" rx="36" fill="var(--color-paper)" />
            <g clipPath="url(#barber-pole)">
              <rect x="30" y="36" width="72" height="208" fill="var(--color-paper)" />
              <path d="M8 206 122 92M8 258 122 144M8 154 122 40M8 102 74 36" stroke="#737373" strokeWidth="20" />
            </g>
            <path d="M24 52h84M24 228h84" stroke="#737373" strokeWidth="12" strokeLinecap="round" />
            <circle cx="66" cy="18" r="10" fill="#737373" />
            <circle cx="66" cy="262" r="10" fill="#737373" />
          </svg>
        </div>
        <p className="relative z-10 text-xs text-white/70">Kapsflow · Antrian untuk barbershop dan salon</p>
      </aside>
      <section className="flex min-h-dvh items-center justify-center px-5 py-10 lg:px-10" aria-labelledby="auth-title">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden"><Logo /></div>
          <h1 id="auth-title" className="text-2xl font-bold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-body-muted">{subtitle}</p>}
          <div className="mt-6 space-y-4">{children}</div>
        </div>
      </section>
    </main>
  )
}
