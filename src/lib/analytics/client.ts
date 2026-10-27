"use client";

/**
 * Analytics report loader.
 *
 * Totals are computed in Postgres (`0009_analytics_reporting.sql`), so the browser receives a
 * few dozen rows instead of thousands of raw events. Three outcomes are distinguished, because
 * collapsing them would produce a dashboard that lies:
 *
 *   - `not-configured` — no Supabase in this build; there is nothing to measure;
 *   - `unavailable`    — the query failed (no admin session, missing migration, network);
 *   - `supabase`       — these numbers were really read.
 *
 * A missing reporting function is reported as `unavailable` with the RPC named, rather than
 * being papered over with a client-side fallback that would silently be a sample.
 */

import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";
import {
  assembleReport,
  type Activity,
  type AnalyticsReport,
  type DayTotal,
  type EventTypeTotal,
  type PathTotal,
  type RootTotal,
} from "./report";

export type ReportSource = "supabase" | "not-configured" | "unavailable";

export type ReportLoad = {
  report: AnalyticsReport | null;
  source: ReportSource;
  error: string | null;
  /** Non-fatal caveats (e.g. keyword totals unavailable on an older database). */
  notes: string[];
};

export const RANGE_DAYS = [1, 7, 30, 90] as const;

function isoSince(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export async function loadAnalyticsReport(days: number): Promise<ReportLoad> {
  if (!isSupabaseConfigured()) {
    return {
      report: null,
      source: "not-configured",
      error: null,
      notes: ["Supabase is not configured in this build, so no events can exist."],
    };
  }

  const supabase = getSupabase();
  if (!supabase) {
    return { report: null, source: "not-configured", error: null, notes: [] };
  }

  const since = isoSince(days);
  const sinceDate = since.slice(0, 10);
  const notes: string[] = [];

  const [totals, daily, activity, paths, roots, clicks] = await Promise.all([
    supabase.rpc("analytics_event_totals", { p_since: since }),
    supabase.rpc("analytics_daily_totals", { p_since: sinceDate }),
    supabase.rpc("analytics_activity", { p_since: since }),
    supabase.rpc("analytics_path_totals", { p_since: since, p_limit: 10 }),
    supabase.rpc("analytics_root_totals", { p_since: since, p_limit: 10 }),
    supabase.from("click_events").select("id", { count: "exact", head: true }).gte("created_at", since),
  ]);

  const fatal = totals.error ?? daily.error ?? activity.error;
  if (fatal) {
    const missingFunction = /could not find the function|does not exist|schema cache/i.test(fatal.message);
    return {
      report: null,
      source: "unavailable",
      error: missingFunction
        ? `The reporting functions are missing from the database — apply supabase/migrations/0009_analytics_reporting.sql and reload. (${fatal.message})`
        : `Could not read analytics: ${fatal.message}`,
      notes: [],
    };
  }

  if (paths.error) notes.push(`Top paths unavailable: ${paths.error.message}`);
  if (roots.error) {
    notes.push(
      /could not find the function|does not exist|schema cache/i.test(roots.error.message)
        ? "Keyword totals need migration 0009; the rest of the report is unaffected."
        : `Keyword totals unavailable: ${roots.error.message}`,
    );
  }

  const activityRow = (activity.data ?? [])[0] as
    | { events: number | string; sessions: number | string; newest: string | null }
    | undefined;

  const report = assembleReport({
    days,
    since,
    totals: ((totals.data ?? []) as Array<{ event_type: string; events: number | string }>).map(
      (row): EventTypeTotal => ({ eventType: row.event_type, events: Number(row.events) }),
    ),
    daily: ((daily.data ?? []) as Array<{ day: string; events: number | string }>).map(
      (row): DayTotal => ({ day: String(row.day).slice(0, 10), events: Number(row.events) }),
    ),
    paths: ((paths.data ?? []) as Array<{ path: string; events: number | string }>).map(
      (row): PathTotal => ({ path: row.path, events: Number(row.events) }),
    ),
    roots: ((roots.data ?? []) as Array<{ root: string; events: number | string }>).map(
      (row): RootTotal => ({ root: row.root, events: Number(row.events) }),
    ),
    activity: {
      events: Number(activityRow?.events ?? 0),
      sessions: Number(activityRow?.sessions ?? 0),
      newest: activityRow?.newest ?? null,
    } satisfies Activity,
    // A count that could not be read is `null`, not zero: "nobody clicked" and "we could not
    // count clicks" are different facts and the UI says which one it is.
    clicks: clicks.error ? null : typeof clicks.count === "number" ? clicks.count : null,
  });

  if (clicks.error) notes.push(`Registrar click count unavailable: ${clicks.error.message}`);

  return { report, source: "supabase", error: null, notes };
}
