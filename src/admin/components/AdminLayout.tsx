/**
 * Admin shell: fixed sidebar, sticky topbar and independently scrolling
 * content area. The sidebar collapses to icons on desktop and becomes an
 * off-canvas drawer below `lg`.
 */
import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  BarChart3,
  BellRing,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  Inbox,
  LayoutDashboard,
  LayoutTemplate,
  LogOut,
  Menu,
  Newspaper,
  PhoneCall,
  Search,
  Settings,
  ShieldCheck,
  Tags,
  Wrench,
  X,
} from 'lucide-react'
import { useAdminAuth } from '@/admin/context/AdminAuthContext'
import { ADMIN_CONFIG, storageKey } from '@/admin/config/adminConfig'
import { readJSON, writeJSON } from '@/admin/data/storage'
import { repository } from '@/admin/data/repository'
import type { AdminPreferences, LeadRecord } from '@/admin/types/admin'
import { ThemeToggle } from '@/components/ThemeToggle'
import { cn } from './ui'

interface NavItem {
  to: string
  label: string
  icon: typeof LayoutDashboard
  end?: boolean
}

interface NavGroup {
  label: string
  items: NavItem[]
}

export const ADMIN_NAV: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/admin/analytics', label: 'Analytics & Reports', icon: BarChart3 },
    ],
  },
  {
    label: 'Directory',
    items: [
      { to: '/admin/services', label: 'Services', icon: Wrench },
      { to: '/admin/numbers', label: 'Tracking Numbers', icon: PhoneCall },
      { to: '/admin/niches', label: 'Niches', icon: Tags },
    ],
  },
  {
    label: 'Content',
    items: [
      { to: '/admin/pages', label: 'Pages', icon: FileText },
      { to: '/admin/blog', label: 'Blog', icon: Newspaper },
      { to: '/admin/homepage', label: 'Homepage Sections', icon: LayoutTemplate },
    ],
  },
  {
    label: 'Growth',
    items: [{ to: '/admin/leads', label: 'Leads & Support', icon: Inbox }],
  },
  {
    label: 'Configuration',
    items: [
      { to: '/admin/settings', label: 'Website Settings', icon: Settings },
      { to: '/admin/seo', label: 'SEO Settings', icon: Search },
      { to: '/admin/profile', label: 'Profile & Security', icon: ShieldCheck },
    ],
  },
]

const PREFERENCES_KEY = storageKey(ADMIN_CONFIG.storage.preferences)

const readPreferences = (): AdminPreferences =>
  readJSON<AdminPreferences>(PREFERENCES_KEY, { sidebarCollapsed: false, dashboardRange: 30 })

const savePreferences = (preferences: AdminPreferences): void => writeJSON(PREFERENCES_KEY, preferences)

const useLeadCount = (): number => {
  const [count, setCount] = useState(0)
  useEffect(() => {
    let mounted = true
    repository
      .listLeads()
      .then((leads: LeadRecord[]) => {
        if (mounted) setCount(leads.filter((lead) => lead.status === 'new').length)
      })
      .catch(() => undefined)
    return () => {
      mounted = false
    }
  }, [])
  return count
}

