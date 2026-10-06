import * as React from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/providers/AuthProvider';
import { useTheme, ThemeToggle } from '@/providers/ThemeProvider';
import { useNav, useFooter, usePromos } from '@/hooks/queries';
import { cmsService } from '@/services';
import { cn, truncate } from '@/lib/utils';
import { Avatar, Badge, Button, Input } from '@/components/ui/primitives';
import { useSearch } from '@/hooks/queries';
import { searchService } from '@/services';
import { useDebounce } from '@/hooks/useDebounce';
import { Seo } from '@/components/shared/Seo';

function Logo({ onClick }: { onClick?: () => void }) {
  const { siteTheme } = useTheme();
  return (
    <Link to="/" onClick={onClick} className="flex items-center gap-2" aria-label={`${siteTheme.logoText} home`}>
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-gradient text-sm font-bold text-white shadow-soft">
        <svg width="16" height="16" viewBox="0 0 32 32" fill="currentColor" aria-hidden>
          <path d="M9 7h9.5a5.5 5.5 0 0 1 0 11H13v7H9V7Zm4 3.5v4h5a2 2 0 0 0 0-4h-5Z" />
          <circle cx="23" cy="23" r="3" />
        </svg>
      </span>
      <span className="font-display text-lg font-bold tracking-tight text-foreground">{siteTheme.logoText}</span>
    </Link>
  );
}

