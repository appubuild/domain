import * as React from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/providers/AuthProvider';
import { useTheme, ThemeToggle } from '@/providers/ThemeProvider';
import { useNotifications, usePromos } from '@/hooks/queries';
import { notificationService } from '@/services';
import { cn } from '@/lib/utils';
import { timeAgo } from '@/lib/format';
import { Avatar, Badge, Button, Progress, Tooltip } from '@/components/ui/primitives';
import { DropdownMenu, Sheet } from '@/components/ui/overlays';
import { CommandPalette, ShortcutsDialog } from '@/components/shared/CommandPalette';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { formatBytes } from '@/lib/utils';

const NAV_SECTIONS: { title: string; items: { to: string; label: string; icon: string; exact?: boolean }[] }[] = [
  {
    title: 'Workspace',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: '◧', exact: true },
      { to: '/dashboard/books', label: 'My books', icon: '▤' },
      { to: '/dashboard/templates', label: 'Templates', icon: '▦' },
      { to: '/dashboard/assets', label: 'Assets', icon: '▣' },
      { to: '/dashboard/ai', label: 'AI Studio', icon: '✦' },
    ],
  },
  {
    title: 'Publish',
    items: [
      { to: '/dashboard/publishing', label: 'Publishing centre', icon: '▲' },
      { to: '/dashboard/exports', label: 'Export centre', icon: '⇩' },
      { to: '/dashboard/marketplace', label: 'My listings', icon: '◈' },
    ],
  },
  {
    title: 'Business',
    items: [
      { to: '/dashboard/earnings', label: 'Earnings', icon: '◉' },
      { to: '/dashboard/analytics', label: 'Analytics', icon: '◔' },
      { to: '/dashboard/reviews', label: 'Reviews', icon: '★' },
    ],
  },
  {
    title: 'Reading',
    items: [
      { to: '/dashboard/library', label: 'Library', icon: '▥' },
      { to: '/dashboard/wishlist', label: 'Wishlist', icon: '♡' },
    ],
  },
  {
    title: 'Account',
    items: [
      { to: '/dashboard/profile', label: 'Author profile', icon: '☺' },
      { to: '/dashboard/subscription', label: 'Subscription', icon: '◇' },
      { to: '/dashboard/settings', label: 'Settings', icon: '⚙' },
    ],
  },
];

function NotificationsMenu() {
  const { userId } = useAuth();
  const { data: notifications } = useNotifications(userId ?? undefined);
  const navigate = useNavigate();
  const items = (notifications ?? []).slice(0, 6);
  const unread = (notifications ?? []).filter((item) => !item.read).length;

  return (
    <DropdownMenu
      className="w-[380px] p-0"
      trigger={
        <button
          type="button"
          aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}
          className="relative inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <span aria-hidden className="text-base">◔</span>
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
      }
      items={[
        {
          id: 'header',
          label: unread ? `${unread} unread` : 'All caught up',
          disabled: true,
          hint: undefined,
        },
        ...items.map((notification) => ({
          id: notification.id,
          label: notification.title,
          hint: timeAgo(notification.createdAt),
          onSelect: () => {
            notificationService.markRead(notification.id);
            if (notification.link) navigate(notification.link);
          },
        })),
        { id: 'divider', label: '', divider: true },
        {
          id: 'mark-all',
          label: 'Mark all as read',
          onSelect: () => {
            if (userId) notificationService.markAllRead(userId);
          },
        },
        { id: 'open', label: 'Open notification centre', onSelect: () => navigate('/dashboard/notifications') },
      ]}
    />
  );
}

