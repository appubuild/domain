/**
 * Analytics reporting — the arithmetic, separated from the fetching.
 *
 * The dashboard used to fetch up to 5,000 raw events and aggregate them in JavaScript, which
 * meant a busy window became a sample and the page had to warn about it. Totals now come from
 * Postgres (see `0009_analytics_reporting.sql`); this module turns those small result sets into
 * a report and, just as importantly, into statements about **how much you may trust it**:
 *
 *   - days with no events are filled with an explicit zero, not omitted from the axis;
 *   - the funnel names its denominator and refuses to print a rate from a tiny sample;
 *   - every event type says what is supposed to emit it, so "zero" is distinguishable from
 *     "nobody ever wired this up".
 *
 * Nothing here estimates a missing number. `null` means "not known", and the UI prints it.
 */

import type { AppEventType } from "./events";

export type EventTypeTotal = { eventType: string; events: number };
export type DayTotal = { day: string; events: number };
export type PathTotal = { path: string; events: number };
export type RootTotal = { root: string; events: number };
export type Activity = { events: number; sessions: number; newest: string | null };

/** A window shorter than this is not a trend, and its conversion rates are noise. */
export const MIN_FUNNEL_SAMPLE = 25;

export type EventCatalogEntry = {
  label: string;
  /** Where the event is emitted from, or `null` when nothing emits it yet. */
  emitter: string | null;
  /** Required for `emitter: null` — why the event has no producer. */
  why?: string;
};

/**
 * What emits each event type.
 *
 * This exists so the dashboard can answer "is it zero because nobody did it, or because
 * nobody wired it up?" without guessing. If an event is added to `AppEventType` and not to
 * this table, the tests fail — an unclassified event is a hole in the instrumentation.
 */
export const EVENT_CATALOG: Record<AppEventType, EventCatalogEntry> = {
  page_view: { label: "Page views", emitter: "Every public page load" },
  generation_run: { label: "Generations", emitter: "Generator → Generate names" },
  filter_applied: { label: "Filter changes", emitter: "Generator → filter or sort change" },
  export_created: { label: "Exports", emitter: "Generator → copy or export a shortlist" },
  favorite_added: { label: "Favourites", emitter: "Generator → save a name" },
  availability_check: { label: "Availability checks", emitter: "Generator → Check availability" },
  availability_failure: { label: "Availability failures", emitter: "Availability adapter, on a provider error" },
  affiliate_click: {
    label: "Registrar clicks",
    emitter: null,
    why: "Clicks are stored in `click_events`, which stays the single source of truth for redirect counts.",
  },
  login: { label: "Admin sign-ins", emitter: "Admin sign-in" },
  signup: {
    label: "Sign-ups",
    emitter: null,
    why: "No public sign-up screen exists yet, so this event has no producer.",
  },
  ai_generation: { label: "AI drafts", emitter: "AI studio → generate a draft" },
};

export type CoverageEntry = {
  type: AppEventType;
  label: string;
  events: number;
  emitter: string | null;
  why?: string;
  /** `wired` = has a producer; `inactive` = wired but zero in the window; `unwired` = no producer. */
  state: "wired" | "inactive" | "unwired";
};

export function coverage(totals: EventTypeTotal[]): CoverageEntry[] {
  const counts = new Map(totals.map((row) => [row.eventType, row.events]));
  return (Object.keys(EVENT_CATALOG) as AppEventType[])
    .map((type) => {
      const entry = EVENT_CATALOG[type];
      const events = counts.get(type) ?? 0;
      const state: CoverageEntry["state"] = entry.emitter === null ? "unwired" : events > 0 ? "wired" : "inactive";
      return { type, label: entry.label, events, emitter: entry.emitter, why: entry.why, state };
    })
    .sort((left, right) => right.events - left.events || left.label.localeCompare(right.label));
}

