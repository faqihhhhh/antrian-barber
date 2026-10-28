import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { api, ApiError, messageOf } from '../api/client'
import { useMe } from '../auth/useMe'
import { Alert, Button, Field, Spinner } from '../components/ui'

export default function Akun() {
  const me = useMe()
  const queryClient = useQueryClient()
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const saveDisplayName = useMutation({
    mutationFn: async (displayName: string) => {
      const { data, error, response } = await api.PUT('/v1/me/display_name', { body: { display_name: displayName } })
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['me'] }),
  })

  const changePassword = useMutation({
    mutationFn: async () => {
      const { error, response } = await api.PUT('/v1/me/password', {
        body: { current_password: password, new_password: newPassword },
      })
      if (!response.ok) throw new ApiError(error)
    },
    onSuccess: () => {
      setPassword('')
      setNewPassword('')
      setConfirmPassword('')
    },
  })

  if (me.isPending) return <Spinner />
  if (me.isError) return <main className="mx-auto max-w-xl px-5 py-8"><Alert>{messageOf(me.error)}</Alert></main>
  if (!me.data) return null

  function submitDisplayName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    saveDisplayName.mutate(String(form.get('display_name') ?? ''))
  }

  function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (newPassword !== confirmPassword) return
    changePassword.mutate()
  }

  return (
    <main className="mx-auto min-h-[70dvh] max-w-2xl space-y-6 px-5 py-8">
      <header>
        <h1 className="text-2xl font-bold">Akun</h1>
        <p className="mt-1 text-sm text-body-muted">Kelola nama akun dan keamanan login Anda.</p>
      </header>

      <section className="rounded-2xl border border-line bg-white p-5">
        <h2 className="text-lg font-semibold">Profil</h2>
        <p className="mt-2 text-sm text-body-muted">Email</p>
        <p className="break-all font-medium">{me.data.user.email}</p>
        <form className="mt-5 space-y-3" onSubmit={submitDisplayName}>
          <Field
            label="Nama panggilan"
            name="display_name"
            autoComplete="nickname"
            required
            minLength={1}
            maxLength={60}
            defaultValue={me.data.user.display_name ?? ''}
            hint="Maksimal 60 karakter, boleh memakai spasi."
          />
          {saveDisplayName.isError && <Alert>{messageOf(saveDisplayName.error)}</Alert>}
          {saveDisplayName.isSuccess && <Alert tone="success">Nama panggilan berhasil disimpan.</Alert>}
          <Button type="submit" loading={saveDisplayName.isPending}>Simpan nama panggilan</Button>
        </form>
      </section>

      <section className="rounded-2xl border border-line bg-white p-5">
        <h2 className="text-lg font-semibold">Ganti password</h2>
        <p className="mt-1 text-sm text-body-muted">Masukkan password saat ini untuk memastikan perubahan ini dilakukan oleh Anda.</p>
        <form className="mt-5 space-y-3" onSubmit={submitPassword}>
          <Field
            label="Password saat ini"
            name="current-password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <Field
            label="Password baru"
            name="new-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            hint="Minimal 8 karakter."
          />
          <Field
            label="Ulangi password baru"
            name="confirm-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
          {newPassword && confirmPassword && newPassword !== confirmPassword && <Alert>Ulangan password belum cocok.</Alert>}
          {changePassword.isError && <Alert>{messageOf(changePassword.error)}</Alert>}
          {changePassword.isSuccess && <Alert tone="success">Password berhasil diubah.</Alert>}
          <Button type="submit" loading={changePassword.isPending} disabled={newPassword !== confirmPassword}>Simpan password baru</Button>
        </form>
      </section>
    </main>
  )
}
