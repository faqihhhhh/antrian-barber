import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router'
import { api, ApiError, messageOf } from '../api/client'
import { useMe } from '../auth/useMe'
import { Alert, Button, Field, Spinner } from '../components/ui'

export default function PemilikMulai() {
  const me = useMe()
  const [name, setName] = useState('')
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const create = useMutation({
    mutationFn: async () => {
      const { data, error, response } = await api.POST('/v1/tenants/', { body: { name: name.trim() } })
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['me'] })
      navigate('/pemilik', { replace: true })
    },
  })

  if (me.isPending) return <Spinner />
  if (me.isError) return <main className="mx-auto max-w-md px-5 py-10"><Alert>{messageOf(me.error)}</Alert></main>

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    create.mutate()
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 bg-paper px-5 py-8">
      <header>
        <Link to="/" className="text-sm font-semibold underline">← Beranda</Link>
        <p className="mt-8 text-sm font-semibold tracking-wide text-muted">MULAI DENGAN BISNISMU</p>
        <h1 className="mt-2 text-3xl font-bold">Buat bisnis pertama</h1>
        <p className="mt-2 text-sm leading-6 text-body-muted">Nama ini digunakan untuk mengenali akun usahamu di Trimwait. Setelah bisnis dibuat, lanjutkan dengan menambahkan outlet.</p>
      </header>

      <form className="space-y-4 rounded-3xl border border-line bg-white p-5" onSubmit={submit}>
        <Field
          label="Nama bisnis atau barbershop"
          name="businessName"
          autoComplete="organization"
          required
          minLength={1}
          maxLength={100}
          value={name}
          onChange={(event) => setName(event.target.value)}
          hint="Maksimal 100 karakter. Contoh: Barber Maju Jaya."
        />
        {create.isError && <Alert>{messageOf(create.error)}</Alert>}
        <Button type="submit" loading={create.isPending} disabled={!name.trim()}>
          Buat bisnis
        </Button>
      </form>
      <Alert tone="info">Pembuatan outlet dan pengaturan antrean adalah langkah berikutnya. Outlet baru dapat dibuat setelah langganan bisnis aktif.</Alert>
    </main>
  )
}
