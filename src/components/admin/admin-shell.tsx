"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronLeft, LogOut, Menu, ShieldAlert } from "lucide-react";
import { useAdminSession } from "@/lib/auth/use-session";
import { ADMIN_NAV } from "@/lib/admin/resources";
import { Button, ButtonLink, Callout, Drawer, Spinner } from "@/components/ui";
import { cn } from "@/lib/utils/format";
import { ThemeToggle } from "@/components/layout/theme-toggle";

/**
 * Admin shell.
 *
 * This gate is a UX convenience. **Authorization lives in Postgres RLS** — every table the
 * admin screens touch is protected by policies that call `is_admin()`. Removing this
 * component would expose empty pages, not data.
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
    <div className="mx-auto flex w-full max-w-7xl gap-6 px-3 py-5 sm:px-4">
      <aside className="hidden w-56 shrink-0 lg:block">
        <div className="sticky top-20 space-y-5">
          <div className="flex items-center gap-2 rounded-[var(--radius)] border border-border bg-surface px-3 py-2">
            <span className="grid size-7 place-items-center rounded-[8px] bg-accent text-[11px] font-bold text-accent-fg">
              DF
            </span>
            <div className="min-w-0">
              <p className="truncate text-[12px] font-semibold text-fg">Administration</p>
              <p className="truncate text-[10px] text-fg-subtle">{email}</p>
            </div>
          </div>
          <AdminNav pathname={pathname} />
          <div className="flex items-center justify-between border-t border-border pt-3">
            <ThemeToggle />
            <button
              type="button"
              onClick={() => void signOut()}
              className="inline-flex items-center gap-1 text-[11px] text-fg-subtle hover:text-fg"
            >
              <LogOut className="size-3" /> Sign out
            </button>
          </div>
          <Link href="/" className="inline-flex items-center gap-1 text-[11px] text-fg-subtle hover:text-fg">
            <ChevronLeft className="size-3" /> Back to site
          </Link>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <div className="mb-3 flex items-center gap-2 lg:hidden">
          <Button variant="secondary" size="sm" onClick={() => setNavOpen(true)}>
            <Menu className="size-4" aria-hidden="true" /> Menu
          </Button>
          <span className="truncate text-[12px] text-fg-subtle">{email}</span>
        </div>
        {children}
      </div>

      <Drawer open={navOpen} onClose={() => setNavOpen(false)} title="Admin" side="left">
        <AdminNav pathname={pathname} />
        <div className="mt-6 space-y-3 border-t border-border pt-4">
          <ThemeToggle />
          <Button variant="secondary" className="w-full" onClick={() => void signOut()}>
            <LogOut className="size-4" /> Sign out
          </Button>
        </div>
      </Drawer>
    </div>
  );
}

function AdminNav({ pathname }: { pathname: string }) {
  return (
    <nav aria-label="Admin" className="space-y-4">
      {ADMIN_NAV.map((group) => (
        <div key={group.heading}>
          <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-subtle">
            {group.heading}
          </p>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = pathname === item.href || (item.href !== "/admin/" && pathname.startsWith(item.href));
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      "block rounded-[var(--radius-sm)] px-2 py-1.5 text-[12.5px] transition-colors",
                      active ? "bg-accent-soft font-medium text-accent-soft-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
                    )}
                  >
                    {item.label}
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
