import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, messageOf } from '../api/client'
import { useResendVerification } from '../auth/useResendVerification'
import { Alert, AuthLayout, Button, Field } from '../components/ui'

export default function Masuk() {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const customerLogin = location.pathname === '/pelanggan/masuk'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const from = (location.state as { from?: string } | null)?.from

  const login = useMutation({
    mutationFn: async () => {
      const { error, response } = await api.POST('/v1/auth/login', { body: { email, password } })
      if (!response.ok) throw new ApiError(error)
    },
    onSuccess: async () => {
      const { data, error, response } = await api.GET('/v1/me')
      if (!response.ok || !data) throw new ApiError(error)
      queryClient.setQueryData(['me'], data)
      if (from && isCustomerDestination(from) === customerLogin) {
        navigate(from, { replace: true })
        return
      }
      if (customerLogin) {
        navigate('/pelanggan', { replace: true })
        return
      }
      if (data.is_platform_admin) {
        navigate('/pemilik-saas', { replace: true })
        return
      }
      const owner = data.memberships.find((membership) => membership.roles.includes('owner'))
      const admin = data.memberships.find((membership) => membership.roles.includes('admin'))
      const kapster = data.memberships.some((membership) => membership.roles.includes('kapster'))
      if (owner) navigate('/pemilik', { replace: true })
      else if (admin?.outlets[0]) navigate(`/kelola/${admin.tenant_id}/${admin.outlets[0].id}`, { replace: true })
      else if (admin) navigate('/admin', { replace: true })
      else if (kapster) navigate('/kapster', { replace: true })
      else navigate('/', { replace: true })
    },
  })
  const resend = useResendVerification(email)

  const needsVerification = login.error instanceof ApiError && login.error.code === 'email_belum_verifikasi'

  return (
    <AuthLayout
      title="Masuk ke Kapsflow"
      subtitle={customerLogin
        ? 'Masuk untuk melanjutkan pesanan dari halaman outlet.'
        : 'Masuk untuk pemilik, admin, kapster, dan pengelola Kapsflow.'}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          login.mutate()
        }}
      >
        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {login.isError && !needsVerification && <Alert>{messageOf(login.error)}</Alert>}
        {needsVerification && (
          <Alert tone="warning">
            Email Anda belum diverifikasi. Klik tautan di email yang kami kirim, atau kirim ulang tautannya.
          </Alert>
        )}
        <Button type="submit" loading={login.isPending}>
          Masuk
        </Button>
      </form>

      {needsVerification && (
        <>
          {resend.isSuccess && <Alert tone="success">Email verifikasi dikirim ulang.</Alert>}
          {resend.isError && <Alert>{messageOf(resend.error)}</Alert>}
          <Button type="button" variant="ghost" loading={resend.isPending} onClick={() => resend.mutate()}>
            Kirim ulang email verifikasi
          </Button>
        </>
      )}

      <div className="flex flex-col items-center gap-2 text-sm">
        <Link to="/lupa-password" className="inline-flex min-h-11 items-center px-3 py-2 font-semibold text-body-muted underline focus-visible:outline-2 focus-visible:outline-brand-ink">
          Lupa password?
        </Link>
        <Button to="/daftar" variant="secondary">Buat akun baru</Button>
      </div>
    </AuthLayout>
  )
}

function isCustomerDestination(path: string): boolean {
  return /^\/(pelanggan(?:\/|$)|tiket(?:\/|$)|o\/|b\/)/.test(path)
}