function GlobalSearch() {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const debounced = useDebounce(query, 250);
  const { data, isFetching } = useSearch(debounced);
  const navigate = useNavigate();
  const [recent, setRecent] = React.useState<string[]>(() => searchService.recent());

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        setOpen(true);
      }
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const go = (path: string, label: string) => {
    searchService.pushRecent(label);
    setRecent(searchService.recent());
    setOpen(false);
    setQuery('');
    navigate(path);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden items-center gap-2 rounded-lg border border-input bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground md:flex"
        aria-label="Search books, authors and templates"
      >
        <span aria-hidden>⌕</span>
        Search books, authors, templates
        <kbd className="ml-2 rounded border border-border px-1 font-mono text-[10px]">⌘P</kbd>
      </button>
      {open && (
        <div className="fixed inset-0 z-[150] flex items-start justify-center p-4 pt-[10vh]">
          <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm" onClick={() => setOpen(false)} aria-hidden />
          <div role="dialog" aria-modal="true" aria-label="Search" className="relative w-full max-w-xl animate-scale-in overflow-hidden rounded-xl border border-border bg-popover shadow-lift">
            <div className="flex items-center gap-3 border-b border-border px-4 py-3">
              <span className="text-muted-foreground">⌕</span>
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search books, authors, templates and categories…"
                aria-label="Search query"
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              {isFetching && <span className="text-2xs text-muted-foreground">Searching…</span>}
            </div>
            <div className="max-h-[55vh] overflow-y-auto p-2 scrollbar-thin">
              {!query && recent.length > 0 && (
                <div className="mb-2">
                  <p className="px-3 py-1.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Recent searches</p>
                  {recent.map((entry) => (
                    <button
                      key={entry}
                      type="button"
                      onClick={() => setQuery(entry)}
                      className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                    >
                      <span>{entry}</span>
                      <span className="text-2xs text-muted-foreground">recent</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      searchService.clearRecent();
                      setRecent([]);
                    }}
                    className="mt-1 px-3 text-2xs text-primary hover:underline"
                  >
                    Clear recent searches
                  </button>
                </div>
              )}
              {data && data.books.length > 0 && (
                <div className="mb-2">
                  <p className="px-3 py-1.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Books</p>
                  {data.books.map((book) => (
                    <button key={book.id} type="button" onClick={() => go(`/marketplace/${book.id}`, book.title)} className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-muted">
                      <img src={book.cover.imageUrl} alt="" className="h-10 w-7 rounded object-cover" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-foreground">{book.title}</span>
                        <span className="block truncate text-2xs text-muted-foreground">{book.authorName} · {book.kind.replace('-', ' ')}</span>
                      </span>
                      <span className="text-2xs text-muted-foreground">${book.marketplace.price.toFixed(2)}</span>
                    </button>
                  ))}
                </div>
              )}
              {data && data.authors.length > 0 && (
                <div className="mb-2">
                  <p className="px-3 py-1.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Authors</p>
                  {data.authors.map((author) => (
                    <button key={author.id} type="button" onClick={() => go(`/authors/${author.username}`, author.name)} className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-muted">
                      <Avatar name={author.name} src={author.avatarUrl} size={28} />
                      <span className="text-sm text-foreground">{author.name}</span>
                      <span className="ml-auto text-2xs text-muted-foreground">@{author.username}</span>
                    </button>
                  ))}
                </div>
              )}
              {data && data.templates.length > 0 && (
                <div className="mb-2">
                  <p className="px-3 py-1.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Templates</p>
                  {data.templates.map((template) => (
                    <button key={template.id} type="button" onClick={() => go(`/templates/${template.slug}`, template.name)} className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left hover:bg-muted">
                      <span className="text-sm text-foreground">{template.name}</span>
                      <span className="text-2xs text-muted-foreground">{template.style}</span>
                    </button>
                  ))}
                </div>
              )}
              {data && data.categories.length > 0 && (
                <div className="mb-2">
                  <p className="px-3 py-1.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Categories</p>
                  {data.categories.map((category) => (
                    <button key={category.id} type="button" onClick={() => go(`/marketplace?category=${category.slug}`, category.name)} className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left hover:bg-muted">
                      <span className="text-sm text-foreground">{category.name}</span>
                      <span className="text-2xs text-muted-foreground">{category.bookCount} books</span>
                    </button>
                  ))}
                </div>
              )}
              {query && data && data.total === 0 && (
                <div className="px-3 py-8 text-center">
                  <p className="text-sm text-foreground">No results for “{query}”</p>
                  <p className="mt-1 text-xs text-muted-foreground">Try author names, genres such as “cookbook”, or a template style.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function PromoBar() {
  const { data: promos } = usePromos(true);
  const navigate = useNavigate();
  const promo = promos?.find((entry) => entry.placement === 'top-bar');
  if (!promo) return null;
  return (
    <div className="bg-brand-gradient px-4 py-2 text-center text-xs text-white">
      <span>{promo.message}</span>
      <button
        type="button"
        className="ml-3 font-semibold underline underline-offset-2"
        onClick={() => {
          cmsService.trackPromoClick(promo.id);
          navigate(promo.ctaHref);
        }}
      >
        {promo.ctaLabel} →
      </button>
    </div>
  );
}

export function PublicLayout() {
  const { user, isAuthenticated, isAdmin } = useAuth();
  const { siteTheme } = useTheme();
  const { data: headerNav } = useNav('header');
  const { data: footer } = useFooter();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = React.useState(false);

  React.useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const footerColumns = [
    { key: 'footer-product', title: 'Product' },
    { key: 'footer-resources', title: 'Resources' },
    { key: 'footer-company', title: 'Company' },
    { key: 'footer-legal', title: 'Legal' },
  ] as const;

  return (
    <div className="flex min-h-dvh flex-col">
      <Seo
        title={siteTheme.logoText}
        description="Scriptora is the easiest place to write, design, format and publish a book."
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'Organization',
          name: siteTheme.logoText,
          url: typeof window !== 'undefined' ? window.location.origin : '',
          description: 'Book creation, design, publishing and marketplace platform.',
        }}
      />
      {siteTheme.announcement.enabled && <PromoBar />}
      <header className="sticky top-0 z-50 border-b border-border/80 bg-background/85 backdrop-blur-md">
        <div className="container flex h-16 items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <Logo />
            <nav className="hidden items-center gap-1 lg:flex" aria-label="Main">
              {headerNav?.map((item) => (
                <NavLink
                  key={item.id}
                  to={item.href}
                  className={({ isActive }) =>
                    cn(
                      'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                      isActive ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )
                  }
                >
                  {item.label}
                  {item.badge && <span className="ml-1.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">{item.badge}</span>}
                </NavLink>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <GlobalSearch />
            <ThemeToggle />
            {isAuthenticated ? (
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => navigate('/dashboard')} className="hidden sm:inline-flex">
                  Dashboard
                </Button>
                {isAdmin && (
                  <Button size="sm" variant="ghost" onClick={() => navigate('/admin')} className="hidden sm:inline-flex">
                    Admin
                  </Button>
                )}
                <button type="button" onClick={() => navigate('/dashboard')} aria-label="Your account" className="rounded-full">
                  <Avatar name={user?.name ?? 'You'} src={user?.avatarUrl} size={32} />
                </button>
              </div>
            ) : (
              <div className="hidden items-center gap-2 sm:flex">
                <Button size="sm" variant="ghost" onClick={() => navigate('/login')}>
                  Sign in
                </Button>
                <Button size="sm" onClick={() => navigate('/register')}>
                  Start writing
                </Button>
              </div>
            )}
            <button
              type="button"
              aria-label="Open menu"
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen((value) => !value)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-input lg:hidden"
            >
              <span aria-hidden>{mobileOpen ? '×' : '☰'}</span>
            </button>
          </div>
        </div>
        {mobileOpen && (
          <div className="border-t border-border bg-card px-4 py-3 lg:hidden">
            <nav className="flex flex-col" aria-label="Mobile">
              {headerNav?.map((item) => (
                <NavLink
                  key={item.id}
                  to={item.href}
                  className={({ isActive }) =>
                    cn('rounded-lg px-3 py-2.5 text-sm font-medium', isActive ? 'bg-muted text-foreground' : 'text-muted-foreground')
                  }
                >
                  {item.label}
                </NavLink>
              ))}
              <div className="mt-3 flex gap-2 border-t border-border pt-3">
                {isAuthenticated ? (
                  <>
                    <Button size="sm" className="flex-1" onClick={() => navigate('/dashboard')}>
                      Dashboard
                    </Button>
                    {isAdmin && (
                      <Button size="sm" variant="outline" className="flex-1" onClick={() => navigate('/admin')}>
                        Admin
                      </Button>
                    )}
                  </>
                ) : (
                  <>
                    <Button size="sm" variant="outline" className="flex-1" onClick={() => navigate('/login')}>
                      Sign in
                    </Button>
                    <Button size="sm" className="flex-1" onClick={() => navigate('/register')}>
                      Start writing
                    </Button>
                  </>
                )}
              </div>
            </nav>
          </div>
        )}
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-border bg-card">
        <div className="container grid gap-10 py-12 lg:grid-cols-[1.4fr_repeat(4,1fr)]">
          <div>
            <Logo />
            <p className="mt-3 max-w-xs text-sm text-muted-foreground">{footer?.tagline}</p>
            <div className="mt-4">
              <p className="text-sm font-medium text-foreground">{footer?.newsletterHeadline}</p>
              <p className="mt-1 text-xs text-muted-foreground">{footer?.newsletterBody}</p>
              <form
                className="mt-3 flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  const input = (event.target as HTMLFormElement).elements.namedItem('email') as HTMLInputElement;
                  if (input.value) {
                    input.value = '';
                    navigate('/contact?subscribed=1');
                  }
                }}
              >
                <Input name="email" type="email" required placeholder="you@example.com" aria-label="Email address" className="h-9" />
                <Button size="sm" type="submit">
                  Subscribe
                </Button>
              </form>
            </div>
          </div>
          {footerColumns.map((column) => (
            <FooterColumn key={column.key} location={column.key} title={column.title} />
          ))}
        </div>
        <div className="border-t border-border">
          <div className="container flex flex-col items-center justify-between gap-3 py-5 text-xs text-muted-foreground sm:flex-row">
            <p>{footer?.copyright}</p>
            <div className="flex items-center gap-3">
              {footer?.social.map((social) => (
                <a key={social.id} href={social.href} className="transition-colors hover:text-foreground" target="_blank" rel="noreferrer noopener">
                  {social.label}
                </a>
              ))}
              <Badge variant="secondary">v1.0 · Phase 1 mock</Badge>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FooterColumn({ location, title }: { location: 'footer-product' | 'footer-resources' | 'footer-company' | 'footer-legal'; title: string }) {
  const { data: items } = useNav(location);
  return (
    <div>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <ul className="mt-3 space-y-2">
        {items?.map((item) => (
          <li key={item.id}>
            <Link to={item.href} className="text-sm text-muted-foreground transition-colors hover:text-foreground" title={truncate(item.label, 40)}>
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
