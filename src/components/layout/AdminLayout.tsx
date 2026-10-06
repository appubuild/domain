import * as React from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/providers/AuthProvider';
import { ThemeToggle } from '@/providers/ThemeProvider';
import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/format';
import { Avatar, Badge, Button } from '@/components/ui/primitives';
import { DropdownMenu, Sheet } from '@/components/ui/overlays';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { CommandPalette, ShortcutsDialog } from '@/components/shared/CommandPalette';
import { useAdminOverview } from '@/hooks/queries';
import { useIsMobile } from '@/hooks/useMediaQuery';

const ADMIN_NAV: { title: string; items: { to: string; label: string; icon: string; exact?: boolean; badgeKey?: 'submissions' | 'reviews' | 'reports' }[] }[] = [
  {
    title: 'Overview',
    items: [
      { to: '/admin', label: 'Dashboard', icon: '◧', exact: true },
      { to: '/admin/analytics', label: 'Analytics', icon: '◔' },
    ],
  },
  {
    title: 'People',
    items: [
      { to: '/admin/users', label: 'Users', icon: '☺' },
      { to: '/admin/authors', label: 'Authors', icon: '✎' },
      { to: '/admin/subscriptions', label: 'Subscriptions', icon: '◇' },
    ],
  },
  {
    title: 'Catalogue',
    items: [
      { to: '/admin/books', label: 'Books', icon: '▤', badgeKey: 'submissions' },
      { to: '/admin/templates', label: 'Templates', icon: '▦' },
      { to: '/admin/categories', label: 'Categories & tags', icon: '⌗' },
      { to: '/admin/marketplace', label: 'Marketplace', icon: '◈' },
    ],
  },
  {
    title: 'Commerce',
    items: [
      { to: '/admin/orders', label: 'Orders', icon: '▧' },
      { to: '/admin/revenue', label: 'Revenue', icon: '◉' },
      { to: '/admin/plans', label: 'Plans', icon: '◆' },
    ],
  },
  {
    title: 'Moderation',
    items: [
      { to: '/admin/reviews', label: 'Reviews', icon: '★', badgeKey: 'reviews' },
      { to: '/admin/reports', label: 'Reports', icon: '⚑', badgeKey: 'reports' },
    ],
  },
  {
    title: 'Content',
    items: [
      { to: '/admin/cms', label: 'CMS', icon: '▣' },
      { to: '/admin/cms/homepage', label: 'Homepage', icon: '▤' },
      { to: '/admin/cms/pages', label: 'Pages', icon: '▥' },
      { to: '/admin/blog', label: 'Blog', icon: '◫' },
      { to: '/admin/promotions', label: 'Promotions', icon: '◈' },
      { to: '/admin/notifications', label: 'Notifications', icon: '◔' },
    ],
  },
  {
    title: 'Platform',
    items: [
      { to: '/admin/ai', label: 'AI controls', icon: '✦' },
      { to: '/admin/storage', label: 'Storage', icon: '▧' },
      { to: '/admin/flags', label: 'Feature flags', icon: '⚑' },
      { to: '/admin/email', label: 'Email', icon: '✉' },
      { to: '/admin/settings', label: 'Settings', icon: '⚙' },
      { to: '/admin/audit-logs', label: 'Audit log', icon: '⌚' },
    ],
  },
];

