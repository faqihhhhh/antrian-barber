import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, messageOf } from '../api/client'
import { useMe } from '../auth/useMe'
import { Alert, Button, Field, Spinner } from '../components/ui'
import { useNow } from '../hooks/useNow'
import type { components } from '../api/schema'

type Membership = components['schemas']['MembershipInfo']
type StaffMember = components['schemas']['StaffMember']
type StaffInvitationLink = components['schemas']['StaffInvitationLink']
type StaffApplicant = components['schemas']['StaffApplicant']
type StaffRole = 'admin' | 'kapster'

const ROLE_LABEL: Record<StaffRole, string> = { admin: 'Admin', kapster: 'Kapster' }

export default function PemilikStaf() {
  const me = useMe()
  const [tenantChoice, setTenantChoice] = useState('')

  if (me.isPending) return <Spinner />
  if (me.isError) return <main className="mx-auto max-w-md px-5 py-10"><Alert>{messageOf(me.error)}</Alert></main>

  const memberships = (me.data?.memberships ?? []).filter((item) => item.roles.includes('owner'))
  const tenantID = memberships.some((item) => item.tenant_id === tenantChoice) ? tenantChoice : memberships[0]?.tenant_id ?? ''
  const membership = memberships.find((item) => item.tenant_id === tenantID)

  return (
    <main className="mx-auto min-h-dvh max-w-md space-y-5 bg-paper px-5 py-6">
      <header><h1 className="mt-1 text-2xl font-bold">Kelola staf</h1></header>
      {memberships.length === 0 ? <Alert tone="info">Akun ini belum menjadi owner bisnis.</Alert> : <>
        {memberships.length > 1 && <label className="block">
          <span className="mb-1 block text-sm font-medium text-body">Bisnis</span>
          <select aria-label="Bisnis" className="w-full rounded-xl border border-line-strong bg-white px-4 py-3 text-base focus-visible:outline-2 focus-visible:outline-brand-ink" value={tenantID} onChange={(event) => setTenantChoice(event.target.value)}>
            {memberships.map((item) => <option key={item.tenant_id} value={item.tenant_id}>{item.tenant_name}</option>)}
          </select>
        </label>}
        {membership && <StaffPanel membership={membership} />}
      </>}
    </main>
  )
}

