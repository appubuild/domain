"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, History, SlidersHorizontal } from "lucide-react";
import {
  DEFAULT_CONSTRAINTS,
  generate,
  normalizeConstraints,
  normalizeKeyword,
  type Candidate,
  type GenerationDiagnostics,
  type GenerationRequest,
} from "@/lib/brain";
import {
  DEFAULT_EXTENSIONS,
  requestFromSearchParams,
  searchParamsFromRequest,
} from "@/lib/generator/url-state";
import { PREFIX_LIBRARIES, SUFFIX_LIBRARIES } from "@/lib/brain";
import {
  DEFAULT_FILTERS,
  applyFilters,
  type ResultFilters,
  type SortKey,
} from "@/lib/generator/filters";
import { domainsForCheck, summarizeByLabel, summarizeResults } from "@/lib/availability/client";
import { useAvailability } from "@/lib/availability/use-availability";
import { trackEvent } from "@/lib/analytics/events";
import { exportFilename, serializeExport, type ExportFormat } from "@/lib/export/exporters";
import {
  mergeFavorites,
  pushRecentSearch,
  readFavorites,
  readRecentSearches,
  writeFavorites,
  type FavoriteRecord,
  type RecentSearch,
} from "@/lib/storage/local";
import { Badge, Button, Callout, Drawer, useToast } from "@/components/ui";
import { cn } from "@/lib/utils/format";
import { GeneratorControls, formStateFromRequest, requestFromFormState, type GeneratorFormState } from "./generator-controls";
import { AdSlot } from "@/components/ads/ad-slot";
import { ResultsPanel, type ExportScope } from "./results-panel";
import { RootAnalysisPanel } from "./root-analysis";

/**
 * The form a first-time visitor sees.
 *
 * Every partner length is selected (2–6 letters), both .com and .io are priced, the industry is
 * left on automatic so it follows the root, and the quantity is 100 — the combination that
 * produces a full, varied list for almost any root without hiding any rule.
 */
const EMPTY_FORM: GeneratorFormState = formStateFromRequest({
  roots: [],
  industries: [],
  expandIndustries: true,
  customPartners: [],
  partnerLibraries: [...PREFIX_LIBRARIES, ...SUFFIX_LIBRARIES].map((library) => library.id),
  partnerLengths: [2, 3, 4, 5, 6],
  autoExpand: true,
  targetCount: 100,
  constraints: { ...DEFAULT_CONSTRAINTS, maxComponents: 2 },
  brandable: false,
  brandableProfiles: ["startup"],
  tlds: [...DEFAULT_EXTENSIONS],
  seed: 1,
});

