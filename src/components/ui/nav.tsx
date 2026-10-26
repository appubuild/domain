"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils/format";

/* ------------------------------------------------------------------------------------
 * Tabs — keyboard navigable (arrow keys), announces selection.
 * ---------------------------------------------------------------------------------- */

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  className,
}: {
  tabs: Array<{ value: T; label: string; count?: number; icon?: React.ReactNode }>;
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn("scroll-thin flex gap-1 overflow-x-auto border-b border-border", className)}
      onKeyDown={(event) => {
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
        event.preventDefault();
        const index = tabs.findIndex((tab) => tab.value === value);
        const delta = event.key === "ArrowRight" ? 1 : -1;
        const next = tabs[(index + delta + tabs.length) % tabs.length];
        if (next) onChange(next.value);
      }}
    >
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            role="tab"
            type="button"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.value)}
            className={cn(
              "-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium transition-colors",
              active
                ? "border-accent text-fg"
                : "border-transparent text-fg-muted hover:border-border-strong hover:text-fg",
            )}
          >
            {tab.icon}
            {tab.label}
            {typeof tab.count === "number" ? (
              <span className="tnum rounded-full bg-surface-2 px-1.5 text-[10px] text-fg-muted">
                {tab.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------------------------
 * Pagination — real links so pages are shareable / crawlable.
 * ---------------------------------------------------------------------------------- */

export function Pagination({
  page,
  pageCount,
  hrefFor,
  className,
}: {
  page: number;
  pageCount: number;
  hrefFor: (page: number) => string;
  className?: string;
}) {
  if (pageCount <= 1) return null;
  const window = 1;
  const pages: number[] = [];
  for (let candidate = 1; candidate <= pageCount; candidate += 1) {
    if (
      candidate === 1 ||
      candidate === pageCount ||
      Math.abs(candidate - page) <= window
    ) {
      pages.push(candidate);
    }
  }

  const items: Array<number | "gap"> = [];
  pages.forEach((value, index) => {
    const previous = pages[index - 1];
    if (previous !== undefined && value - previous > 1) items.push("gap");
    items.push(value);
  });

  return (
    <nav aria-label="Pagination" className={cn("flex items-center justify-center gap-1", className)}>
      {page > 1 ? (
        <Link
          href={hrefFor(page - 1)}
          rel="prev"
          aria-label="Previous page"
          className="inline-flex h-8 items-center gap-1 rounded-[var(--radius)] border border-border px-2 text-[13px] text-fg-muted hover:bg-surface-2 hover:text-fg"
        >
          <ChevronLeft className="size-4" /> Prev
        </Link>
      ) : null}
      {items.map((item, index) =>
        item === "gap" ? (
          <span key={`gap-${index}`} className="px-1 text-fg-subtle" aria-hidden="true">
            …
          </span>
        ) : (
          <Link
            key={item}
            href={hrefFor(item)}
            aria-current={item === page ? "page" : undefined}
            className={cn(
              "tnum inline-flex h-8 min-w-8 items-center justify-center rounded-[var(--radius)] border px-2 text-[13px]",
              item === page
                ? "border-accent bg-accent-soft font-semibold text-accent-soft-fg"
                : "border-border text-fg-muted hover:bg-surface-2 hover:text-fg",
            )}
          >
            {item}
          </Link>
        ),
      )}
      {page < pageCount ? (
        <Link
          href={hrefFor(page + 1)}
          rel="next"
          aria-label="Next page"
          className="inline-flex h-8 items-center gap-1 rounded-[var(--radius)] border border-border px-2 text-[13px] text-fg-muted hover:bg-surface-2 hover:text-fg"
        >
          Next <ChevronRight className="size-4" />
        </Link>
      ) : null}
    </nav>
  );
}

/* ------------------------------------------------------------------------------------
 * Breadcrumbs — emitted as structured data by the SEO layer where relevant.
 * ---------------------------------------------------------------------------------- */

export function Breadcrumbs({
  items,
  className,
}: {
  items: Array<{ label: string; href?: string }>;
  className?: string;
}) {
  return (
    <nav aria-label="Breadcrumb" className={cn("text-xs text-fg-subtle", className)}>
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-1.5">
              {item.href && !last ? (
                <Link href={item.href} className="hover:text-fg hover:underline">
                  {item.label}
                </Link>
              ) : (
                <span aria-current={last ? "page" : undefined} className={last ? "text-fg-muted" : undefined}>
                  {item.label}
                </span>
              )}
              {!last ? (
                <span aria-hidden="true" className="text-border-strong">
                  /
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