function StaffPanel({ membership }: { membership: Membership }) {
  const queryClient = useQueryClient()
  const now = useNow(60_000)
  const [newLink, setNewLink] = useState('')
  const [copied, setCopied] = useState(false)
  const tenantID = membership.tenant_id
  const staff = useQuery({
    queryKey: ['owner-staff', tenantID],
    queryFn: async (): Promise<StaffMember[]> => {
      const { data, error, response } = await api.GET('/v1/tenants/{tenantID}/staff', { params: { path: { tenantID } } })
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
  })
  const invitations = useQuery({
    queryKey: ['owner-staff-invitations', tenantID],
    queryFn: async (): Promise<StaffInvitationLink[]> => {
      const { data, error, response } = await api.GET('/v1/tenants/{tenantID}/staff/invitations', { params: { path: { tenantID } } })
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
  })
  const applications = useQuery({
    queryKey: ['owner-staff-applications', tenantID],
    queryFn: async (): Promise<StaffApplicant[]> => {
      const { data, error, response } = await api.GET('/v1/tenants/{tenantID}/staff/applications', { params: { path: { tenantID } } })
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
  })
  const createLink = useMutation({
    mutationFn: async () => {
      const { data, error, response } = await api.POST('/v1/tenants/{tenantID}/staff/invitations', { params: { path: { tenantID } } })
      if (!response.ok || !data) throw new ApiError(error)
      return data
    },
    onSuccess: async (link) => {
      setNewLink(`${window.location.origin}/gabung-staf?token=${encodeURIComponent(link.url_token ?? '')}`)
      setCopied(false)
      await queryClient.invalidateQueries({ queryKey: ['owner-staff-invitations', tenantID] })
    },
  })
  const revokeLink = useMutation({
    mutationFn: async (invitationID: string) => {
      const { error, response } = await api.DELETE('/v1/tenants/{tenantID}/staff/invitations/{invitationID}', { params: { path: { tenantID, invitationID } } })
      if (!response.ok) throw new ApiError(error)
    },
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['owner-staff-invitations', tenantID] }),
  })
  const review = useMutation({
    mutationFn: async (input: { applicationID: string; approve: boolean; roles?: StaffRole[]; outletIDs?: string[] }) => {
      const params = { path: { tenantID, applicationID: input.applicationID } }
      const result = input.approve
        ? await api.POST('/v1/tenants/{tenantID}/staff/applications/{applicationID}/approve', { params, body: { roles: input.roles ?? [], outlet_ids: input.outletIDs ?? [] } })
        : await api.POST('/v1/tenants/{tenantID}/staff/applications/{applicationID}/reject', { params })
      if (!result.response.ok) throw new ApiError(result.error)
    },
    onSuccess: async () => Promise.all([
      queryClient.invalidateQueries({ queryKey: ['owner-staff-applications', tenantID] }),
      queryClient.invalidateQueries({ queryKey: ['owner-staff', tenantID] }),
    ]),
  })

  return <div className="space-y-5">
    <section className="space-y-3 rounded-3xl border border-line bg-white p-5">
      <div>
        <h2 className="text-lg font-bold">Link undangan staf</h2>
        <p className="mt-1 text-sm text-body-muted">Link berlaku tujuh hari. Calon staf membuat akun sendiri dan menunggu persetujuan owner.</p>
      </div>
      {createLink.isError && <Alert>{messageOf(createLink.error)}</Alert>}
      {newLink && <div className="space-y-2">
        <Field label="Link undangan baru" name="staff-invite-link" value={newLink} readOnly onFocus={(event) => event.currentTarget.select()} />
        <Button type="button" variant="secondary" onClick={async () => {
          try { await navigator.clipboard.writeText(newLink); setCopied(true) } catch { setCopied(false) }
        }}>{copied ? 'Tautan disalin' : 'Salin tautan'}</Button>
      </div>}
      <Button type="button" loading={createLink.isPending} onClick={() => createLink.mutate()}>Buat link undangan</Button>
      {revokeLink.isError && <Alert>{messageOf(revokeLink.error)}</Alert>}
      {invitations.isError && <Alert>{messageOf(invitations.error)}</Alert>}
      {invitations.data?.map((link) => {
        const expired = Date.parse(link.expires_at) <= now
        const active = !link.revoked_at && !expired
        return <article key={link.id} className="flex items-center justify-between gap-3 rounded-xl border border-line p-3">
          <div><p className="text-sm font-semibold">{link.revoked_at ? 'Dicabut' : expired ? 'Kedaluwarsa' : 'Aktif'}</p><p className="text-xs text-body-muted">Berlaku sampai {new Date(link.expires_at).toLocaleString('id-ID')}</p></div>
          {active && <Button type="button" variant="secondary" className="w-auto" loading={revokeLink.isPending} onClick={() => revokeLink.mutate(link.id)}>Cabut</Button>}
        </article>
      })}
    </section>

    <section className="space-y-3">
      <h2 className="text-lg font-bold">Pengajuan staf</h2>
      {applications.isPending && <p className="text-center text-sm text-muted" role="status">Memuat pengajuan…</p>}
      {applications.isError && <Alert>{messageOf(applications.error)}</Alert>}
      {applications.data?.length === 0 && <Alert tone="info">Belum ada pengajuan yang menunggu.</Alert>}
      {applications.data?.map((applicant) => <ApplicantCard key={applicant.application_id} applicant={applicant} outlets={membership.outlets} review={review.mutate} pending={review.isPending} error={review.isError ? messageOf(review.error) : undefined} />)}
    </section>

    <section className="space-y-3">
      <h2 className="text-lg font-bold">Staf bisnis</h2>
      {staff.isPending && <p className="text-center text-sm text-muted" role="status">Memuat daftar staf…</p>}
      {staff.isError && <Alert>{messageOf(staff.error)}</Alert>}
      {staff.data?.length === 0 && <Alert tone="info">Belum ada staf di bisnis ini.</Alert>}
      {staff.data?.map((member) => <article key={member.membership_id} className="rounded-2xl border border-line bg-white p-4">
        <h3 className="font-semibold">{member.email}</h3>
        {member.display_name && <p className="mt-1 text-sm text-body-muted">Nama panggilan: {member.display_name}</p>}
        <p className="mt-1 text-sm text-body-muted">{member.roles.map((role) => ROLE_LABEL[role as StaffRole] ?? role).join(' · ')}</p>
        <p className="mt-1 text-sm text-body-muted">Outlet: {member.outlet_ids.map((id) => membership.outlets.find((outlet) => outlet.id === id)?.name).filter(Boolean).join(', ') || 'Tidak ada'}</p>
        <p className="mt-2 text-xs text-muted">Email {member.email_verified ? 'terverifikasi' : 'belum diverifikasi'}</p>
      </article>)}
    </section>
  </div>
}

function ApplicantCard({ applicant, outlets, review, pending, error }: {
  applicant: StaffApplicant
  outlets: Membership['outlets']
  review: (input: { applicationID: string; approve: boolean; roles?: StaffRole[]; outletIDs?: string[] }) => void
  pending: boolean
  error?: string
}) {
  const [roles, setRoles] = useState<StaffRole[]>([])
  const [outletIDs, setOutletIDs] = useState<string[]>([])
  function toggleRole(role: StaffRole) { setRoles((current) => current.includes(role) ? current.filter((item) => item !== role) : [...current, role]) }
  function toggleOutlet(id: string) { setOutletIDs((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]) }
  return <article className="space-y-3 rounded-2xl border border-line bg-white p-4">
    <div>
      <h3 className="font-semibold">{applicant.display_name || applicant.email}</h3>
      {applicant.display_name && <p className="text-sm text-body-muted">{applicant.email}</p>}
      <p className="mt-1 text-xs text-muted">Mengajukan {new Date(applicant.created_at).toLocaleString('id-ID')}</p>
    </div>
    <fieldset className="space-y-2">
      <legend className="mb-2 text-sm font-medium text-body">Peran staf</legend>
      {(['admin', 'kapster'] as const).map((role) => <label key={role} className="flex items-center gap-3 rounded-xl border border-line px-4 py-3 text-sm">
        <input type="checkbox" checked={roles.includes(role)} onChange={() => toggleRole(role)} className="size-5 accent-brand" /><span>{ROLE_LABEL[role]}</span>
      </label>)}
    </fieldset>
    <fieldset className="space-y-2">
      <legend className="mb-2 text-sm font-medium text-body">Outlet tugas</legend>
      {outlets.map((outlet) => <label key={outlet.id} className="flex items-center gap-3 rounded-xl border border-line px-4 py-3 text-sm">
        <input type="checkbox" checked={outletIDs.includes(outlet.id)} onChange={() => toggleOutlet(outlet.id)} className="size-5 accent-brand" /><span>{outlet.name}</span>
      </label>)}
    </fieldset>
    {error && <Alert>{error}</Alert>}
    <div className="flex flex-col gap-2 sm:flex-row">
      <Button type="button" disabled={!roles.length || !outletIDs.length} loading={pending} onClick={() => review({ applicationID: applicant.application_id, approve: true, roles, outletIDs })}>Setujui</Button>
      <Button type="button" variant="secondary" disabled={pending} onClick={() => review({ applicationID: applicant.application_id, approve: false })}>Tolak</Button>
    </div>
  </article>
}
