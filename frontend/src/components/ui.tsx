import { useId, useState } from 'react'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import { Link } from 'react-router'
import { Logo } from './Logo'

type ButtonStyle = 'primary' | 'secondary' | 'ghost'
type SharedButtonProps = { variant?: ButtonStyle; loading?: boolean; className?: string; children: ReactNode }
type ButtonProps = SharedButtonProps &
  ({ to: string; state?: unknown } | (ButtonHTMLAttributes<HTMLButtonElement> & { to?: never; state?: never }))

const buttonBase =
  'inline-flex min-h-11 w-full items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60'

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

type FieldProps = InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }

// Ukuran teks input 16px mencegah iPhone memperbesar layar saat fokus.
export function Field({ label, hint, error, id, type = 'text', className = '', ...rest }: FieldProps) {
  const generatedID = useId()
  const inputID = id ?? rest.name ?? generatedID
  const hintID = `${inputID}-hint`
  const errorID = `${inputID}-error`
  const [revealed, setRevealed] = useState(false)
  const isPassword = type === 'password'
  const describedBy = [rest['aria-describedby'], hint ? hintID : undefined, error ? errorID : undefined]
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
          aria-invalid={error ? true : rest['aria-invalid']}
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
    info: 'border-line bg-paper-raised text-body',
    warning: 'border-amber-300 bg-amber-50 text-amber-900',
  }
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-xl border px-4 py-3 text-sm ${tones[tone]}`}>
      {children}
    </div>
  )
}

export type BadgeTone = 'success' | 'warning' | 'danger' | 'neutral'

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  const tones: Record<BadgeTone, string> = {
    success: 'bg-emerald-100 text-emerald-900',
    warning: 'bg-amber-100 text-amber-950',
    danger: 'bg-red-100 text-red-900',
    neutral: 'bg-paper-raised text-body',
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
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      <div className="mb-8">
        <Logo />
        <h1 className="mt-5 text-2xl font-bold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-body-muted">{subtitle}</p>}
      </div>
      <div className="space-y-4">{children}</div>
    </main>
  )
}