/** UTC calendar days covered by a window of `days` ending today, oldest first. */
export function windowDays(days: number, now: Date = new Date()): string[] {
  const safeDays = Math.max(1, Math.min(Math.trunc(days) || 1, 366));
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const out: string[] = [];
  for (let offset = safeDays - 1; offset >= 0; offset -= 1) {
    out.push(new Date(end - offset * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}

/**
 * Zero-fills a daily series.
 *
 * A chart that silently drops empty days stretches one Saturday across a week. Every day in
 * the window gets a bar, and a day with no events is drawn as zero because that is what it is.
 */
export function fillDailySeries(rows: DayTotal[], days: number, now: Date = new Date()): DayTotal[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = row.day.slice(0, 10);
    counts.set(key, (counts.get(key) ?? 0) + row.events);
  }
  return windowDays(days, now).map((day) => ({ day, events: counts.get(day) ?? 0 }));
}

export type FunnelStep = {
  key: string;
  label: string;
  events: number;
  /** Share of the previous step, or `null` for the first step. */
  fromPrevious: number | null;
  /** Share of the first step, or `null` when the first step is zero. */
  fromStart: number | null;
};

export type Funnel = {
  steps: FunnelStep[];
  /** First-step volume; the denominator everything else is judged against. */
  base: number;
  /** False when `base` is below `MIN_FUNNEL_SAMPLE` — rates are then shown as `—`. */
  sufficient: boolean;
  note: string;
};

/**
 * Aggregate funnel: generation → availability check → registrar click.
 *
 * Aggregate, not per-visitor: events carry a per-tab session id but the steps are counted
 * independently, so a "rate" here describes the window, not a cohort. The note says so
 * rather than letting a reader assume funnel-tracking precision.
 */
export function buildFunnel(input: {
  generations: number;
  availabilityChecks: number;
  clicks: number;
}): Funnel {
  const steps: Array<Pick<FunnelStep, "key" | "label" | "events">> = [
    { key: "generation_run", label: "Names generated", events: input.generations },
    { key: "availability_check", label: "Availability checked", events: input.availabilityChecks },
    { key: "affiliate_click", label: "Registrar clicked", events: input.clicks },
  ];

  const base = steps[0]?.events ?? 0;
  const sufficient = base >= MIN_FUNNEL_SAMPLE;

  const withRates: FunnelStep[] = steps.map((step, index) => {
    const previous = index === 0 ? null : steps[index - 1]?.events ?? 0;
    return {
      ...step,
      fromPrevious: previous === null || previous === 0 ? null : step.events / previous,
      fromStart: base === 0 ? null : step.events / base,
    };
  });

  const note = sufficient
    ? "Aggregate counts for the window — sessions are per browser tab, not people, and the steps are not joined into per-visitor paths."
    : `Fewer than ${MIN_FUNNEL_SAMPLE} generations in this window, so conversion rates are not shown: a handful of events is not a rate.`;

  return { steps: withRates, base, sufficient, note };
}

export type AnalyticsReport = {
  days: number;
  since: string;
  totals: EventTypeTotal[];
  daily: DayTotal[];
  paths: PathTotal[];
  roots: RootTotal[];
  activity: Activity;
  /** Exact `click_events` count for the window; `null` when it could not be read. */
  clicks: number | null;
  funnel: Funnel;
  coverage: CoverageEntry[];
  /** Best single day in the window, or `null` when every day is zero. */
  peakDay: DayTotal | null;
  /** Mean events per calendar day in the window (zero days included). */
  perDay: number;
};

export function assembleReport(input: {
  days: number;
  since: string;
  totals: EventTypeTotal[];
  daily: DayTotal[];
  paths: PathTotal[];
  roots: RootTotal[];
  activity: Activity;
  clicks: number | null;
  now?: Date;
}): AnalyticsReport {
  const now = input.now ?? new Date();
  const daily = fillDailySeries(input.daily, input.days, now);
  const total = daily.reduce((sum, day) => sum + day.events, 0);
  const peak = daily.reduce<DayTotal | null>(
    (best, day) => (day.events > 0 && (!best || day.events > best.events) ? day : best),
    null,
  );

  const countOf = (type: AppEventType) =>
    input.totals.find((row) => row.eventType === type)?.events ?? 0;

  return {
    days: input.days,
    since: input.since,
    totals: input.totals,
    daily,
    paths: input.paths,
    roots: input.roots,
    activity: input.activity,
    clicks: input.clicks,
    funnel: buildFunnel({
      generations: countOf("generation_run"),
      availabilityChecks: countOf("availability_check"),
      clicks: input.clicks ?? 0,
    }),
    coverage: coverage(input.totals),
    peakDay: peak,
    perDay: daily.length === 0 ? 0 : total / daily.length,
  };
}

/** `0.184` → `"18.4%"`; `null` → `"—"`. Never renders a rate it was told not to trust. */
export function formatRate(value: number | null, sufficient = true): string {
  if (!sufficient || value === null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}
