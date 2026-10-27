import Link from "next/link";
import { FOOTER_NAV, type SiteBrand } from "@/lib/config/site";

type FooterColumn = { heading: string; items: Array<{ label: string; href: string }> };

export function SiteFooter({
  brand,
  columns = FOOTER_NAV,
}: {
  brand: SiteBrand;
  /** Rendered link columns — from `nav_menus`/`nav_items` at build time when available. */
  columns?: FooterColumn[];
}) {
  const year = new Date().getFullYear();
  return (
    <footer className="mt-16 border-t border-border bg-surface">
      <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-[1.4fr_repeat(4,1fr)]">
          <div className="max-w-xs space-y-3">
            <Link href="/" className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="grid size-7 place-items-center rounded-[9px] bg-accent text-[12px] font-bold text-accent-fg"
              >
                {brand.logoMark}
              </span>
              <span className="text-sm font-semibold text-fg">{brand.name}</span>
            </Link>
            <p className="text-[13px] leading-relaxed text-fg-muted">{brand.description}</p>
          </div>

          {columns.map((column) => (
            <nav key={column.heading} aria-label={column.heading} className="space-y-2">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-subtle">
                {column.heading}
              </h2>
              <ul className="space-y-1.5">
                {column.items.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="text-[13px] text-fg-muted transition-colors hover:text-fg"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-9 flex flex-col gap-3 border-t border-border pt-6 text-xs text-fg-subtle sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {year} {brand.name}. Naming scores are heuristics, not appraisals. Availability can
            change at any moment and is never a guarantee of registration.
          </p>
          <p className="shrink-0">
            Some registrar links may be affiliate links.{" "}
            <Link href="/affiliate-disclosure" className="underline hover:text-fg">
              Disclosure
            </Link>
          </p>
        </div>
      </div>
    </footer>
  );
}
