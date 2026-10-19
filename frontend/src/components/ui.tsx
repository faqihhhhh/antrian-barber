import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import { Link } from 'react-router'
import { Logo } from './Logo'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost'
  loading?: boolean
}

export function Button({ variant = 'primary', loading, disabled, className = '', children, ...rest }: ButtonProps) {
  const base =
    'inline-flex w-full items-center justify-center rounded-xl px-4 py-3 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink disabled:opacity-60'
  const styles =
    variant === 'primary' ? 'bg-ink text-white hover:bg-ink-hover' : 'bg-transparent text-body hover:bg-paper-raised'
  return (
    <button className={`${base} ${styles} ${className}`} disabled={disabled || loading} {...rest}>
      {loading ? 'Memproses…' : children}
    </button>
  )
}

export function LinkButton({
  to,
  state,
  variant = 'primary',
  children,
}: {
  to: string
  state?: unknown
  variant?: 'primary' | 'outline'
  children: ReactNode
}) {
  const styles =
    variant === 'primary'
      ? 'bg-ink text-white hover:bg-ink-hover'
      : 'border border-line-strong bg-white text-ink hover:bg-paper-raised'
  return (
    <Link
      to={to}
      state={state}
      className={`inline-flex w-full items-center justify-center rounded-xl px-4 py-3 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink ${styles}`}
    >
      {children}
    </Link>
  )
}

type FieldProps = InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }

// Ukuran teks input 16px (text-base) supaya iPhone tidak memperbesar layar saat fokus.
export function Field({ label, hint, id, className = '', ...rest }: FieldProps) {
  const inputId = id ?? rest.name
  return (
    <label className="block" htmlFor={inputId}>
      <span className="mb-1 block text-sm font-medium text-body">{label}</span>
      <input
        id={inputId}
        className={`w-full rounded-xl border border-line-strong bg-white px-4 py-3 text-base outline-none focus:border-ink focus:ring-1 focus:ring-brand-ink ${className}`}
        {...rest}
      />
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  )
}

export function Alert({ tone = 'error', children }: { tone?: 'error' | 'success' | 'info'; children: ReactNode }) {
  const tones = {
    error: 'border-red-200 bg-red-50 text-red-800',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    info: 'border-line bg-paper-raised text-body',
  }
  return (
    <div role="alert" className={`rounded-xl border px-4 py-3 text-sm ${tones[tone]}`}>
      {children}
    </div>
  )
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
        <h1 className="mt-2 text-2xl font-bold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-body-muted">{subtitle}</p>}
      </div>
      <div className="space-y-4">{children}</div>
    </main>
  )
}
