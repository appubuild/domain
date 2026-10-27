"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, Sparkles } from "lucide-react";
import { PRIMARY_NAV, type NavItem, type SiteBrand } from "@/lib/config/site";
import { cn } from "@/lib/utils/format";
import { Drawer } from "@/components/ui/overlay";
import { ButtonLink } from "@/components/ui/primitives";
import { ThemeToggle } from "./theme-toggle";

/**
 * Sticky site header.
 *
 * - Desktop: brand, primary nav, theme control, generator CTA.
 * - Mobile: brand, menu button, theme control. Navigation lives in an accessible drawer
 *   with focus trapping and Escape handling (see `Drawer`).
 */
export function SiteHeader({
  brand,
  items = PRIMARY_NAV,
}: {
  brand: SiteBrand;
  /**
   * Rendered navigation. Comes from `nav_items` at build time when that table has usable
   * rows, otherwise from `PRIMARY_NAV`. The default keeps this component usable in isolation
   * (and in tests) without a data source.
   */
  items?: NavItem[];
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the mobile menu when the route changes.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href.split("?")[0] ?? href);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/85 backdrop-blur-md supports-[backdrop-filter]:bg-bg/70">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-3 px-4 sm:px-6">
        <Link
          href="/"
          className="group flex shrink-0 items-center gap-2 rounded-[var(--radius)] py-1 pr-1"
          aria-label={`${brand.name} home`}
        >
          <span
            aria-hidden="true"
            className="grid size-8 place-items-center rounded-[10px] bg-accent text-[13px] font-bold tracking-tight text-accent-fg shadow-xs"
          >
            {brand.logoMark}
          </span>
          <span className="text-[15px] font-semibold tracking-tight text-fg">{brand.name}</span>
        </Link>

        <nav aria-label="Main" className="ml-2 hidden items-center gap-0.5 md:flex">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? "page" : undefined}
              className={cn(
                "rounded-[var(--radius)] px-2.5 py-1.5 text-[13.5px] font-medium transition-colors",
                isActive(item.href)
                  ? "bg-surface-2 text-fg"
                  : "text-fg-muted hover:bg-surface-2 hover:text-fg",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle className="hidden sm:inline-flex" />
          <ButtonLink
            href="/generator"
            size="sm"
            className="hidden sm:inline-flex"
            data-testid="header-cta"
          >
            <Sparkles className="size-3.5" aria-hidden="true" />
            Start generating
          </ButtonLink>
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            className="inline-flex size-9 items-center justify-center rounded-[var(--radius)] border border-border text-fg-muted hover:bg-surface-2 hover:text-fg md:hidden"
          >
            <Menu className="size-4.5" />
          </button>
        </div>
      </div>

      <Drawer open={menuOpen} onClose={() => setMenuOpen(false)} title="Menu" side="left">
        <div id="mobile-menu" className="flex h-full flex-col gap-6">
          <nav aria-label="Mobile" className="flex flex-col gap-1">
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                className={cn(
                  "rounded-[var(--radius)] px-3 py-2.5 text-sm font-medium",
                  isActive(item.href)
                    ? "bg-surface-2 text-fg"
                    : "text-fg-muted hover:bg-surface-2 hover:text-fg",
                )}
              >
                <span className="block">{item.label}</span>
                {item.description ? (
                  <span className="mt-0.5 block text-xs font-normal text-fg-subtle">
                    {item.description}
                  </span>
                ) : null}
              </Link>
            ))}
          </nav>
          <div className="mt-auto space-y-3 border-t border-border pt-4">
            <ThemeToggle />
            <ButtonLink href="/generator" size="md" className="w-full" onClick={() => setMenuOpen(false)}>
              <Sparkles className="size-4" aria-hidden="true" />
              Start generating
            </ButtonLink>
          </div>
        </div>
      </Drawer>
    </header>
  );
}
