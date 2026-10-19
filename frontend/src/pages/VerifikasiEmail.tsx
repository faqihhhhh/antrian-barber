import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router'
import { useMutation } from '@tanstack/react-query'
import { api, ApiError, messageOf } from '../api/client'
import { Alert, AuthLayout, LinkButton } from '../components/ui'

export default function VerifikasiEmail() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  // Token hanya bisa dipakai sekali. Di mode pengembangan React menjalankan
  // efek dua kali, jadi pemanggilan dijaga supaya hanya terjadi sekali.
  const started = useRef(false)

  const verify = useMutation({
    mutationFn: async () => {
      const { error, response } = await api.POST('/v1/auth/verify-email', { body: { token } })
      if (!response.ok) throw new ApiError(error)
    },
  })

  useEffect(() => {
    if (!token || started.current) return
    started.current = true
    verify.mutate()
  }, [token, verify])

  return (
    <AuthLayout title="Verifikasi email">
      {!token && <Alert>Tautan tidak lengkap. Buka tautan langsung dari email Anda.</Alert>}
      {token && (verify.isPending || verify.isIdle) && <Alert tone="info">Memverifikasi email Anda…</Alert>}
      {verify.isError && (
        <>
          <Alert>{messageOf(verify.error)}</Alert>
          <p className="text-sm text-body-muted">
            Tautan mungkin sudah dipakai atau kedaluwarsa. Coba masuk, dan kalau diminta, kirim ulang email verifikasi.
          </p>
          <LinkButton to="/masuk">Ke halaman masuk</LinkButton>
        </>
      )}
      {verify.isSuccess && (
        <>
          <Alert tone="success">Email terverifikasi. Akun Anda sudah aktif.</Alert>
          <LinkButton to="/masuk">Masuk sekarang</LinkButton>
        </>
      )}
    </AuthLayout>
  )
}