function UpgradeCard() {
  const { entitlements } = useAuth();
  const navigate = useNavigate();
  const storagePercent = entitlements.usage.storage.percent;
  const aiPercent = entitlements.usage.aiCredits.percent;
  if (entitlements.plan.slug !== 'free') {
    return (
      <div className="rounded-xl border border-border bg-muted/50 p-3">
        <p className="text-xs font-semibold text-foreground">{entitlements.plan.name} plan</p>
        <div className="mt-2 space-y-2.5">
          <div>
            <p className="mb-1 flex justify-between text-2xs text-muted-foreground">
              <span>AI credits</span>
              <span className="tabular-nums">
                {entitlements.usage.aiCredits.used}/{entitlements.usage.aiCredits.limit}
              </span>
            </p>
            <Progress value={aiPercent} className="h-1" />
          </div>
          <div>
            <p className="mb-1 flex justify-between text-2xs text-muted-foreground">
              <span>Storage</span>
              <span className="tabular-nums">{formatBytes(entitlements.usage.storage.usedBytes, 1)}</span>
            </p>
            <Progress value={storagePercent} className="h-1" />
          </div>
        </div>
        <Link to="/dashboard/subscription" className="mt-2.5 inline-block text-2xs font-medium text-primary hover:underline">
          Manage plan →
        </Link>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
      <p className="text-xs font-semibold text-foreground">Go Pro to publish & sell</p>
      <p className="mt-1 text-2xs text-muted-foreground">
        Print profiles, EPUB 3 export, premium templates and marketplace selling from $19/month.
      </p>
      <Button size="xs" className="mt-2.5 w-full" onClick={() => navigate('/dashboard/subscription')}>
        View plans
      </Button>
    </div>
  );
}

export function DashboardLayout() {
  const { user, isAdmin, entitlements, logout } = useAuth();
  const { siteTheme } = useTheme();
  const { data: promos } = usePromos(true);
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);

  React.useEffect(() => setMobileNavOpen(false), [location.pathname]);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing = ['INPUT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(true);
      }
      if (!typing && event.key === '?') {
        event.preventDefault();
        setShortcutsOpen(true);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const banner = promos?.find((promo) => promo.placement === 'dashboard');

  const nav = (
    <nav className="flex h-full flex-col gap-5 overflow-y-auto p-3 scrollbar-thin" aria-label="Dashboard">
      <Link to="/dashboard" className="flex items-center gap-2 px-1.5 py-1" aria-label="Scriptora dashboard">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-gradient text-xs font-bold text-white">
          <svg width="14" height="14" viewBox="0 0 32 32" fill="currentColor" aria-hidden>
            <path d="M9 7h9.5a5.5 5.5 0 0 1 0 11H13v7H9V7Zm4 3.5v4h5a2 2 0 0 0 0-4h-5Z" />
            <circle cx="23" cy="23" r="3" />
          </svg>
        </span>
        <span className="font-display text-base font-bold">{siteTheme.logoText}</span>
      </Link>

      <Button size="sm" className="w-full justify-start gap-2" onClick={() => navigate('/dashboard/books/new')}>
        <span aria-hidden>＋</span> New book
      </Button>

      <div className="flex-1 space-y-5">
        {NAV_SECTIONS.map((section) => (
          <div key={section.title}>
            <p className="mb-1.5 px-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{section.title}</p>
            <ul className="space-y-0.5">
              {section.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.exact}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
                        isActive ? 'bg-sidebar-accent text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      )
                    }
                  >
                    <span aria-hidden className="w-4 text-center text-xs opacity-70">
                      {item.icon}
                    </span>
                    <span className="truncate">{item.label}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {isAdmin && (
          <div>
            <p className="mb-1.5 px-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Platform</p>
            <NavLink
              to="/admin"
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
                  isActive ? 'bg-sidebar-accent text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )
              }
            >
              <span aria-hidden className="w-4 text-center text-xs opacity-70">
                ⬢
              </span>
              Admin panel
            </NavLink>
          </div>
        )}
      </div>

      <UpgradeCard />
    </nav>
  );

  return (
    <div className="flex min-h-dvh bg-background">
      {!isMobile && (
        <aside className="sticky top-0 hidden h-dvh w-[248px] shrink-0 border-r border-sidebar-border bg-sidebar md:block">{nav}</aside>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-md">
          {banner && (
            <div className="flex flex-wrap items-center justify-center gap-2 bg-primary/10 px-4 py-1.5 text-xs text-foreground">
              <span>{banner.message}</span>
              <button type="button" className="font-semibold text-primary underline underline-offset-2" onClick={() => navigate(banner.ctaHref)}>
                {banner.ctaLabel}
              </button>
            </div>
          )}
          <div className="flex h-14 items-center gap-2 px-3 sm:px-5">
            {isMobile && (
              <button
                type="button"
                aria-label="Open navigation"
                onClick={() => setMobileNavOpen(true)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-input"
              >
                <span aria-hidden>☰</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="flex h-9 flex-1 items-center gap-2 rounded-lg border border-input bg-card px-3 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground sm:max-w-md"
            >
              <span aria-hidden>⌘</span>
              <span className="truncate">Search commands, books and pages…</span>
              <kbd className="ml-auto hidden rounded border border-border px-1 font-mono text-[10px] sm:block">⌘K</kbd>
            </button>
            <div className="ml-auto flex items-center gap-1">
              <Tooltip content="Keyboard shortcuts" shortcut="?">
                <button
                  type="button"
                  onClick={() => setShortcutsOpen(true)}
                  aria-label="Keyboard shortcuts"
                  className="hidden h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:inline-flex"
                >
                  <span aria-hidden>?</span>
                </button>
              </Tooltip>
              <ThemeToggle />
              <NotificationsMenu />
              <DropdownMenu
                trigger={
                  <button type="button" className="ml-1 flex items-center gap-2 rounded-full" aria-label="Account menu">
                    <Avatar name={user?.name ?? 'You'} src={user?.avatarUrl} size={30} />
                  </button>
                }
                className="w-60"
                items={[
                  { id: 'identity', label: user?.name ?? 'Account', hint: entitlements.plan.name, disabled: true },
                  { id: 'divider-1', label: '', divider: true },
                  { id: 'profile', label: 'Author profile', onSelect: () => navigate(`/authors/${user?.username ?? ''}`) },
                  { id: 'account', label: 'Account settings', onSelect: () => navigate('/dashboard/settings') },
                  { id: 'subscription', label: 'Subscription & billing', onSelect: () => navigate('/dashboard/subscription') },
                  { id: 'activity', label: 'Recent activity', onSelect: () => navigate('/dashboard/activity') },
                  { id: 'divider-2', label: '', divider: true },
                  { id: 'theme-light', label: 'Light mode', onSelect: () => document.documentElement.classList.remove('dark') },
                  { id: 'public-site', label: 'Public website', onSelect: () => navigate('/') },
                  { id: 'divider-3', label: '', divider: true },
                  { id: 'logout', label: 'Sign out', destructive: true, onSelect: logout },
                ]}
              />
            </div>
          </div>
        </header>

        <main className="flex-1 px-3 py-5 sm:px-5 sm:py-6">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>

      {isMobile && (
        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen} side="left" size="sm">
          <div className="h-full bg-sidebar">{nav}</div>
        </Sheet>
      )}

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} onOpenShortcuts={() => setShortcutsOpen(true)} />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  );
}

