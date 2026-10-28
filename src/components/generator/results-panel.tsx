"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Filter, ListFilter, ShieldCheck, X } from "lucide-react";
import type { Candidate, CandidateStrategy, GenerationDiagnostics } from "@/lib/brain/types";
import { Badge, Button, Callout, Drawer, EmptyState, ProgressBar, Select } from "@/components/ui";
import { ChipGroup, Field, Input } from "@/components/ui/form";
import { cn } from "@/lib/utils/format";
import {
  DEFAULT_FILTERS,
  SORT_OPTIONS,
  applyFilters,
  countActiveFilters,
  explainEmptyState,
  type AvailabilityInfo,
  type ResultFilters,
  type SortKey,
} from "@/lib/generator/filters";
import type { AvailabilityResult, AvailabilityStatus } from "@/lib/availability/types";
import type { AvailabilityMode } from "@/lib/availability/client";
import type { AvailabilityProgress } from "@/lib/availability/use-availability";
import { CandidateRow, humanStrategy } from "./candidate-row";

export type ExportScope = "visible" | "selected";

/** Rows per page. Exported so the test can prove the page boundary without guessing. */
export const PAGE_SIZE = 50;

const AVAILABILITY_STATUS_ORDER: AvailabilityStatus[] = [
  "available_verified",
  "premium_or_special_pricing",
  "registered",
  "unavailable",
  "unknown",
  "check_failed",
  "rate_limited",
  "unsupported_tld",
];

const STRATEGIES: CandidateStrategy[] = [
  "direct-combination",
  "semantic-combination",
  "phrase-template",
  "portmanteau",
  "invented",
  "pseudo-word",
  "short-abstract",
  "keyword-only",
  "exact-combination",
];

