"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";
import { Badge, Button, Callout, Card, EmptyState, Select, Skeleton, StatTile } from "@/components/ui";
import { formatNumber } from "@/lib/utils/format";

type EventRow = { event_type: string; path: string; created_at: string };
type ClickRow = { domain: string; tld: string; provider_id: string | null; created_at: string };

const ROW_CAP = 5000;
const RANGES = [
  { value: "1", label: "Last 24 hours" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];

/**
 * Analytics.
 *
 * Everything shown is aggregated from rows that were actually written to `analytics_events`
 * and `click_events`. There is no estimation, no synthetic trend line and no third-party
 * tracker. The row cap is surfaced so a truncated window is never mistaken for a total.
 */
export default function AdminAnalyticsPage() {
  const configured = isSupabaseConfigured();
  const [days, setDays] = useState("7");
  const [events, setEvents] = useState<EventRow[]>([]);
  const [clicks, setClicks] = useState<ClickRow[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = getSupabase();
    if (!supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const since = new Date(Date.now() - Number(days) * 86_400_000).toISOString();

    const [eventsResult, clicksResult] = await Promise.all([
      supabase
        .from("analytics_events")
        .select("event_type,path,created_at", { count: "exact" })
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(ROW_CAP),
      supabase
        .from("click_events")
        .select("domain,tld,provider_id,created_at", { count: "exact" })
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(ROW_CAP),
    ]);

    if (eventsResult.error || clicksResult.error) {
      setError((eventsResult.error ?? clicksResult.error)?.message ?? "Unknown error");
      setEvents([]);
      setClicks([]);
      setLoading(false);
      return;
    }

    setEvents((eventsResult.data ?? []) as EventRow[]);
    setClicks((clicksResult.data ?? []) as ClickRow[]);
    setTruncated((eventsResult.count ?? 0) > ROW_CAP || (clicksResult.count ?? 0) > ROW_CAP);
    setLoading(false);
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  const byType = useMemo(() => {
    const map = new Map<string, number>();
    for (const event of events) map.set(event.event_type, (map.get(event.event_type) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [events]);

  const byPath = useMemo(() => {
    const map = new Map<string, number>();
    for (const event of events) map.set(event.path || "(none)", (map.get(event.path || "(none)") ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [events]);

  const byDomain = useMemo(() => {
    const map = new Map<string, number>();
    for (const click of clicks) map.set(click.domain, (map.get(click.domain) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [clicks]);

  const max = Math.max(1, ...byType.map(([, count]) => count));

  if (!configured) {
    return (
      <Callout tone="warn" title="No database connection">
        Analytics are computed from stored events. With Supabase unconfigured there is nothing to measure — and
        this page will not invent a chart.
      </Callout>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Analytics</h1>
          <p className="mt-1 text-[13px] text-fg-muted">First-party events only. Nothing is sent to third parties.</p>
        </div>
        <div className="flex items-end gap-2">
          <Select value={days} onChange={(event) => setDays(event.target.value)} aria-label="Date range" className="w-40">
            {RANGES.map((range) => (
              <option key={range.value} value={range.value}>
                {range.label}
              </option>
            ))}
          </Select>
          <Button variant="secondary" size="sm" onClick={() => void load()} loading={loading}>
            Refresh
          </Button>
        </div>
      </div>

      {error ? <Callout tone="danger" title="Could not load events">{error}</Callout> : null}

      {truncated ? (
        <Callout tone="warn" title="Window truncated">
          More than {formatNumber(ROW_CAP)} events fall inside this range, so the breakdowns cover the most recent{" "}
          {formatNumber(ROW_CAP)}. Narrow the range for exact totals.
        </Callout>
      ) : null}

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-24" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile label="Events" value={formatNumber(events.length)} hint={`${RANGES.find((range) => range.value === days)?.label.toLowerCase()}`} />
          <StatTile label="Affiliate clicks" value={formatNumber(clicks.length)} hint="Recorded redirects" tone="accent" />
          <StatTile
            label="Distinct event types"
            value={byType.length}
            hint={byType.length ? byType[0]?.[0] : "No events in range"}
          />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="text-sm font-semibold">Events by type</h2>
          {byType.length === 0 ? (
            <EmptyState className="mt-2 border-0 py-8" title="No events recorded" description="Generate names, export a list or check availability to produce events." />
          ) : (
            <ul className="mt-3 space-y-2">
              {byType.map(([type, count]) => (
                <li key={type}>
                  <div className="flex items-baseline justify-between gap-2 text-[12px]">
                    <span className="font-mono text-[11.5px] text-fg-muted">{type}</span>
                    <span className="tnum text-fg">{formatNumber(count)}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${(count / max) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="text-sm font-semibold">Top paths</h2>
          {byPath.length === 0 ? (
            <p className="mt-2 text-[12px] text-fg-subtle">No paths recorded in this range.</p>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {byPath.map(([path, count]) => (
                <li key={path} className="flex items-center justify-between gap-2 text-[12px]">
                  <code className="truncate text-[11.5px] text-fg-muted">{path}</code>
                  <span className="tnum text-fg">{formatNumber(count)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="p-4">
        <h2 className="text-sm font-semibold">Most clicked domains</h2>
        {byDomain.length === 0 ? (
          <p className="mt-2 text-[12px] text-fg-subtle">
            No affiliate clicks recorded. Clicks are only counted after the redirect target passes the allowlist check.
          </p>
        ) : (
          <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
            {byDomain.map(([domain, count]) => (
              <li key={domain} className="flex items-center justify-between gap-2 text-[12px]">
                <span className="truncate font-mono text-[11.5px] text-fg-muted">{domain}</span>
                <Badge tone="neutral">{formatNumber(count)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
