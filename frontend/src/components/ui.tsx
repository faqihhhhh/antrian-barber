import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import { Link } from 'react-router'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost'
  loading?: boolean
}

export function Button({ variant = 'primary', loading, disabled, className = '', children, ...rest }: ButtonProps) {
  const base =
    'inline-flex w-full items-center justify-center rounded-xl px-4 py-3 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-900 disabled:opacity-60'
  const styles =
    variant === 'primary' ? 'bg-stone-900 text-white hover:bg-stone-800' : 'bg-transparent text-stone-700 hover:bg-stone-100'
  return (
    <button className={`${base} ${styles} ${className}`} disabled={disabled || loading} {...rest}>
      {loading ? 'Memproses…' : children}
    </button>
  )
}

export function LinkButton({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex w-full items-center justify-center rounded-xl bg-stone-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-stone-800"
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
      <span className="mb-1 block text-sm font-medium text-stone-700">{label}</span>
      <input
        id={inputId}
        className={`w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-base outline-none focus:border-stone-900 focus:ring-1 focus:ring-stone-900 ${className}`}
        {...rest}
      />
      {hint && <span className="mt-1 block text-xs text-stone-500">{hint}</span>}
    </label>
  )
}

export function Alert({ tone = 'error', children }: { tone?: 'error' | 'success' | 'info'; children: ReactNode }) {
  const tones = {
    error: 'border-red-200 bg-red-50 text-red-800',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    info: 'border-stone-200 bg-stone-100 text-stone-700',
  }
  return (
    <div role="alert" className={`rounded-xl border px-4 py-3 text-sm ${tones[tone]}`}>
      {children}
    </div>
  )
}

export function Spinner() {
  return (
    <div className="flex min-h-dvh items-center justify-center text-sm text-stone-500" role="status">
      Memuat…
    </div>
  )
}

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      <div className="mb-8">
        <p className="text-sm font-semibold tracking-wide text-stone-500">KAPSFLOW</p>
        <h1 className="mt-2 text-2xl font-bold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-stone-600">{subtitle}</p>}
      </div>
      <div className="space-y-4">{children}</div>
    </main>
  )
}