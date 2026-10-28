import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, messageOf } from '../api/client'
import { useMe } from '../auth/useMe'
import { Alert, Spinner } from '../components/ui'
import type { components } from '../api/schema'

type Membership = components['schemas']['MembershipInfo']

export default function PemilikPeran() {
  const me = useMe()

  if (me.isPending) return <Spinner />
  if (me.isError) return <main className="mx-auto max-w-md px-5 py-10"><Alert>{messageOf(me.error)}</Alert></main>

  const memberships = (me.data?.memberships ?? []).filter((membership) => membership.roles.includes('owner'))

  return (
    <main className="mx-auto min-h-dvh max-w-md space-y-5 bg-paper px-5 py-6">
      <header>
        <h1 className="text-2xl font-bold">Peran operasional</h1>
        <p className="mt-2 text-sm leading-6 text-body-muted">
          Aktifkan ruang Admin atau Kapster untuk diri sendiri. Pengaturan bisnis tetap berada di ruang Owner.
        </p>
      </header>
      {memberships.length === 0 ? (
        <Alert tone="info">Akun ini belum menjadi owner bisnis.</Alert>
      ) : memberships.map((membership) => <WorkRoles key={membership.membership_id} membership={membership} />)}
    </main>
  )
}

function WorkRoles({ membership }: { membership: Membership }) {
  const queryClient = useQueryClient()
  const enabled = {
    admin: membership.roles.includes('admin'),
    kapster: membership.roles.includes('kapster'),
  }

  const update = useMutation({
    mutationFn: async (next: typeof enabled) => {
      const { data, error, response } = await api.PUT('/v1/me/tenants/{tenantID}/work-roles', {
        params: { path: { tenantID: membership.tenant_id } },
        body: next,
      })
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['me'] }),
  })

  function toggle(role: keyof typeof enabled) {
    update.mutate({ ...enabled, [role]: !enabled[role] })
  }

  return (
    <section className="space-y-3 rounded-3xl border border-line bg-white p-5">
      <div>
        <h2 className="font-bold">{membership.tenant_name}</h2>
        <p className="mt-1 text-sm text-body-muted">Owner selalu aktif. Peran ini menambah ruang kerja terpisah.</p>
      </div>
      <label className="flex min-h-12 items-center gap-3 rounded-xl border border-line px-4 py-3">
        <input type="checkbox" checked={enabled.admin} disabled={update.isPending} onChange={() => toggle('admin')} className="size-5 accent-brand" />
        <span className="text-sm font-semibold">Aktifkan ruang Admin</span>
      </label>
      <label className="flex min-h-12 items-center gap-3 rounded-xl border border-line px-4 py-3">
        <input type="checkbox" checked={enabled.kapster} disabled={update.isPending} onChange={() => toggle('kapster')} className="size-5 accent-brand" />
        <span className="text-sm font-semibold">Aktifkan ruang Kapster</span>
      </label>
      {enabled.kapster && <p className="text-sm text-body-muted">Ruang Kapster memakai outlet bisnis ini. Selesaikan layanan yang sedang berjalan sebelum menonaktifkan peran ini.</p>}
      {update.isError && <Alert>{messageOf(update.error)}</Alert>}
      {update.isSuccess && <Alert tone="success">Peran operasional berhasil diperbarui.</Alert>}
    </section>
  )
}
