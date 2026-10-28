import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, messageOf } from '../api/client'
import { useMe } from '../auth/useMe'
import { Alert, Button, Field, Spinner } from '../components/ui'
import type { components } from '../api/schema'

type Membership = components['schemas']['MembershipInfo']
type StaffMember = components['schemas']['StaffMember']
type StaffRole = 'admin' | 'kapster'

const ROLE_LABEL: Record<StaffRole, string> = { admin: 'Admin', kapster: 'Kapster' }

export default function PemilikStaf() {
  const me = useMe()
  const [tenantChoice, setTenantChoice] = useState('')

  if (me.isPending) return <Spinner />
  if (me.isError) return <main className="mx-auto max-w-md px-5 py-10"><Alert>{messageOf(me.error)}</Alert></main>

  const memberships = (me.data?.memberships ?? []).filter((item) => item.roles.includes('owner'))
  const tenantID = memberships.some((item) => item.tenant_id === tenantChoice)
    ? tenantChoice
    : memberships[0]?.tenant_id ?? ''
  const membership = memberships.find((item) => item.tenant_id === tenantID)

  return (
    <main className="mx-auto min-h-dvh max-w-md space-y-5 bg-paper px-5 py-6">
      <header>
        <h1 className="mt-1 text-2xl font-bold">Kelola staf</h1>
      </header>

      {memberships.length === 0 ? (
        <Alert tone="info">Akun ini belum menjadi owner bisnis.</Alert>
      ) : (
        <>
          {memberships.length > 1 && (
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-body">Bisnis</span>
              <select
                aria-label="Bisnis"
                className="w-full rounded-xl border border-line-strong bg-white px-4 py-3 text-base focus-visible:outline-2 focus-visible:outline-brand-ink"
                value={tenantID}
                onChange={(event) => setTenantChoice(event.target.value)}
              >
                {memberships.map((item) => <option key={item.tenant_id} value={item.tenant_id}>{item.tenant_name}</option>)}
              </select>
            </label>
          )}
          {membership && <StaffPanel membership={membership} />}
        </>
      )}
    </main>
  )
}

function StaffPanel({ membership }: { membership: Membership }) {
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [roles, setRoles] = useState<StaffRole[]>([])
  const [outletIDs, setOutletIDs] = useState<string[]>([])
  const [created, setCreated] = useState(false)

  const staff = useQuery({
    queryKey: ['owner-staff', membership.tenant_id],
    queryFn: async (): Promise<StaffMember[]> => {
      const { data, error, response } = await api.GET('/v1/tenants/{tenantID}/staff', {
        params: { path: { tenantID: membership.tenant_id } },
      })
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
  })

  const invite = useMutation({
    mutationFn: async () => {
      const { data, error, response } = await api.POST('/v1/tenants/{tenantID}/staff', {
        params: { path: { tenantID: membership.tenant_id } },
        body: { email, password, display_name: displayName, roles, outlet_ids: outletIDs },
      })
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
    onSuccess: async () => {
      setEmail('')
      setPassword('')
      setDisplayName('')
      setRoles([])
      setOutletIDs([])
      setCreated(true)
      await queryClient.invalidateQueries({ queryKey: ['owner-staff', membership.tenant_id] })
    },
  })

  function toggleRole(role: StaffRole) {
    setRoles((current) => current.includes(role) ? current.filter((item) => item !== role) : [...current, role])
  }

  function toggleOutlet(outletID: string) {
    setOutletIDs((current) => current.includes(outletID) ? current.filter((item) => item !== outletID) : [...current, outletID])
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setCreated(false)
    invite.mutate()
  }

  return (
    <div className="space-y-5">
      <section className="rounded-3xl border border-line bg-white p-5">
        <h2 className="text-lg font-bold">Undang staf</h2>
        <p className="mt-1 text-sm text-body-muted">Staf akan menerima email untuk memverifikasi akunnya.</p>
        <form className="mt-4 space-y-4" onSubmit={submit}>
          <Field label="Email staf" name="staff-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
          <Field label="Nama staf" name="staff-displayName" autoComplete="nickname" required minLength={1} maxLength={60} hint="Maksimal 60 karakter, boleh memakai spasi." value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          <Field label="Kata sandi awal" name="staff-password" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} hint="Minimal 8 karakter. Sampaikan kata sandi ini dengan aman kepada staf." />

          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium text-body">Peran staf</legend>
            {(['admin', 'kapster'] as const).map((role) => (
              <label key={role} className="flex items-center gap-3 rounded-xl border border-line px-4 py-3 text-sm">
                <input type="checkbox" checked={roles.includes(role)} onChange={() => toggleRole(role)} className="size-5 accent-brand" />
                <span>{ROLE_LABEL[role]}</span>
              </label>
            ))}
            <p className="text-xs text-muted">Boleh memilih keduanya. Owner tidak ditambahkan lewat undangan staf.</p>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium text-body">Outlet tugas</legend>
            {membership.outlets.map((outlet) => (
              <label key={outlet.id} className="flex items-center gap-3 rounded-xl border border-line px-4 py-3 text-sm">
                <input type="checkbox" checked={outletIDs.includes(outlet.id)} onChange={() => toggleOutlet(outlet.id)} className="size-5 accent-brand" />
                <span>{outlet.name}</span>
              </label>
            ))}
            {membership.outlets.length === 0 && <p className="text-sm text-muted">Buat outlet lebih dulu sebelum mengundang staf.</p>}
          </fieldset>

          {invite.isError && <Alert>{messageOf(invite.error)}</Alert>}
          {created && <Alert tone="success">Akun staf dibuat. Staf perlu membuka email verifikasi untuk masuk.</Alert>}
          <Button
            type="submit"
            loading={invite.isPending}
            disabled={membership.outlets.length === 0 || roles.length === 0 || outletIDs.length === 0}
          >
            Buat akun staf
          </Button>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold">Staf bisnis</h2>
        {staff.isPending && <p className="text-center text-sm text-muted" role="status">Memuat daftar staf…</p>}
        {staff.isError && <Alert>{messageOf(staff.error)}</Alert>}
        {staff.data?.length === 0 && <Alert tone="info">Belum ada staf di bisnis ini.</Alert>}
        {staff.data?.map((member) => (
          <article key={member.membership_id} className="rounded-2xl border border-line bg-white p-4">
            <h3 className="font-semibold">{member.email}</h3>
          {member.display_name && <p className="mt-1 text-sm text-body-muted">Nama panggilan: {member.display_name}</p>}
            <p className="mt-1 text-sm text-body-muted">{member.roles.map((role) => ROLE_LABEL[role as StaffRole] ?? role).join(' · ')}</p>
            <p className="mt-1 text-sm text-body-muted">
              Outlet: {member.outlet_ids.map((id) => membership.outlets.find((outlet) => outlet.id === id)?.name).filter(Boolean).join(', ') || 'Tidak ada'}
            </p>
            <p className="mt-2 text-xs text-muted">Email {member.email_verified ? 'terverifikasi' : 'belum diverifikasi'}</p>
          </article>
        ))}
      </section>
    </div>
  )
}
