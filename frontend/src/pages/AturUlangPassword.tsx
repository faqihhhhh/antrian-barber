import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { useMutation } from '@tanstack/react-query'
import { api, ApiError, messageOf } from '../api/client'
import { Alert, AuthLayout, Button, Field } from '../components/ui'

export default function AturUlangPassword() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [password, setPassword] = useState('')

  const reset = useMutation({
    mutationFn: async () => {
      const { error, response } = await api.POST('/v1/auth/reset-password', { body: { token, password } })
      if (!response.ok) throw new ApiError(error)
    },
  })

  if (reset.isSuccess) {
    return (
      <AuthLayout title="Password diubah">
        <Alert tone="success">Password Anda berhasil diubah.</Alert>
        <Button to="/masuk">Masuk sekarang</Button>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Password baru" subtitle="Buat password baru untuk akun Anda.">
      {!token && <Alert>Tautan tidak lengkap. Buka tautan langsung dari email Anda.</Alert>}
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          reset.mutate()
        }}
      >
        <Field
          label="Password baru"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          hint="Minimal 8 karakter"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {reset.isError && <Alert>{messageOf(reset.error)}</Alert>}
        <Button type="submit" loading={reset.isPending} disabled={!token}>
          Simpan password
        </Button>
      </form>
    </AuthLayout>
  )
}
