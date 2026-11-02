import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation, useSearchParams } from 'react-router'
import { api, ApiError, messageOf } from '../api/client'
import { useMe } from '../auth/useMe'
import { Alert, AuthLayout, Button, Spinner } from '../components/ui'

export default function GabungStaf() {
  const [params] = useSearchParams()
  const location = useLocation()
  const queryClient = useQueryClient()
  const token = params.get('token') ?? ''
  const returnTo = `${location.pathname}${location.search}`
  const me = useMe()
  const invitation = useQuery({
    queryKey: ['staff-invitation', token],
    enabled: token.length >= 32,
    queryFn: async () => {
      const { data, error, response } = await api.GET('/v1/public/staff-invitations', {
        params: { query: { token } },
      })
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
  })
  const apply = useMutation({
    mutationFn: async () => {
      const { data, error, response } = await api.POST('/v1/me/staff-applications', { body: { token } })
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['me'] })
    },
  })

  if (!token || token.length < 32) {
    return <AuthLayout title="Link undangan tidak valid" subtitle="Minta owner mengirim link undangan yang baru."><Button to="/masuk" variant="secondary">Ke halaman masuk</Button></AuthLayout>
  }
  if (invitation.isPending || me.isPending) return <Spinner />
  if (invitation.isError) {
    return <AuthLayout title="Undangan tidak tersedia" subtitle={messageOf(invitation.error)}><Button to="/masuk" variant="secondary">Ke halaman masuk</Button></AuthLayout>
  }

  return (
    <AuthLayout title="Undangan bergabung sebagai staf" subtitle={`Anda diundang untuk bergabung dengan ${invitation.data.tenant_name}.`}>
      <div className="space-y-4">
        <Alert tone="info">Owner akan memeriksa pengajuan dan menentukan peran serta outlet tugas Anda.</Alert>
        {apply.isSuccess && <Alert tone="success">Pengajuan Anda sudah dikirim ke owner untuk ditinjau.</Alert>}
        {apply.isError && <Alert>{messageOf(apply.error)}</Alert>}
        {me.data ? (
          <Button type="button" loading={apply.isPending} disabled={apply.isSuccess} onClick={() => apply.mutate()}>
            Ajukan diri sebagai staf
          </Button>
        ) : (
          <>
            <p className="text-sm text-body-muted">Masuk atau buat akun, verifikasi email, lalu kirim pengajuan dari tautan ini.</p>
            <Button to="/masuk" state={{ from: returnTo }}>Masuk</Button>
            <Button to="/daftar" variant="secondary" state={{ from: returnTo }}>Buat akun</Button>
          </>
        )}
        <Link to="/" className="inline-flex min-h-11 items-center text-sm font-semibold underline">Kembali ke beranda</Link>
      </div>
    </AuthLayout>
  )
}