export function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const [navOpen, setNavOpen] = React.useState(false);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
  const { data: overview } = useAdminOverview();

  React.useEffect(() => setNavOpen(false), [location.pathname]);

  const nav = (
    <nav className="flex h-full flex-col gap-4 overflow-y-auto bg-slate-950 p-3 text-slate-300 scrollbar-thin" aria-label="Admin">
      <Link to="/admin" className="flex items-center gap-2 px-1.5 py-1 text-white">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-xs font-bold">S</span>
        <span className="font-display text-sm font-bold">Scriptora Admin</span>
      </Link>
      <Link
        to="/dashboard"
        className="rounded-lg border border-white/10 px-2.5 py-2 text-xs text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
      >
        ← Back to author workspace
      </Link>
      <div className="flex-1 space-y-4">
        {ADMIN_NAV.map((section) => (
          <div key={section.title}>
            <p className="mb-1.5 px-2 text-2xs font-semibold uppercase tracking-wide text-slate-500">{section.title}</p>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const badge = item.badgeKey && overview ? overview.pending[item.badgeKey] : 0;
                return (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.exact}
                      className={({ isActive }) =>
                        cn(
                          'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
                          isActive ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-white',
                        )
                      }
                    >
                      <span aria-hidden className="w-4 text-center text-xs opacity-70">
                        {item.icon}
                      </span>
                      <span className="flex-1 truncate">{item.label}</span>
                      {badge > 0 && (
                        <span className="rounded-full bg-amber-500/20 px-1.5 text-[10px] font-semibold text-amber-300">{badge}</span>
                      )}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );

  return (
    <div className="flex min-h-dvh bg-background">
      {!isMobile && <aside className="sticky top-0 hidden h-dvh w-[244px] shrink-0 md:block">{nav}</aside>}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-border bg-background/90 px-3 backdrop-blur sm:px-5">
          {isMobile && (
            <button
              type="button"
              aria-label="Open admin navigation"
              onClick={() => setNavOpen(true)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-input"
            >
              <span aria-hidden>☰</span>
            </button>
          )}
          <Badge variant="warning" className="hidden sm:inline-flex">
            Admin mode
          </Badge>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="flex h-9 flex-1 items-center gap-2 rounded-lg border border-input bg-card px-3 text-xs text-muted-foreground hover:text-foreground sm:max-w-sm"
          >
            <span aria-hidden>⌘</span>
            <span className="truncate">Jump to any admin screen…</span>
          </button>
          <div className="ml-auto flex items-center gap-1">
            {overview && (
              <span className="hidden items-center gap-3 text-2xs text-muted-foreground lg:flex">
                <span>{formatNumber(overview.users.total)} users</span>
                <span>{formatNumber(overview.books.total)} books</span>
                <span>{overview.pending.reports} open reports</span>
              </span>
            )}
            <ThemeToggle />
            <DropdownMenu
              trigger={
                <button type="button" className="rounded-full" aria-label="Admin account menu">
                  <Avatar name={user?.name ?? 'Admin'} src={user?.avatarUrl} size={30} />
                </button>
              }
              className="w-56"
              items={[
                { id: 'who', label: user?.name ?? 'Admin', hint: user?.role, disabled: true },
                { id: 'd1', label: '', divider: true },
                { id: 'dashboard', label: 'Author workspace', onSelect: () => navigate('/dashboard') },
                { id: 'public', label: 'Public website', onSelect: () => navigate('/') },
                { id: 'd2', label: '', divider: true },
                { id: 'logout', label: 'Sign out', destructive: true, onSelect: logout },
              ]}
            />
          </div>
        </header>
        <main className="flex-1 px-3 py-5 sm:px-5 sm:py-6">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
      {isMobile && (
        <Sheet open={navOpen} onOpenChange={setNavOpen} side="left" size="sm">
          <div className="h-full">{nav}</div>
        </Sheet>
      )}
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} onOpenShortcuts={() => setShortcutsOpen(true)} />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  );
}

export function AdminPageHeader({
  title,
  description,
  actions,
  breadcrumbs,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  breadcrumbs?: { label: string; href?: string }[];
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        {breadcrumbs && (
          <div className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            {breadcrumbs.map((item, index) => (
              <React.Fragment key={item.label}>
                {index > 0 && <span className="opacity-50">/</span>}
                {item.href ? (
                  <Link to={item.href} className="hover:text-foreground">
                    {item.label}
                  </Link>
                ) : (
                  <span>{item.label}</span>
                )}
              </React.Fragment>
            ))}
          </div>
        )}
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function UpgradePrompt({
  title,
  description,
  featureName,
}: {
  title: string;
  description: string;
  featureName?: string;
}) {
  const navigate = useNavigate();
  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-xl">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
          {featureName && <Badge variant="default" className="mt-2">{featureName}</Badge>}
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => navigate('/dashboard/subscription')}>
            Upgrade plan
          </Button>
          <Button size="sm" variant="outline" onClick={() => navigate('/pricing')}>
            Compare plans
          </Button>
        </div>
      </div>
    </div>
  );
}
