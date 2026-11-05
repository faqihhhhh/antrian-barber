import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { api } from '../api/client'
import { useMe } from '../auth/useMe'
import { removePushSubscription } from '../hooks/usePushNotifications'
import { Logo } from './Logo'

type NavigationItem = { to: string; label: string; end?: boolean }
type Workspace = { to: string; label: string }
type RoleChoice = { to: string; label: string; detail: string }

export default function AppShell() {
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false)
  const [roleMenuOpen, setRoleMenuOpen] = useState(false)
  const settingsMenuRef = useRef<HTMLDivElement>(null)
  const settingsTriggerRef = useRef<HTMLButtonElement>(null)
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
  const ownerMemberships = memberships.filter((membership) => membership.roles.includes('owner'))
  const adminMemberships = memberships.filter((membership) => membership.roles.includes('admin'))
  const kapsterMemberships = memberships.filter((membership) => membership.roles.includes('kapster'))
  const roleChoices: RoleChoice[] = [
    ...(ownerMemberships.length > 0 ? [{ to: '/pemilik', label: 'Owner', detail: ownerMemberships.map((membership) => membership.tenant_name).join(', ') }] : []),
    ...adminMemberships.flatMap((membership) => membership.outlets.length > 0
      ? membership.outlets.map((outlet) => ({ to: `/kelola/${membership.tenant_id}/${outlet.id}`, label: 'Admin', detail: `${membership.tenant_name} · ${outlet.name}` }))
      : [{ to: '/admin', label: 'Admin', detail: membership.tenant_name }]),
    ...(kapsterMemberships.length > 0 ? [{ to: '/kapster', label: 'Kapster', detail: kapsterMemberships.map((membership) => membership.tenant_name).join(', ') }] : []),
    ...(platformAdmin ? [{ to: '/pemilik-saas', label: 'Platform', detail: 'Pengelolaan Trimwait' }] : []),
  ]
  const customerContext = isCustomerPage
  const workspaces: Workspace[] = customerContext
    ? [{ to: '/tiket', label: 'Pelanggan' }]
    : isPlatformPage
      ? [{ to: '/pemilik-saas', label: 'Platform' }]
      : businessWorkspaces
  const adminPath = location.pathname.match(/^\/kelola\/([^/]+)\/([^/]+)/)
  const activeAdminPath = adminPath ? `/kelola/${adminPath[1]}/${adminPath[2]}` : workspaces.find((workspace) => workspace.label === 'Admin')?.to
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
  const activeWorkspacePath = activeWorkspace === 'Admin'
    ? activeAdminPath
    : workspaces.find((workspace) => workspace.label === activeWorkspace)?.to
  const items = activeWorkspace
    ? navigationFor(activeWorkspace, activeWorkspacePath)
    : [{ to: '/', label: 'Beranda', end: true }]
  useEffect(() => {
    if (!settingsMenuOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setSettingsMenuOpen(false)
      setRoleMenuOpen(false)
      settingsTriggerRef.current?.focus()
    }
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!settingsMenuRef.current?.contains(event.target as Node)) {
        setSettingsMenuOpen(false)
        setRoleMenuOpen(false)
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    window.addEventListener('pointerdown', closeOnOutsideClick)
    return () => {
      window.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('pointerdown', closeOnOutsideClick)
    }
  }, [settingsMenuOpen])

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
    <div className="min-h-dvh bg-paper pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
      <header className="sticky top-0 z-30 border-b border-line bg-paper/95 px-4 backdrop-blur sm:px-6">
        <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-4">
          <Link to={customerContext ? '/pelanggan' : '/'} aria-label="Trimwait, beranda" className="shrink-0 rounded-lg focus-visible:outline-2 focus-visible:outline-brand-ink">
            <Logo />
          </Link>
          <nav aria-label="Menu ruang" className="hidden min-w-0 flex-1 justify-center gap-1 overflow-x-auto md:flex">
            {items.map((item) => <NavigationLink key={item.to} item={item} />)}
          </nav>
          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden max-w-40 truncate text-right text-sm text-body-muted sm:block">
              {user?.display_name || user?.email}
            </span>
            <div ref={settingsMenuRef} className="relative">
              <button
                ref={settingsTriggerRef}
                type="button"
                aria-label="Pengaturan"
                aria-expanded={settingsMenuOpen}
                aria-controls="account-settings-menu"
                aria-haspopup="true"
                title="Pengaturan"
                className="inline-flex size-11 items-center justify-center rounded-full text-body-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-brand-ink"
                onClick={() => setSettingsMenuOpen((open) => {
                  if (open) setRoleMenuOpen(false)
                  return !open
                })}
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="size-6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 8.25a3.75 3.75 0 1 0 0 7.5 3.75 3.75 0 0 0 0-7.5Z" />
                  <path d="m19.4 15 .05.05a1.7 1.7 0 0 1-2.4 2.4l-.05-.05a1.7 1.7 0 0 0-2.9 1.2v.15a1.7 1.7 0 0 1-3.4 0v-.08a1.7 1.7 0 0 0-2.9-1.2l-.05.05a1.7 1.7 0 1 1-2.4-2.4l.05-.05a1.7 1.7 0 0 0-1.2-2.9h-.15a1.7 1.7 0 0 1 0-3.4h.08a1.7 1.7 0 0 0 1.2-2.9l-.05-.05a1.7 1.7 0 1 1 2.4-2.4l.05.05a1.7 1.7 0 0 0 2.9-1.2v-.15a1.7 1.7 0 0 1 3.4 0v.08a1.7 1.7 0 0 0 2.9 1.2l.05-.05a1.7 1.7 0 1 1 2.4 2.4l-.05.05a1.7 1.7 0 0 0 1.2 2.9h.15a1.7 1.7 0 0 1 0 3.4h-.08a1.7 1.7 0 0 0-1.2 2.9Z" />
                </svg>
              </button>
              {settingsMenuOpen && <div id="account-settings-menu" className="absolute right-0 top-full z-50 mt-2 min-w-52 rounded-xl border border-line bg-white p-1 shadow-lg">
                {roleChoices.length > 0 && <div>
                  <button
                    type="button"
                    aria-expanded={roleMenuOpen}
                    aria-controls="settings-role-menu"
                    className="flex min-h-11 w-full items-center justify-between rounded-lg px-3 text-left text-sm font-semibold text-body hover:bg-paper-raised focus-visible:outline-2 focus-visible:outline-brand-ink"
                    onClick={() => setRoleMenuOpen((open) => !open)}
                  >
                    Peran
                    <span aria-hidden="true" className="ml-4 text-xs">{roleMenuOpen ? '▲' : '▼'}</span>
                  </button>
                  {roleMenuOpen && <div id="settings-role-menu" className="ml-2 border-l border-line pl-2">
                    {roleChoices.map((choice) => <Link
                      key={`${choice.label}-${choice.to}`}
                      to={choice.to}
                      className="flex min-h-11 flex-col justify-center rounded-lg px-3 py-1 text-sm text-body hover:bg-paper-raised focus-visible:outline-2 focus-visible:outline-brand-ink"
                      onClick={() => { setSettingsMenuOpen(false); setRoleMenuOpen(false) }}
                    >
                      <span className="font-semibold">{choice.label}</span>
                      <span className="max-w-60 truncate text-xs text-body-muted">{choice.detail}</span>
                    </Link>)}
                  </div>}
                </div>}
                <Link
                  to={customerContext ? '/pelanggan/akun' : '/akun'}
                  className="flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-body hover:bg-paper-raised focus-visible:outline-2 focus-visible:outline-brand-ink"
                  onClick={() => { setSettingsMenuOpen(false); setRoleMenuOpen(false) }}
                >
                  Akun
                </Link>
                <button
                  type="button"
                  className="flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm font-semibold text-body hover:bg-paper-raised focus-visible:outline-2 focus-visible:outline-brand-ink disabled:opacity-60"
                  disabled={logout.isPending}
                  onClick={() => { setSettingsMenuOpen(false); setRoleMenuOpen(false); logout.mutate() }}
                >
                  {logout.isPending ? 'Memproses…' : 'Keluar'}
                </button>
              </div>}
            </div>
          </div>
        </div>
      </header>

      <Outlet />

      <div className="fixed inset-x-0 bottom-0 z-30 box-border h-16 overflow-hidden border-t border-line bg-white/95 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-1 backdrop-blur md:hidden">
        <nav aria-label="Menu ruang" className="flex h-full items-center gap-1 overflow-x-auto px-2">
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
      className={({ isActive }) => `inline-flex ${mobile ? 'min-h-10' : 'min-h-11'} shrink-0 items-center justify-center rounded-xl px-3 text-center text-sm font-semibold focus-visible:outline-2 focus-visible:outline-brand-ink ${isActive ? 'bg-paper-raised text-ink' : 'text-body hover:bg-paper-raised'} ${mobile ? 'flex-1 text-xs' : ''}`}
    >
      {item.label}
    </NavLink>
  )
}

function navigationFor(workspace: string, workspacePath?: string): NavigationItem[] {
  const home: NavigationItem = { to: '/', label: 'Beranda', end: true }
  const customerHome: NavigationItem = { to: '/pelanggan', label: 'Beranda', end: true }

  switch (workspace) {
    case 'Owner':
      return [home, { to: '/pemilik', label: 'Bisnis', end: true }, { to: '/pemilik/refund', label: 'Laporan refund' }]
    case 'Admin':
      return [home, { to: workspacePath ?? '/admin', label: 'Kelola antrean' }]
    case 'Kapster':
      return [home, { to: '/kapster', label: 'Antrean kapster', end: true }]
    case 'Pelanggan':
      return [customerHome, { to: '/tiket', label: 'Tiket saya' }]
    case 'Platform':
      return [home, { to: '/pemilik-saas', label: 'Ringkasan platform', end: true }]
    default:
      return [home]
  }
}
