"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronLeft, LogOut, Menu, ShieldAlert } from "lucide-react";
import { useAdminSession } from "@/lib/auth/use-session";
import { ADMIN_NAV, activeNavHref } from "@/lib/admin/resources";
import { Button, ButtonLink, Callout, Drawer, Spinner } from "@/components/ui";
import { cn } from "@/lib/utils/format";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { NavIcon, iconForHref } from "./nav-icons";

/**
 * Admin shell.
 *
 * This gate is a UX convenience. **Authorization lives in Postgres RLS** — every table the
 * admin screens touch is protected by policies that call `is_admin()`. Removing this
 * component would expose empty pages, not data.
 *
 * Layout contract (Phase 1 of the UI/UX upgrade):
 *
 *   - the shell fills the viewport below the site header, so the admin area is not a card
 *     floating inside a marketing page;
 *   - the sidebar and the content column each own their scroll container. Nothing scrolls
 *     the `body`, which is what previously made the sidebar drift away from its own nav and
 *     produced a second scrollbar at the bottom of the window;
 *   - below `lg` the same navigation moves into a left drawer, because a 15 rem column and a
 *     data table cannot share a phone screen.
 *
 * The height is `calc(100dvh - <header>)` rather than `h-screen`: the site header stays
 * visible and is 3.5 rem tall (`--site-header-h`), and `dvh` keeps mobile browser chrome from
 * hiding the last row of a table.
 */
export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { status, email, error, signOut } = useAdminSession();
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  if (status === "loading") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex min-h-[60dvh] items-center justify-center gap-3 text-sm text-fg-muted"
      >
        {/* The shell is prerendered without content, so it carries the page's only heading —
            a screen reader arriving before hydration still lands somewhere with a name. */}
        <h1 className="sr-only">Administration</h1>
        <Spinner /> Checking your session…
      </div>
    );
  }

  if (status === "unconfigured") {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16">
        <h1 className="sr-only">Administration</h1>
        <Callout tone="warn" title="Admin area unavailable">
          Supabase is not configured for this build, so there is no authentication provider and no database to
          manage. Apply the migrations, set the two public Supabase environment variables and rebuild. This page
          deliberately does not simulate a login.
        </Callout>
        <ButtonLink href="/" variant="secondary" className="mt-4">
          Back to the site
        </ButtonLink>
      </div>
    );
  }

  if (status === "signed-out") {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-16">
        <h1 className="text-xl font-semibold">Administrator sign in</h1>
        <p className="mt-1 text-sm text-fg-muted">This area requires an account with an administrator role.</p>
        <ButtonLink href="/admin/login/" className="mt-4">
          Go to sign in
        </ButtonLink>
      </div>
    );
  }

  if (status === "forbidden") {
    return (
      <div className="mx-auto w-full max-w-xl px-4 py-16">
        <Callout tone="danger" title="No administrator role on this account" icon={<ShieldAlert className="size-4" />}>
          You are signed in{email ? ` as ${email}` : ""}, but this account has no admin role. Ask an owner to grant
          one by inserting a row into <code>user_roles</code>. Database policies will reject admin queries until
          then, regardless of what the interface shows.
        </Callout>
        {error ? <p className="mt-2 text-xs text-fg-subtle">{error}</p> : null}
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" onClick={() => void signOut()}>
            Sign out
          </Button>
          <ButtonLink href="/" variant="ghost">
            Back to the site
          </ButtonLink>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100dvh-var(--site-header-h))] w-full overflow-hidden">
      {/* Desktop sidebar: its own scroll area, pinned beside the content. */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface/50 lg:flex">
        <div className="flex items-center gap-2 border-b border-border px-3 py-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-accent text-[11px] font-bold text-accent-fg">
            DF
          </span>
          <div className="min-w-0">
            <p className="truncate text-[12.5px] font-semibold text-fg">Administration</p>
            <p className="truncate text-[10.5px] text-fg-subtle" title={email ?? undefined}>
              {email ?? "Signed in"}
            </p>
          </div>
        </div>

        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 py-3">
          <AdminNav pathname={pathname} />
        </div>

        <div className="space-y-2 border-t border-border px-3 py-3">
          <div className="flex items-center justify-between gap-2">
            <ThemeToggle />
            <button
              type="button"
              onClick={() => void signOut()}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-1.5 py-1 text-[11.5px] text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg"
            >
              <LogOut className="size-3.5" aria-hidden="true" /> Sign out
            </button>
          </div>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-1.5 py-1 text-[11.5px] text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <ChevronLeft className="size-3.5" aria-hidden="true" /> Back to site
          </Link>
        </div>
      </aside>

      {/* Content column: the only other scroll container. */}
      <main id="admin-main" className="scroll-thin min-w-0 flex-1 overflow-y-auto">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2 lg:hidden">
          <Button variant="secondary" size="sm" onClick={() => setNavOpen(true)} aria-controls="admin-drawer">
            <Menu className="size-4" aria-hidden="true" /> Menu
          </Button>
          <span className="truncate text-[12px] text-fg-subtle">{email}</span>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </div>
        <div className="w-full px-3 py-4 sm:px-5 sm:py-5">{children}</div>
      </main>

      <Drawer open={navOpen} onClose={() => setNavOpen(false)} title="Administration" side="left">
        <div id="admin-drawer">
          <AdminNav pathname={pathname} />
          <div className="mt-6 space-y-3 border-t border-border pt-4">
            <p className="truncate text-[11px] text-fg-subtle">{email}</p>
            <Button variant="secondary" className="w-full" onClick={() => void signOut()}>
              <LogOut className="size-4" aria-hidden="true" /> Sign out
            </Button>
            <Link
              href="/"
              className="inline-flex items-center gap-1 text-[11.5px] text-fg-subtle hover:text-fg"
            >
              <ChevronLeft className="size-3.5" aria-hidden="true" /> Back to site
            </Link>
          </div>
        </div>
      </Drawer>
    </div>
  );
}

