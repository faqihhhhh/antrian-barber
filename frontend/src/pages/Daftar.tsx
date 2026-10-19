import { useState } from 'react'
import { Link } from 'react-router'
import { useMutation } from '@tanstack/react-query'
import { api, ApiError, messageOf } from '../api/client'
import { useResendVerification } from '../auth/useResendVerification'
import { Alert, AuthLayout, Button, Field } from '../components/ui'

export default function Daftar() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')

  const register = useMutation({
    mutationFn: async () => {
      const { error, response } = await api.POST('/v1/auth/register', { body: { email, password, username } })
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
          <Link to="/masuk" className="inline-flex min-h-11 items-center px-3 py-2 font-semibold underline focus-visible:outline-2 focus-visible:outline-brand-ink">
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
          label="Username"
          name="username"
          autoComplete="username"
          required
          minLength={3}
          maxLength={24}
          pattern="[A-Za-z][A-Za-z0-9_]{2,23}"
          hint="3–24 karakter. Awali dengan huruf; gunakan huruf, angka, atau garis bawah."
          value={username}
          onChange={(e) => setUsername(e.target.value.toLowerCase())}
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
      <p className="text-center text-sm text-body-muted">
        Sudah punya akun?{' '}
        <Link to="/masuk" className="inline-flex min-h-11 items-center px-2 py-2 font-semibold text-ink underline focus-visible:outline-2 focus-visible:outline-brand-ink">
          Masuk
        </Link>
      </p>
    </AuthLayout>
  )
}
