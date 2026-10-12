import { useState } from 'react'
import { Link } from 'react-router'
import { useMutation } from '@tanstack/react-query'
import { api, ApiError, messageOf } from '../api/client'
import { Alert, AuthLayout, Button, Field } from '../components/ui'

export default function LupaPassword() {
  const [email, setEmail] = useState('')

  const forgot = useMutation({
    mutationFn: async () => {
      const { error, response } = await api.POST('/v1/auth/forgot-password', { body: { email } })
      if (!response.ok) throw new ApiError(error)
    },
  })

  if (forgot.isSuccess) {
    return (
      <AuthLayout
        title="Cek email Anda"
        subtitle="Kalau email itu terdaftar, tautan untuk mengatur ulang password sudah dikirim. Tautan berlaku 1 jam."
      >
        <p className="text-center text-sm">
          <Link to="/masuk" className="font-semibold underline">
            Kembali ke halaman masuk
          </Link>
        </p>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Lupa password" subtitle="Masukkan email akun Anda. Kami kirim tautan untuk membuat password baru.">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          forgot.mutate()
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
        {forgot.isError && <Alert>{messageOf(forgot.error)}</Alert>}
        <Button type="submit" loading={forgot.isPending}>
          Kirim tautan
        </Button>
      </form>
      <p className="text-center text-sm">
        <Link to="/masuk" className="font-semibold underline">
          Kembali ke halaman masuk
        </Link>
      </p>
    </AuthLayout>
  )
}