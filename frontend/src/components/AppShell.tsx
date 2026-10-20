import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { api } from '../api/client'
import { useMe } from '../auth/useMe'
import { removePushSubscription } from '../hooks/usePushNotifications'
import { Logo } from './Logo'
import { Button } from './ui'

type NavigationItem = { to: string; label: string; end?: boolean }
type Workspace = { to: string; label: string }

export default function AppShell() {
  const me = useMe()
  const queryClient = useQueryClient()
  const location = useLocation()
  const navigate = useNavigate()
  const user = me.data?.user
  const memberships = me.data?.memberships ?? []
  const isKapster = memberships.some((membership) => membership.roles.includes('kapster'))
  const isAdmin = memberships.some((membership) => membership.roles.includes('admin'))
  const adminMembership = memberships.find((membership) => membership.roles.includes('admin'))
  const manageMembership = adminMembership ?? memberships.find((membership) => membership.roles.includes('owner'))
  const manageOutlet = manageMembership?.outlets[0]
  const isOwner = memberships.some((membership) => membership.roles.includes('owner'))
  const platformAdmin = me.data?.is_platform_admin ?? false
  const isOwnerPage = location.pathname.startsWith('/pemilik/') || location.pathname === '/pemilik'
  const isAdminPage = location.pathname === '/admin' || location.pathname.startsWith('/kelola/')
  const isKapsterPage = location.pathname === '/kapster'
  const isCustomerPage = location.pathname === '/pelanggan' || location.pathname.startsWith('/pelanggan/') || location.pathname === '/tiket' || location.pathname.startsWith('/tiket/')
  const isPlatformPage = location.pathname === '/pemilik-saas'
  const isHomePage = location.pathname === '/'
  const isAccountPage = location.pathname === '/akun' || location.pathname === '/pelanggan/akun'
  const businessWorkspaces: Workspace[] = [
    ...(isOwner ? [{ to: '/pemilik', label: 'Owner' }] : []),
    ...(isAdmin ? [{ to: manageOutlet ? `/kelola/${manageMembership?.tenant_id}/${manageOutlet.id}` : '/admin', label: 'Admin' }] : []),
    ...(isKapster ? [{ to: '/kapster', label: 'Kapster' }] : []),
    ...(platformAdmin ? [{ to: '/pemilik-saas', label: 'Platform' }] : []),
  ]
  const customerContext = isCustomerPage
  const workspaces: Workspace[] = customerContext
    ? [{ to: '/tiket', label: 'Pelanggan' }]
    : isPlatformPage
      ? [{ to: '/pemilik-saas', label: 'Platform' }]
      : businessWorkspaces
  const activeWorkspace = isCustomerPage
    ? 'Pelanggan'
    : isOwnerPage
      ? 'Owner'
      : isAdminPage
        ? 'Admin'
        : isKapsterPage
          ? 'Kapster'
          : isPlatformPage
            ? 'Platform'
            : (isHomePage || isAccountPage) && workspaces.length === 1
              ? workspaces[0].label
              : undefined
  const items = activeWorkspace
    ? navigationFor(activeWorkspace, workspaces.find((workspace) => workspace.label === activeWorkspace)?.to)
    : [{ to: '/', label: 'Beranda', end: true }, { to: '/akun', label: 'Akun', end: true }]
  const hasWorkspaceSwitcher = workspaces.length > 1

  const logout = useMutation({
    mutationFn: async () => {
      try {
        await removePushSubscription()
      } catch {
        // Logout tetap dilanjutkan jika penghapusan subscription push gagal.
      }
      await api.POST('/v1/auth/logout')
    },
    onSuccess: () => {
      queryClient.clear()
      navigate('/masuk', { replace: true })
    },
  })

  return (
    <div className={`min-h-dvh bg-paper ${hasWorkspaceSwitcher ? 'pb-[calc(7rem+env(safe-area-inset-bottom))]' : 'pb-[calc(4.5rem+env(safe-area-inset-bottom))]'} md:pb-0`}>
      <header className="sticky top-0 z-30 border-b border-line bg-paper/95 px-4 backdrop-blur sm:px-6">
        <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-4">
          <Link to={customerContext ? '/pelanggan' : '/'} aria-label="Kapsflow, beranda" className="shrink-0 rounded-lg focus-visible:outline-2 focus-visible:outline-brand-ink">
            <Logo />
          </Link>
          {hasWorkspaceSwitcher && <nav aria-label="Pindah ruang" className="hidden min-w-0 flex-1 justify-center gap-1 overflow-x-auto md:flex">
            {workspaces.map((workspace) => <NavLink key={workspace.label} to={workspace.to} className={({ isActive }) => `inline-flex min-h-11 shrink-0 items-center rounded-xl px-3 text-sm font-semibold ${isActive ? 'bg-paper-raised text-ink' : 'text-body hover:bg-paper-raised'}`}>{workspace.label}</NavLink>)}
          </nav>}
          <nav aria-label="Menu ruang" className="hidden min-w-0 flex-1 justify-center gap-1 overflow-x-auto md:flex">
            {items.map((item) => <NavigationLink key={item.to} item={item} />)}
          </nav>
          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden max-w-40 truncate text-right text-sm text-body-muted sm:block">
              {user?.username || user?.email}
            </span>
            <Button type="button" variant="secondary" className="w-auto px-3" loading={logout.isPending} onClick={() => logout.mutate()}>
              Keluar
            </Button>
          </div>
        </div>
      </header>

      <Outlet />

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-1 backdrop-blur md:hidden">
        {hasWorkspaceSwitcher && <nav aria-label="Pindah ruang" className="flex gap-1 overflow-x-auto px-2">
          {workspaces.map((workspace) => <NavLink key={workspace.label} to={workspace.to} className={({ isActive }) => `inline-flex min-h-10 shrink-0 flex-1 items-center justify-center rounded-xl px-2 text-center text-xs font-semibold ${isActive ? 'bg-paper-raised text-ink' : 'text-body'}`}>{workspace.label}</NavLink>)}
        </nav>}
        <nav aria-label="Menu ruang" className="mt-1 flex gap-1 overflow-x-auto px-2">
          {items.map((item) => <NavigationLink key={item.to} item={item} mobile />)}
        </nav>
      </div>
    </div>
  )
}

