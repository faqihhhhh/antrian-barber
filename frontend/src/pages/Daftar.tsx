import { useState } from 'react'
import { Link } from 'react-router'
import { useMutation } from '@tanstack/react-query'
import { api, ApiError, messageOf } from '../api/client'
import { useResendVerification } from '../auth/useResendVerification'
import { Alert, AuthLayout, Button, Field } from '../components/ui'

export default function Daftar() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const register = useMutation({
    mutationFn: async () => {
      const { error, response } = await api.POST('/v1/auth/register', { body: { email, password } })
      if (!response.ok) throw new ApiError(error)
    },
  })
  const resend = useResendVerification(email)

  if (register.isSuccess) {
    return (
      <AuthLayout
        title="Cek email Anda"
        subtitle={`Kami mengirim tautan verifikasi ke ${email}. Klik tautan itu untuk mengaktifkan akun.`}
      >
        <Alert tone="info">Tidak ada email? Periksa folder spam, atau kirim ulang tautannya.</Alert>
        {resend.isSuccess && <Alert tone="success">Email verifikasi dikirim ulang.</Alert>}
        {resend.isError && <Alert>{messageOf(resend.error)}</Alert>}
        <Button type="button" variant="ghost" loading={resend.isPending} onClick={() => resend.mutate()}>
          Kirim ulang email verifikasi
        </Button>
        <p className="text-center text-sm">
          <Link to="/masuk" className="font-semibold underline">
            Ke halaman masuk
          </Link>
        </p>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Daftar" subtitle="Buat akun dengan email yang aktif. Kami akan mengirim tautan verifikasi.">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          register.mutate()
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
          autoComplete="new-password"
          required
          minLength={8}
          hint="Minimal 8 karakter"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {register.isError && <Alert>{messageOf(register.error)}</Alert>}
        <Button type="submit" loading={register.isPending}>
          Daftar
        </Button>
      </form>
      <p className="text-center text-sm text-stone-600">
        Sudah punya akun?{' '}
        <Link to="/masuk" className="font-semibold text-stone-900 underline">
          Masuk
        </Link>
      </p>
    </AuthLayout>
  )
}