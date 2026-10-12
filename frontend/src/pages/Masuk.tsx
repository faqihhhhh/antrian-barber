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
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const from = (location.state as { from?: string } | null)?.from ?? '/'

  const login = useMutation({
    mutationFn: async () => {
      const { error, response } = await api.POST('/v1/auth/login', { body: { email, password } })
      if (!response.ok) throw new ApiError(error)
    },
    onSuccess: async () => {
      // Tunggu data akun terisi sebelum pindah halaman, supaya RequireLogin
      // tidak melihat status "belum masuk" yang lama.
      await queryClient.invalidateQueries({ queryKey: ['me'] })
      navigate(from, { replace: true })
    },
  })
  const resend = useResendVerification(email)

  const needsVerification = login.error instanceof ApiError && login.error.code === 'email_belum_verifikasi'

  return (
    <AuthLayout title="Masuk" subtitle="Masuk ke akun Kapsflow Anda.">
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
          <Alert tone="info">
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

      <div className="flex justify-between text-sm">
        <Link to="/lupa-password" className="font-semibold underline">
          Lupa password?
        </Link>
        <Link to="/daftar" className="font-semibold underline">
          Daftar
        </Link>
      </div>
    </AuthLayout>
  )
}