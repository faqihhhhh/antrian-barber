import { Link } from 'react-router'
import { useMe } from '../auth/useMe'
import { Alert, Spinner } from '../components/ui'

type WorkspaceChoice = { title: string; detail: string; to: string }

export default function PilihPeran() {
  const me = useMe()

  if (me.isPending) return <Spinner />
  if (me.isError) return <main className="mx-auto max-w-md px-5 py-10"><Alert>Peran akun belum bisa dimuat. Muat ulang halaman untuk mencoba lagi.</Alert></main>

  const memberships = me.data?.memberships ?? []
  const owners = memberships.filter((membership) => membership.roles.includes('owner'))
  const admins = memberships.filter((membership) => membership.roles.includes('admin'))
  const kapsters = memberships.filter((membership) => membership.roles.includes('kapster'))
  const choices: WorkspaceChoice[] = [
    ...(owners.length > 0 ? [{ title: 'Owner', detail: owners.map((membership) => membership.tenant_name).join(', '), to: '/pemilik' }] : []),
    ...admins.flatMap((membership) => membership.outlets.length > 0
      ? membership.outlets.map((outlet) => ({ title: 'Admin', detail: `${membership.tenant_name} · ${outlet.name}`, to: `/kelola/${membership.tenant_id}/${outlet.id}` }))
      : [{ title: 'Admin', detail: membership.tenant_name, to: '/admin' }]),
    ...(kapsters.length > 0 ? [{ title: 'Kapster', detail: kapsters.map((membership) => membership.tenant_name).join(', '), to: '/kapster' }] : []),
    ...(me.data?.is_platform_admin ? [{ title: 'Platform', detail: 'Pengelolaan Trimwait', to: '/pemilik-saas' }] : []),
  ]

  return (
    <main className="mx-auto min-h-[70dvh] max-w-2xl space-y-5 px-5 py-8">
      <header>
        <h1 className="text-2xl font-bold">Pilih peran</h1>
        <p className="mt-2 text-sm leading-6 text-body-muted">Pilih ruang kerja yang ingin dibuka.</p>
      </header>
      {choices.length === 0 ? (
        <Alert tone="info">Akun ini belum memiliki akses ke ruang Owner, Admin, atau Kapster.</Alert>
      ) : (
        <section className="grid gap-3 sm:grid-cols-2" aria-label="Ruang kerja yang tersedia">
          {choices.map((choice) => (
            <Link key={`${choice.title}-${choice.to}`} to={choice.to} className="flex min-h-24 items-center justify-between gap-3 rounded-2xl border border-line bg-white p-5 transition hover:bg-paper-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ink">
              <span className="min-w-0">
                <span className="block font-semibold">{choice.title}</span>
                <span className="mt-1 block truncate text-sm text-body-muted">{choice.detail}</span>
              </span>
              <span aria-hidden="true" className="shrink-0 text-lg text-body-muted">→</span>
            </Link>
          ))}
        </section>
      )}
    </main>
  )
}
