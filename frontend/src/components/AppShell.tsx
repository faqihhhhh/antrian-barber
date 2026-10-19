import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, NavLink, Outlet, useNavigate } from 'react-router'
import { api } from '../api/client'
import { useMe } from '../auth/useMe'
import { removePushSubscription } from '../hooks/usePushNotifications'
import { Logo } from './Logo'
import { Button } from './ui'

type NavigationItem = { to: string; label: string; end?: boolean }

export default function AppShell() {
  const me = useMe()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const user = me.data?.user
  const memberships = me.data?.memberships ?? []
  const isKapster = memberships.some((membership) => membership.roles.includes('kapster'))
  const manageMembership = memberships.find((membership) =>
    membership.roles.includes('owner') || membership.roles.includes('admin'),
  )
  const manageOutlet = manageMembership?.outlets[0]
  const isOwner = memberships.some((membership) => membership.roles.includes('owner'))
  const items: NavigationItem[] = [
    { to: '/', label: 'Beranda', end: true },
    { to: '/tiket', label: 'Tiket saya' },
    ...(isOwner ? [{ to: '/pemilik', label: 'Bisnis' }] : []),
    ...(isKapster ? [{ to: '/kapster', label: 'Kapster' }] : []),
    ...(manageMembership && manageOutlet
      ? [{ to: `/kelola/${manageMembership.tenant_id}/${manageOutlet.id}`, label: 'Kelola antrean' }]
      : manageMembership ? [{ to: '/admin', label: 'Kelola antrean' }] : []),
    ...(me.data?.is_platform_admin ? [{ to: '/pemilik-saas', label: 'Platform' }] : []),
  ]

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
    <div className="min-h-dvh bg-paper pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0">
      <header className="sticky top-0 z-30 border-b border-line bg-paper/95 px-4 backdrop-blur sm:px-6">
        <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-4">
          <Link to="/" aria-label="Kapsflow, beranda" className="shrink-0 rounded-lg focus-visible:outline-2 focus-visible:outline-brand-ink">
            <Logo />
          </Link>
          <nav aria-label="Navigasi utama" className="hidden min-w-0 flex-1 justify-center gap-1 overflow-x-auto md:flex">
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

      <nav aria-label="Navigasi utama" className="fixed inset-x-0 bottom-0 z-30 flex gap-1 overflow-x-auto border-t border-line bg-white/95 px-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 backdrop-blur md:hidden">
        {items.map((item) => <NavigationLink key={item.to} item={item} mobile />)}
      </nav>
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