export const AdminLayout = () => {
  const { user, signOut } = useAdminAuth()
  const location = useLocation()
  const [preferences, setPreferences] = useState<AdminPreferences>(readPreferences)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const newLeads = useLeadCount()

  const collapsed = preferences.sidebarCollapsed

  useEffect(() => {
    setMobileOpen(false)
    setMenuOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  const toggleCollapsed = () => {
    const next = { ...preferences, sidebarCollapsed: !preferences.sidebarCollapsed }
    setPreferences(next)
    savePreferences(next)
  }

  const currentLabel =
    ADMIN_NAV.flatMap((group) => group.items).find((item) =>
      item.end ? location.pathname === item.to : location.pathname.startsWith(item.to),
    )?.label ?? 'Dashboard'

  const navContent = (
    <div className="flex h-full min-h-0 flex-col bg-navy-950 text-navy-100">
      <div className={cn('flex h-16 shrink-0 items-center gap-2.5 border-b border-white/10 px-4', collapsed && 'justify-center px-2')}>
        <Link to="/admin" className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-600 font-display text-sm font-extrabold text-white">
            SH
          </span>
          {!collapsed ? (
            <span className="min-w-0">
              <span className="block truncate font-display text-sm font-bold text-white">Safe Home Network</span>
              <span className="block truncate text-2xs uppercase tracking-[0.16em] text-navy-300">
                {ADMIN_CONFIG.product.consoleName}
              </span>
            </span>
          ) : null}
        </Link>
      </div>

      <nav className="min-h-0 flex-1 space-y-5 overflow-y-auto px-2.5 py-4" aria-label="Admin navigation">
        {ADMIN_NAV.map((group) => (
          <div key={group.label}>
            {!collapsed ? (
              <p className="px-2.5 pb-1.5 text-2xs font-semibold uppercase tracking-[0.14em] text-navy-400">
                {group.label}
              </p>
            ) : (
              <div className="mx-auto mb-2 h-px w-8 bg-white/10" />
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon
                return (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      title={collapsed ? item.label : undefined}
                      className={({ isActive }) =>
                        cn(
                          'group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition',
                          collapsed && 'justify-center px-0',
                          isActive
                            ? 'bg-white/10 text-white shadow-inner'
                            : 'text-navy-200 hover:bg-white/5 hover:text-white',
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {isActive ? (
                            <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-brand-400" />
                          ) : null}
                          <Icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-brand-300' : 'text-navy-400 group-hover:text-white')} />
                          {!collapsed ? <span className="truncate">{item.label}</span> : null}
                          {!collapsed && item.to === '/admin/leads' && newLeads > 0 ? (
                            <span className="ml-auto rounded-full bg-brand-500 px-1.5 py-0.5 text-2xs font-bold text-white">
                              {newLeads}
                            </span>
                          ) : null}
                        </>
                      )}
                    </NavLink>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-white/10 p-2.5">
        <Link
          to="/"
          target="_blank"
          rel="noreferrer"
          className={cn(
            'flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-navy-300 transition hover:bg-white/5 hover:text-white',
            collapsed && 'justify-center px-0',
          )}
          title="Open the public website"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {!collapsed ? <span>View public site</span> : null}
        </Link>
        {!collapsed ? (
          <p className="px-2.5 pt-1 text-2xs text-navy-500">
            {ADMIN_CONFIG.version} · demo data
          </p>
        ) : null}
      </div>
    </div>
  )

  return (
    <div className="flex h-dvh overflow-hidden bg-page text-ink">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          'hidden shrink-0 border-r border-navy-900/40 transition-[width] duration-200 lg:block',
          collapsed ? 'w-[4.75rem]' : 'w-64',
        )}
      >
        {navContent}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-[100] lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
            className="absolute inset-0 bg-navy-950/60 backdrop-blur-sm animate-fade-in"
          />
          <div className="absolute inset-y-0 left-0 w-72 shadow-float animate-slide-in-left">
            <div className="h-full">{navContent}</div>
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation"
              className="absolute right-2 top-3 rounded-lg p-2 text-navy-300 hover:bg-white/10 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-line bg-surface px-4 sm:px-6">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="rounded-lg p-2 text-muted transition hover:bg-soft hover:text-ink lg:hidden"
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={toggleCollapsed}
            className="hidden rounded-lg p-2 text-muted transition hover:bg-soft hover:text-ink lg:inline-flex"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
          </button>

          <div className="min-w-0">
            <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-muted">Admin</p>
            <p className="truncate font-display text-sm font-bold text-ink">{currentLabel}</p>
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            <span className="mr-1 hidden rounded-full bg-amber-50 px-2.5 py-1 text-2xs font-semibold uppercase tracking-wide text-amber-700 ring-1 ring-inset ring-amber-300/60 sm:inline-flex dark:bg-amber-600/15 dark:text-amber-300 dark:ring-amber-700/40">
              Phase 1 · demo
            </span>
            <Link
              to="/admin/leads"
              className="relative rounded-lg p-2 text-muted transition hover:bg-soft hover:text-ink"
              aria-label={`Leads inbox${newLeads > 0 ? `, ${newLeads} new` : ''}`}
            >
              <BellRing className="h-4 w-4" />
              {newLeads > 0 ? (
                <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-surface" />
              ) : null}
            </Link>
            <ThemeToggle />

            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className="flex items-center gap-2 rounded-xl border border-line bg-surface px-1.5 py-1.5 transition hover:bg-soft"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-2xs font-bold text-white">
                  {user?.initials ?? 'DA'}
                </span>
                <span className="hidden min-w-0 text-left sm:block">
                  <span className="block max-w-[9rem] truncate text-xs font-semibold text-ink">{user?.name}</span>
                  <span className="block text-2xs text-muted">{user?.role}</span>
                </span>
              </button>
              {menuOpen ? (
                <div
                  role="menu"
                  className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-xl border border-line bg-surface shadow-float animate-slide-down"
                >
                  <div className="border-b border-line px-3 py-2.5">
                    <p className="truncate text-xs font-semibold text-ink">{user?.email}</p>
                    <p className="text-2xs text-muted">Demo session · {ADMIN_CONFIG.demo.sessionHours}h</p>
                  </div>
                  <Link
                    to="/admin/profile"
                    role="menuitem"
                    className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-ink transition hover:bg-soft"
                  >
                    <ShieldCheck className="h-3.5 w-3.5 text-muted" /> Profile &amp; security
                  </Link>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => signOut('You signed out.')}
                    className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-rose-600 transition hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/40"
                  >
                    <LogOut className="h-3.5 w-3.5" /> Sign out
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[88rem] px-4 py-6 sm:px-6 lg:px-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