/**
 * Navigation list.
 *
 * Group headings are informational text, not controls; the links are the controls, and the
 * active one says so with `aria-current="page"` as well as colour — colour alone fails both
 * WCAG 1.4.1 and anyone reading the page with a screen reader.
 */
function AdminNav({ pathname }: { pathname: string }) {
  // Read the query string after mount rather than with `useSearchParams`: the admin is a static
  // export, and a search-param hook in a layout would force every admin route to be dynamic.
  const [editorType, setEditorType] = useState<string | null>(null);
  useEffect(() => {
    setEditorType(new URLSearchParams(window.location.search).get("type"));
  }, [pathname]);
  const override = activeNavHref(pathname, editorType);
  return (
    <nav aria-label="Admin" className="space-y-4">
      {ADMIN_NAV.map((group) => (
        <div key={group.heading}>
          <p className="mb-1 flex items-center gap-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-subtle">
            {group.heading}
          </p>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active =
                override === item.href ||
                pathname === item.href ||
                (item.href !== "/admin/" && item.href !== "/admin" && pathname.startsWith(item.href));
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group relative flex items-center gap-2.5 rounded-[var(--radius-sm)] py-1.5 pl-2 pr-2 text-[12.5px] transition-colors",
                      active
                        ? "bg-accent-soft font-medium text-accent-soft-fg"
                        : "text-fg-muted hover:bg-surface-2 hover:text-fg",
                    )}
                  >
                    {/* The rail makes the active state legible in high-contrast mode too. */}
                    <span
                      aria-hidden="true"
                      className={cn(
                        "absolute inset-y-1 left-0 w-0.5 rounded-full",
                        active ? "bg-accent" : "bg-transparent",
                      )}
                    />
                    <NavIcon
                      icon={iconForHref(item.href)}
                      className={cn(
                        "size-4 shrink-0 transition-colors",
                        active ? "text-accent-soft-fg" : "text-fg-subtle group-hover:text-fg",
                      )}
                    />
                    <span className="truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