export function ResultsPanel({
  candidates,
  diagnostics,
  filters,
  onFiltersChange,
  sort,
  onSortChange,
  selected,
  onSelectionChange,
  favorites,
  onToggleFavorite,
  availability,
  domainResults,
  onCheckAvailability,
  onCheckDomains,
  checkingAvailability,
  availabilityProgress,
  availabilityMode,
  availabilityNote,
  onExport,
  onCopy,
  onRegenerate,
  busy,
}: {
  candidates: Candidate[];
  diagnostics: GenerationDiagnostics | null;
  filters: ResultFilters;
  onFiltersChange: (next: ResultFilters) => void;
  sort: SortKey;
  onSortChange: (next: SortKey) => void;
  selected: Set<string>;
  onSelectionChange: (next: Set<string>) => void;
  favorites: Set<string>;
  onToggleFavorite: (candidate: Candidate) => void;
  availability: Map<string, AvailabilityInfo>;
  domainResults: Map<string, AvailabilityResult>;
  onCheckAvailability: (scope: ExportScope) => void;
  onCheckDomains: (domains: string[]) => void;
  checkingAvailability: boolean;
  availabilityProgress: AvailabilityProgress | null;
  availabilityMode: AvailabilityMode;
  availabilityNote: string;
  onExport: (format: "txt" | "csv" | "json", scope: ExportScope) => void;
  onCopy: (scope: ExportScope) => void;
  onRegenerate: () => void;
  busy: boolean;
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const outcome = useMemo(
    () => applyFilters(candidates, filters, sort, { favorites, availability }),
    [candidates, filters, sort, favorites, availability],
  );

  const [page, setPage] = useState(0);

  const visible = outcome.visible;

  // A thousand rows is more than a phone can lay out comfortably and more than anyone reads in
  // one pass. The list is paginated rather than virtualised: the row is a link-heavy component
  // with images and tooltips, and pagination keeps select-all/export semantics obvious.
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageStart = currentPage * PAGE_SIZE;
  const pageItems = visible.slice(pageStart, pageStart + PAGE_SIZE);

  useEffect(() => {
    // Filters or a new generation change what "page 3" means; start from the top.
    setPage(0);
  }, [filters, sort, candidates]);
  const visibleSelectedCount = visible.filter((candidate) => selected.has(candidate.label)).length;
  const allVisibleSelected = visible.length > 0 && visibleSelectedCount === visible.length;
  const activeFilterCount = countActiveFilters(filters);

  const roots = useMemo(() => Array.from(new Set(candidates.map((c) => c.root))).sort(), [candidates]);
  const tlds = useMemo(
    () => Array.from(new Set(candidates.flatMap((c) => c.domains.map((d) => d.tld)))).sort(),
    [candidates],
  );

  const toggleSelect = (label: string) => {
    const next = new Set(selected);
    if (next.has(label)) next.delete(label);
    else next.add(label);
    onSelectionChange(next);
  };

  const selectAllVisible = () => {
    const next = new Set(selected);
    for (const candidate of visible) next.add(candidate.label);
    onSelectionChange(next);
  };

  const clearSelection = () => onSelectionChange(new Set());

  const filterForm = (
    <div className="space-y-4">
      <Field label="Root keyword">
        <Select
          value={filters.root}
          onChange={(event) => onFiltersChange({ ...filters, root: event.target.value })}
          aria-label="Filter by root keyword"
        >
          <option value="">All roots</option>
          {roots.map((root) => (
            <option key={root} value={root}>
              {root}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Extension">
        <Select
          value={filters.tld}
          onChange={(event) => onFiltersChange({ ...filters, tld: event.target.value })}
          aria-label="Filter by extension"
        >
          <option value="">All extensions</option>
          {tlds.map((tld) => (
            <option key={tld} value={tld}>
              .{tld}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Min length">
          <Input
            type="number"
            min={0}
            max={63}
            value={filters.minLength || ""}
            onChange={(event) => onFiltersChange({ ...filters, minLength: Number(event.target.value) || 0 })}
            aria-label="Minimum length"
          />
        </Field>
        <Field label="Max length">
          <Input
            type="number"
            min={0}
            max={63}
            value={filters.maxLength || ""}
            onChange={(event) => onFiltersChange({ ...filters, maxLength: Number(event.target.value) || 0 })}
            aria-label="Maximum length"
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Quality ≥">
          <Input
            type="number"
            min={0}
            max={100}
            value={filters.minQuality || ""}
            onChange={(event) => onFiltersChange({ ...filters, minQuality: Number(event.target.value) || 0 })}
            aria-label="Minimum quality score"
          />
        </Field>
        <Field label="Brandability ≥">
          <Input
            type="number"
            min={0}
            max={100}
            value={filters.minBrandability || ""}
            onChange={(event) =>
              onFiltersChange({ ...filters, minBrandability: Number(event.target.value) || 0 })
            }
            aria-label="Minimum brandability score"
          />
        </Field>
      </div>

      <Field label="Naming strategy">
        <ChipGroup
          label="Naming strategy"
          options={STRATEGIES.map((strategy) => ({
            value: strategy,
            label: humanStrategy(strategy),
          }))}
          selected={filters.strategies}
          onToggle={(value) =>
            onFiltersChange({
              ...filters,
              strategies: filters.strategies.includes(value)
                ? filters.strategies.filter((item) => item !== value)
                : [...filters.strategies, value],
            })
          }
        />
      </Field>

      <Field label="Availability" description="Only meaningful once a check has run.">
        <ChipGroup
          label="Availability status"
          options={[
            { value: "unchecked", label: "Not checked" },
            { value: "available_verified", label: "Available" },
            { value: "registered", label: "Registered" },
            { value: "unknown", label: "Unknown" },
            { value: "check_failed", label: "Failed" },
          ]}
          selected={filters.availability as string[]}
          onToggle={(value) =>
            onFiltersChange({
              ...filters,
              availability: filters.availability.includes(value as AvailabilityInfo["status"])
                ? filters.availability.filter((item) => item !== value)
                : [...filters.availability, value as AvailabilityInfo["status"]],
            })
          }
        />
      </Field>

      <Field label="Characters">
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-[13px] text-fg">
            <input
              type="checkbox"
              checked={filters.excludeHyphens}
              onChange={(event) => onFiltersChange({ ...filters, excludeHyphens: event.target.checked })}
              className="size-4 rounded border-border-strong accent-[var(--accent)]"
            />
            Exclude hyphens
          </label>
          <label className="flex items-center gap-2 text-[13px] text-fg">
            <input
              type="checkbox"
              checked={filters.excludeNumbers}
              onChange={(event) => onFiltersChange({ ...filters, excludeNumbers: event.target.checked })}
              className="size-4 rounded border-border-strong accent-[var(--accent)]"
            />
            Exclude numbers
          </label>
          <label className="flex items-center gap-2 text-[13px] text-fg">
            <input
              type="checkbox"
              checked={filters.favoritesOnly}
              onChange={(event) => onFiltersChange({ ...filters, favoritesOnly: event.target.checked })}
              className="size-4 rounded border-border-strong accent-[var(--accent)]"
            />
            Favourites only
          </label>
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Contains">
          <Input
            value={filters.requiredSubstring}
            onChange={(event) => onFiltersChange({ ...filters, requiredSubstring: event.target.value })}
            placeholder="e.g. ly"
            aria-label="Required substring filter"
          />
        </Field>
        <Field label="Without">
          <Input
            value={filters.excludedSubstring}
            onChange={(event) => onFiltersChange({ ...filters, excludedSubstring: event.target.value })}
            placeholder="e.g. hub"
            aria-label="Excluded substring filter"
          />
        </Field>
      </div>

      <div className="flex justify-between gap-2 border-t border-border pt-3">
        <Button variant="ghost" size="sm" onClick={() => onFiltersChange({ ...DEFAULT_FILTERS })}>
          <X className="size-3.5" aria-hidden="true" /> Clear all
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setFiltersOpen(false)}>
          Done
        </Button>
      </div>
    </div>
  );

  return (
    <section aria-label="Generated names" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-baseline gap-1.5">
          <h2 className="text-sm font-semibold text-fg">
            {visible.length.toLocaleString()}
            <span className="font-normal text-fg-muted"> of {candidates.length.toLocaleString()} names</span>
          </h2>
          {activeFilterCount > 0 ? (
            <Badge tone="accent">{activeFilterCount} filter{activeFilterCount === 1 ? "" : "s"}</Badge>
          ) : null}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <label className="sr-only" htmlFor="sort-select">
            Sort results
          </label>
          <Select
            id="sort-select"
            value={sort}
            onChange={(event) => onSortChange(event.target.value as SortKey)}
            className="h-8 w-auto min-w-[9.5rem] text-[13px]"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          <Button variant="secondary" size="sm" className="lg:hidden" onClick={() => setFiltersOpen(true)}>
            <Filter className="size-3.5" aria-hidden="true" />
            Filters
            {activeFilterCount > 0 ? (
              <span className="tnum rounded-full bg-accent px-1.5 text-[10px] text-accent-fg">
                {activeFilterCount}
              </span>
            ) : null}
          </Button>
        </div>
      </div>

      {diagnostics && diagnostics.produced < diagnostics.requested ? (
        <Callout tone="warn" title={`Produced ${diagnostics.produced} of ${diagnostics.requested} requested names`}>
          <ul className="list-disc space-y-0.5 pl-4">
            {diagnostics.reasons.length > 0 ? (
              diagnostics.reasons.map((reason) => <li key={reason}>{reason}</li>)
            ) : (
              <li>The engine could not produce more unique names for this configuration.</li>
            )}
          </ul>
        </Callout>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius)] border border-border bg-surface px-2.5 py-2">
        <label className="flex items-center gap-2 text-[12.5px] text-fg">
          <input
            type="checkbox"
            checked={allVisibleSelected}
            onChange={() => (allVisibleSelected ? clearSelection() : selectAllVisible())}
            aria-label="Select all visible names"
            className="size-4 rounded border-border-strong accent-[var(--accent)]"
          />
          {selected.size > 0 ? `${selected.size} selected` : "Select all visible"}
        </label>

        <div className="ml-auto flex flex-wrap items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => onCopy("selected")} disabled={selected.size === 0}>
            Copy selected
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onCopy("visible")} disabled={visible.length === 0}>
            Copy all
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onCheckAvailability(selected.size > 0 ? "selected" : "visible")}
            disabled={candidates.length === 0 || visible.length === 0 || availabilityMode === "none"}
            loading={checkingAvailability}
            title={
              availabilityMode === "none"
                ? "No availability provider is configured for this build."
                : availabilityNote
            }
          >
            <ShieldCheck className="size-3.5" aria-hidden="true" />
            {selected.size > 0 ? `Check ${selected.size} selected` : `Check ${visible.length} names`}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setExportOpen(true)}
            disabled={candidates.length === 0}
          >
            <Download className="size-3.5" aria-hidden="true" />
            Export
          </Button>
          {selected.size > 0 ? (
            <Button variant="ghost" size="sm" onClick={clearSelection}>
              Clear
            </Button>
          ) : null}
        </div>
      </div>

      {availabilityProgress ? (
        <div className="space-y-1 rounded-[var(--radius)] border border-border bg-surface px-3 py-2">
          <ProgressBar
            value={availabilityProgress.completed}
            max={availabilityProgress.total}
            label={`Checking ${availabilityProgress.completed} of ${availabilityProgress.total}`}
          />
          <p className="text-[11px] text-fg-subtle">
            {AVAILABILITY_STATUS_ORDER.filter((status) => (availabilityProgress.tally[status] ?? 0) > 0)
              .map((status) => `${availabilityProgress.tally[status]} ${status.replace(/_/g, " ")}`)
              .join(" · ")}
          </p>
        </div>
      ) : availabilityMode !== "none" ? (
        <p className="text-[11px] leading-relaxed text-fg-subtle">{availabilityNote}</p>
      ) : (
        <Callout tone="warn" title="Availability checking is unavailable in this build">
          No availability provider is configured, so names stay <strong>not checked</strong>. They are never
          shown as available without a real registry answer.
        </Callout>
      )}

      <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
        <aside className="hidden lg:block">
          <div className="sticky top-20 space-y-3 rounded-[var(--radius-lg)] border border-border bg-surface p-3">
            <div className="flex items-center gap-1.5 text-[13px] font-semibold text-fg">
              <ListFilter className="size-4 text-fg-subtle" aria-hidden="true" />
              Filters
            </div>
            {filterForm}
          </div>
        </aside>

        <div className="min-w-0">
          {visible.length === 0 ? (
            <EmptyState
              title={candidates.length === 0 ? "No names yet" : "No names match these filters"}
              description={
                candidates.length === 0
                  ? "Enter a root keyword and generate to see candidates with quality and brandability scores."
                  : explainEmptyState(outcome)
              }
              action={
                candidates.length === 0 ? null : (
                  <div className="flex gap-2">
                    <Button variant="secondary" size="sm" onClick={() => onFiltersChange({ ...DEFAULT_FILTERS })}>
                      Clear filters
                    </Button>
                    <Button size="sm" onClick={onRegenerate} loading={busy}>
                      Generate again
                    </Button>
                  </div>
                )
              }
            />
          ) : (
            <ul className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-surface">
              {pageItems.map((candidate, index) => (
                <CandidateRow
                  key={`${candidate.root}-${candidate.label}`}
                  candidate={candidate}
                  index={pageStart + index}
                  selected={selected.has(candidate.label)}
                  favorite={favorites.has(candidate.label)}
                  availability={availability.get(candidate.label)}
                  domainResults={domainResults}
                  onCheckDomains={onCheckDomains}
                  onToggleSelect={toggleSelect}
                  onToggleFavorite={onToggleFavorite}
                />
              ))}
            </ul>
          )}

          {visible.length > PAGE_SIZE ? (
            <nav
              aria-label="Result pages"
              className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius)] border border-border bg-surface px-2.5 py-2"
            >
              <p className="text-[11px] text-fg-subtle">
                Showing {(pageStart + 1).toLocaleString()}–{(pageStart + pageItems.length).toLocaleString()} of{" "}
                {visible.length.toLocaleString()}
              </p>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setPage((value) => Math.max(0, value - 1))}
                  disabled={currentPage === 0}
                >
                  Previous
                </Button>
                <span className="px-1 text-[11px] tabular-nums text-fg-muted">
                  {currentPage + 1} / {pageCount}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}
                  disabled={currentPage >= pageCount - 1}
                >
                  Next
                </Button>
              </div>
            </nav>
          ) : null}

          {visible.length > 0 ? (
            <p className="mt-2 text-[11px] leading-relaxed text-fg-subtle">
              Scores are documented heuristics derived from letter patterns and dictionary data — not
              appraisals, trademark clearance, or availability. A high score can still be a registered
              domain.
            </p>
          ) : null}
        </div>
      </div>

      <Drawer open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filters">
        {filterForm}
      </Drawer>

      <Drawer
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title="Export names"
        footer={
          <p className="text-[11px] text-fg-subtle">
            {selected.size > 0
              ? `${selected.size} selected name${selected.size === 1 ? "" : "s"} will be included.`
              : `All ${visible.length} visible name${visible.length === 1 ? "" : "s"} will be included.`}
          </p>
        }
      >
        <div className="space-y-2">
          {(
            [
              { format: "csv", label: "CSV", hint: "Columns for scores, TLD and availability. Formula-safe." },
              { format: "txt", label: "Plain text", hint: "One domain per line — ideal for bulk registrars." },
              { format: "json", label: "JSON", hint: "Full structured data including score metadata." },
            ] as const
          ).map((option) => (
            <div key={option.format} className="flex items-center justify-between gap-3 rounded-[var(--radius)] border border-border p-2.5">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-fg">{option.label}</p>
                <p className="text-[11px] text-fg-subtle">{option.hint}</p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    onExport(option.format, "visible");
                    setExportOpen(false);
                  }}
                >
                  Visible
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    onExport(option.format, "selected");
                    setExportOpen(false);
                  }}
                  disabled={selected.size === 0}
                >
                  Selected
                </Button>
              </div>
            </div>
          ))}
          <p className="pt-1 text-[11px] leading-relaxed text-fg-subtle">
            Availability columns say <code>unchecked</code> until a real registry lookup runs. No export
            ever implies a domain is registrable.
          </p>
        </div>
      </Drawer>

      <div className="sr-only" aria-live="polite">
        {visible.length} of {candidates.length} names shown, sorted by {SORT_OPTIONS.find((option) => option.value === sort)?.label}.
        {visibleSelectedCount > 0 ? `${visibleSelectedCount} names selected.` : ""}
      </div>
    </section>
  );
}