function NavigationLink({ item, mobile = false }: { item: NavigationItem; mobile?: boolean }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) => `inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl px-3 text-center text-sm font-semibold focus-visible:outline-2 focus-visible:outline-brand-ink ${isActive ? 'bg-paper-raised text-ink' : 'text-body hover:bg-paper-raised'} ${mobile ? 'flex-1 text-xs' : ''}`}
    >
      {item.label}
    </NavLink>
  )
}

function navigationFor(workspace: string, workspacePath?: string): NavigationItem[] {
  const account: NavigationItem = { to: '/akun', label: 'Akun', end: true }
  const home: NavigationItem = { to: '/', label: 'Beranda', end: true }
  const customerHome: NavigationItem = { to: '/pelanggan', label: 'Beranda', end: true }

  switch (workspace) {
    case 'Owner':
      return [home, account, { to: '/pemilik', label: 'Bisnis', end: true }]
    case 'Admin':
      return [home, { to: workspacePath ?? '/admin', label: 'Kelola antrean' }, account]
    case 'Kapster':
      return [home, { to: '/kapster', label: 'Antrean kapster', end: true }, account]
    case 'Pelanggan':
      return [customerHome, { to: '/tiket', label: 'Tiket saya' }, { to: '/pelanggan/akun', label: 'Akun', end: true }]
    case 'Platform':
      return [home, { to: '/pemilik-saas', label: 'Ringkasan platform', end: true }, account]
    default:
      return [home, account]
  }
}