export function GeneratorWorkspace() {
  const { push } = useToast();
  const [form, setForm] = useState<GeneratorFormState>(EMPTY_FORM);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [diagnostics, setDiagnostics] = useState<GenerationDiagnostics | null>(null);
  const [lastRequest, setLastRequest] = useState<GenerationRequest | null>(null);
  const [filters, setFilters] = useState<ResultFilters>({ ...DEFAULT_FILTERS });
  const [sort, setSort] = useState<SortKey>("overall");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [favoriteRecords, setFavoriteRecords] = useState<FavoriteRecord[]>([]);
  const availabilityApi = useAvailability();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentSearch[]>([]);
  // Phone layout: the configure panel is a left drawer opened by a floating button.
  const [configOpen, setConfigOpen] = useState(false);
  const initialised = useRef(false);
  const lastFilterSignature = useRef<string | null>(null);

  /**
   * Filter changes, recorded once the controls settle.
   *
   * A slider drag emits dozens of state updates; a per-keystroke event stream would be noise
   * that also costs an insert each. So the signature is compared after a short pause and only
   * the settled state is written, and only while there are results to filter.
   */
  useEffect(() => {
    if (candidates.length === 0) return;
    const signature = JSON.stringify({ filters, sort });
    if (lastFilterSignature.current === null) {
      // First settled state after a generation is the baseline, not a change.
      lastFilterSignature.current = signature;
      return;
    }
    if (lastFilterSignature.current === signature) return;
    const timer = setTimeout(() => {
      lastFilterSignature.current = signature;
      trackEvent("filter_applied", {
        payload: {
          sort,
          tld: filters.tld || "any",
          minQuality: filters.minQuality,
          minBrandability: filters.minBrandability,
          industry: filters.root || "any",
          search: filters.search ? "yes" : "no",
        },
      });
    }, 900);
    return () => clearTimeout(timer);
  }, [candidates.length, filters, sort]);

  // Restore favourites + recent searches, then honour a shared URL exactly once.
  useEffect(() => {
    if (initialised.current) return;
    initialised.current = true;

    const stored = readFavorites();
    setFavoriteRecords(stored);
    setFavorites(new Set(stored.map((record) => record.label)));
    setRecent(readRecentSearches());

    const params = new URLSearchParams(window.location.search);
    if (!params.toString()) return;
    const { request } = requestFromSearchParams(params);
    const nextForm = formStateFromRequest(request);
    setForm(nextForm);
    if (request.roots.length > 0) {
      runGeneration(request, nextForm);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const availability = useMemo(
    () => summarizeByLabel(candidates, availabilityApi.byDomain),
    [availabilityApi.byDomain, candidates],
  );

  const visibleCandidates = useMemo(
    () => applyFilters(candidates, filters, sort, { favorites, availability }).visible,
    [availability, candidates, favorites, filters, sort],
  );

  /**
   * Runs real registry lookups for the chosen scope.
   *
   * The toast reports exactly what came back — including failures — because "checking"
   * that silently reports nothing would be worse than not offering the button at all.
   */
  const handleCheckAvailability = useCallback(
    async (scope: ExportScope) => {
      const list = scope === "selected" ? candidates.filter((candidate) => selected.has(candidate.label)) : visibleCandidates;
      if (list.length === 0) {
        push({ tone: "warn", title: "Nothing to check", description: "Select some names, or adjust the filters." });
        return;
      }
      const domains = domainsForCheck(list, lastRequest?.tlds ?? []);
      if (domains.length === 0) {
        push({ tone: "warn", title: "No domains to check", description: "Refresh the results and try again." });
        return;
      }
      const run = await availabilityApi.run(domains);
      if (run.cancelled) {
        push({
          tone: "info",
          title: "Check cancelled",
          description:
            run.checked > 0 ? `${run.checked} of ${run.requested} names were checked before you cancelled.` : undefined,
        });
        return;
      }
      if (run.results.length === 0) {
        push({ tone: "warn", title: "Nothing was checked", description: "No result came back from the provider." });
        return;
      }
      const summary = summarizeResults(run.results);
      const available = summary.find((entry) => entry.status === "available_verified")?.count ?? 0;
      const failed = run.results.filter(
        (result) => result.status === "check_failed" || result.status === "rate_limited" || result.status === "unknown",
      ).length;

      push({
        tone: available > 0 ? "success" : failed > 0 ? "warn" : "info",
        title: `${run.checked} name${run.checked === 1 ? "" : "s"} checked`,
        description:
          `${summary.map((entry) => `${entry.count} ${entry.status.replace(/_/g, " ")}`).join(" · ")}.` +
          (failed > 0 ? " Failed checks are not evidence of availability." : "") +
          // The per-run cap is a protection against hammering registries, not a hidden limit: say
          // so, and say how to continue, rather than pretending the rest were checked.
          (run.skipped > 0
            ? ` ${run.skipped} more were not sent — a single run is capped at 200 domains to stay inside registry rate limits. Narrow the filters or check a selection to cover them.`
            : ""),
      });
    },
    [availabilityApi, candidates, lastRequest?.tlds, push, selected, visibleCandidates],
  );

  const handleCheckSingle = useCallback(
    (domains: string[]) => {
      void availabilityApi.run(domains);
    },
    [availabilityApi],
  );

  const runGeneration = useCallback(
    (request: GenerationRequest, formState: GeneratorFormState) => {
      setBusy(true);
      setError(null);
      try {
        // Large targets need more room than the engine's 2.5 s default. The budget is a wall-clock
        // guard, not a quantity cap: measured runs of 1000 names take ~250 ms, so this only
        // matters on slow devices — and when it does bite, the diagnostics say so.
        const result = generate(
          { ...request, budgetMs: request.targetCount >= 500 ? 8_000 : 4_000 },
          {},
        );
        setCandidates(result.candidates);
        setDiagnostics(result.diagnostics);
        setLastRequest(request);
        setSelected(new Set());

        const params = searchParamsFromRequest(request).toString();
        const href = `/generator/?${params}`;
        window.history.replaceState(null, "", href);

        const record: RecentSearch = {
          roots: request.roots,
          href,
          ranAt: new Date().toISOString(),
          count: result.candidates.length,
        };
        pushRecentSearch(record);
        setRecent(readRecentSearches());

        trackEvent("generation_run", {
          payload: {
            roots: request.roots.slice(0, 5),
            tlds: request.tlds,
            brandable: request.brandable,
            requested: result.diagnostics.requested,
            produced: result.diagnostics.produced,
            exhausted: result.diagnostics.produced < result.diagnostics.requested,
          },
        });

        if (result.candidates.length === 0) {
          push({
            tone: "warn",
            title: "No names matched",
            description: result.diagnostics.reasons[0] ?? "Relax a constraint and try again.",
          });
        } else {
          push({
            tone: "success",
            title: `${result.candidates.length} names generated`,
            description:
              result.diagnostics.produced < result.diagnostics.requested
                ? "Fewer than requested — see the note above the results."
                : `${formState.roots.length} root keyword${formState.roots.length === 1 ? "" : "s"} · ${request.tlds.length} extension${request.tlds.length === 1 ? "" : "s"}.`,
          });
        }
      } catch (generationError) {
        console.error("Generation failed", generationError);
        setError(
          generationError instanceof Error
            ? `Generation failed: ${generationError.message}`
            : "Generation failed unexpectedly. Try fewer keywords or a lower target count.",
        );
        push({ tone: "error", title: "Generation failed", description: "Nothing was saved. Please try again." });
      } finally {
        setBusy(false);
      }
    },
    [push],
  );

  const handleGenerate = useCallback(
    (reseed = false) => {
      if (form.roots.length === 0) {
        setError("Add at least one root keyword to generate names.");
        return;
      }
      if (form.tlds.length === 0) {
        setError("Select at least one extension.");
        return;
      }
      const base = requestFromFormState(form);
      const request: GenerationRequest = {
        ...base,
        constraints: normalizeConstraints(base.constraints),
        seed: reseed ? Math.floor(Math.random() * 1_000_000) + 1 : base.seed,
      };
      runGeneration(request, form);
    },
    [form, runGeneration],
  );

  const toggleFavorite = useCallback(
    (candidate: Candidate) => {
      const domain = candidate.domains[0]?.domain ?? candidate.label;
      const exists = favoriteRecords.some((record) => record.domain === domain);
      let next: FavoriteRecord[];
      if (exists) {
        next = favoriteRecords.filter((record) => record.domain !== domain);
        push({ tone: "info", title: "Removed from favourites", description: domain });
      } else {
        next = mergeFavorites(favoriteRecords, [
          {
            label: candidate.label,
            domain,
            root: candidate.root,
            addedAt: new Date().toISOString(),
            overall: candidate.overall,
          },
        ]);
        trackEvent("favorite_added", { payload: { domain, root: candidate.root } });
        push({ tone: "success", title: "Saved to favourites", description: `${domain} — stored in this browser.` });
      }
      setFavoriteRecords(next);
      setFavorites(new Set(next.map((record) => record.label)));
      const persisted = writeFavorites(next);
      if (!persisted) {
        push({
          tone: "warn",
          title: "Favourites are not persisted",
          description: "This browser is blocking local storage, so the change applies to this session only.",
        });
      }
    },
    [favoriteRecords, push],
  );

  const scopeCandidates = useCallback(
    (scope: ExportScope) => {
      if (!lastRequest) return candidates;
      const visibleSet = new Set(selected);
      if (scope === "selected") return candidates.filter((candidate) => visibleSet.has(candidate.label));
      return candidates;
    },
    [candidates, selected, lastRequest],
  );

  const handleExport = useCallback(
    (format: ExportFormat, scope: ExportScope) => {
      const list = scopeCandidates(scope);
      if (list.length === 0) {
        push({ tone: "warn", title: "Nothing to export", description: "Select some names first." });
        return;
      }
      const payload = serializeExport(
        list.map((candidate) => ({
          ...candidate,
          availability: availability.get(candidate.label)
            ? {
                status: availability.get(candidate.label)?.status ?? "unchecked",
                checkedAt: availability.get(candidate.label)?.checkedAt ?? null,
                provider: availability.get(candidate.label)?.provider ?? null,
              }
            : undefined,
        })),
        {
          format,
          includeFactors: true,
          tld: lastRequest?.tlds[0],
        },
      );

      if (!payload.content) {
        push({ tone: "error", title: "Export produced no content", description: "Nothing was downloaded." });
        return;
      }

      const blob = new Blob([payload.content], { type: payload.mimeType });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = exportFilename(format);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      trackEvent("export_created", {
        payload: { format, scope, count: list.length, availabilityIncluded: availability.size > 0 },
      });
      push({
        tone: "success",
        title: `${list.length} name${list.length === 1 ? "" : "s"} exported`,
        description: `${link.download} downloaded.`,
      });
    },
    [availability, lastRequest?.tlds, push, scopeCandidates],
  );

  const handleCopy = useCallback(
    async (scope: ExportScope) => {
      const list = scopeCandidates(scope);
      if (list.length === 0) {
        push({ tone: "warn", title: "Nothing to copy", description: "Generate or select some names first." });
        return;
      }
      const text = list.map((candidate) => candidate.domains[0]?.domain ?? candidate.label).join("\n");
      try {
        await navigator.clipboard.writeText(text);
        push({ tone: "success", title: `Copied ${list.length} name${list.length === 1 ? "" : "s"}` });
      } catch {
        push({
          tone: "error",
          title: "Clipboard unavailable",
          description: "Your browser blocked clipboard access. Use Export → Plain text instead.",
        });
      }
    },
    [push, scopeCandidates],
  );

  const activeRoots = useMemo(() => form.roots, [form.roots]);

  /** Reset used by both mount points of the panel. */
  const resetAll = useCallback(() => {
    setForm(EMPTY_FORM);
    setCandidates([]);
    setDiagnostics(null);
    setSelected(new Set());
    setError(null);
    window.history.replaceState(null, "", "/generator/");
  }, []);

  /**
   * Recent searches, one row per visible search.
   *
   * Different links can describe the same search (same root, count and rules); the newest wins so
   * the list stays a shortlist rather than a log.
   */
  const visibleRecent = useMemo(
    () =>
      recent
        .filter(
          (entry, index, all) =>
            all.findIndex((other) => other.href === entry.href) === index &&
            all.findIndex(
              (other) => other.roots.join() === entry.roots.join() && other.count === entry.count,
            ) === index,
        )
        .slice(0, 5),
    [recent],
  );

  return (
    <div className="space-y-5 pb-20 lg:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Domain generator</h1>
          <p className="mt-1 max-w-2xl text-[14px] leading-relaxed text-fg-muted">
            Build candidates from root keywords with deterministic naming rules, then rank them with
            documented quality and brandability heuristics. Nothing here claims a domain is available.
          </p>
        </div>
        <Badge tone="accent">Engine v2 · runs in your browser</Badge>
      </div>

      {/*
        Two columns from `lg` up: the configure panel on the left, the results on the right.

        The panel is the page's only sticky element. It sticks under the site header
        (`--site-header-h`) and scrolls internally if the viewport is short, so it is always
        reachable while the results column scrolls past it — and it never covers the results,
        because it occupies its own grid column rather than floating over them.

        Below `lg` there is no room for a column: the results take the full width and the same
        panel opens as a left drawer from a floating button.
      */}
      <div className="grid gap-5 lg:grid-cols-[20rem_minmax(0,1fr)] xl:grid-cols-[21rem_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <div
            className="sticky top-[var(--site-header-h)] max-h-[calc(100dvh-var(--site-header-h)-1.25rem)] overflow-y-auto scroll-thin rounded-[var(--radius-lg)] border border-border bg-surface p-3 shadow-sm"
            aria-label="Generator configuration"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
                <SlidersHorizontal className="size-3" aria-hidden="true" /> Configure
              </p>
              <span className="text-[11px] text-fg-subtle">engine v2</span>
            </div>
            <GeneratorControls
              state={form}
              onChange={setForm}
              onGenerate={() => handleGenerate(false)}
              onReset={resetAll}
              busy={busy}
              error={error}
            />
          </div>
        </aside>

        <div className="min-w-0 space-y-5">
          {diagnostics ? (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-[var(--radius)] border border-border bg-surface px-3 py-2 text-[11px] text-fg-subtle">
              <span className="tnum">
                {diagnostics.considered.toLocaleString()} valid of{" "}
                {diagnostics.spaceEstimate.toLocaleString()} possible
              </span>
              <span aria-hidden="true">·</span>
              <span className="tnum">{diagnostics.partnerWords.toLocaleString()} partner words</span>
              <span aria-hidden="true">·</span>
              <span className="tnum">
                {diagnostics.placementSplit["root-partner"]} root-first /{" "}
                {diagnostics.placementSplit["partner-root"]} partner-first
              </span>
              <span aria-hidden="true">·</span>
              <span className="tnum">{diagnostics.duplicatesRemoved.toLocaleString()} duplicates removed</span>
              <span aria-hidden="true">·</span>
              <span className="tnum">{diagnostics.elapsedMs} ms</span>
            </div>
          ) : null}

          {candidates.length === 0 && !busy ? (
            <div className="rounded-[var(--radius-lg)] border border-dashed border-border-strong bg-surface/60 p-6">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 size-5 shrink-0 text-fg-subtle" aria-hidden="true" />
                <div className="space-y-2">
                  <h2 className="text-sm font-semibold text-fg">
                    {activeRoots.length === 0 ? "Start with a root keyword" : "Ready to generate"}
                  </h2>
                  <p className="text-[13px] leading-relaxed text-fg-muted">
                    {activeRoots.length === 0
                      ? "Add a keyword such as pay, home or cloud in the panel on the left — or behind Configure on a phone. Every name will be that root plus one partner word, in whichever order reads better; the engine explains every score."
                      : `Press Generate names to build candidates for ${activeRoots.join(", ")}. Results appear here with quality and brandability breakdowns.`}
                  </p>
                  <p className="text-[11px] text-fg-subtle">
                    Availability is checked by a separate engine and is never implied by these results.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <ResultsPanel
              candidates={candidates}
              diagnostics={diagnostics}
              filters={filters}
              onFiltersChange={setFilters}
              sort={sort}
              onSortChange={setSort}
              selected={selected}
              onSelectionChange={setSelected}
              favorites={favorites}
              onToggleFavorite={toggleFavorite}
              availability={availability}
              domainResults={availabilityApi.byDomain}
              onCheckAvailability={(scope) => void handleCheckAvailability(scope)}
              onCheckDomains={handleCheckSingle}
              checkingAvailability={availabilityApi.checking}
              availabilityProgress={availabilityApi.progress}
              availabilityMode={availabilityApi.mode}
              availabilityNote={availabilityApi.note}
              onExport={handleExport}
              onCopy={handleCopy}
              onRegenerate={() => handleGenerate(true)}
              busy={busy}
            />
          )}

          {busy ? (
            <p className={cn("mt-3 text-[12px] text-fg-subtle")} role="status">
              Generating… large target counts can take a moment.
            </p>
          ) : null}

          {/* Ad placement for the generator template. Renders nothing at all unless the
              advertising flag, the global settings and an enabled slot all agree. */}
          <AdSlot template="generator" placement="sidebar" className="mt-6" />

          <div className="grid gap-3 md:grid-cols-2">
            <RootAnalysisPanel
              root={form.roots[0] ?? ""}
              selectedIndustries={form.industries}
              partnerLengths={form.partnerLengths}
            />

            {recent.length > 0 ? (
              <div className="rounded-[var(--radius)] border border-border bg-surface p-3">
                <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
                  <History className="size-3" aria-hidden="true" /> Recent searches
                </p>
                <ul className="mt-1.5 space-y-1">
                  {visibleRecent.map((entry) => (
                    <li key={entry.href}>
                      <a
                        href={entry.href}
                        className="block truncate rounded px-1 py-0.5 text-[12px] text-fg-muted hover:bg-surface-2 hover:text-fg"
                      >
                        {entry.roots.join(", ")} · {entry.count} names
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/*
        Phones get the same panel as a left drawer. The button is the only floating element on
        the page: it sits above the results, below the header and below the drawer itself, and it
        disappears the moment there is room for the column.
      */}
      <button
        type="button"
        onClick={() => setConfigOpen(true)}
        aria-expanded={configOpen}
        aria-controls="generator-config"
        className="fixed bottom-5 right-4 z-30 inline-flex items-center gap-2 rounded-full bg-accent px-4 py-3 text-[13px] font-semibold text-accent-fg shadow-lg transition-transform active:scale-[0.98] lg:hidden"
      >
        <SlidersHorizontal className="size-4" aria-hidden="true" />
        Configure
      </button>

      <Drawer
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        title="Configure generator"
        side="left"
        footer={
          <Button
            type="button"
            size="lg"
            loading={busy}
            loadingLabel="Generating…"
            className="w-full"
            onClick={() => {
              setConfigOpen(false);
              handleGenerate(false);
            }}
          >
            Generate names
          </Button>
        }
      >
        <div id="generator-config">
          <GeneratorControls
            state={form}
            onChange={setForm}
            onGenerate={() => {
              setConfigOpen(false);
              handleGenerate(false);
            }}
            onReset={resetAll}
            busy={busy}
            error={error}
            showActions={false}
            idPrefix="drawer-"
          />
        </div>
      </Drawer>
    </div>
  );
}