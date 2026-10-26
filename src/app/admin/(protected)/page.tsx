"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Activity, AlertTriangle, BookOpen, Globe2, Layers } from "lucide-react";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";
import { Badge, Callout, Card, EmptyState, Skeleton, StatTile } from "@/components/ui";
import { formatDateTime } from "@/lib/utils/format";

type Counts = {
  pages: number | null;
  posts: number | null;
  industries: number | null;
  tlds: number | null;
  checks: number | null;
};

type ActivityRow = {
  id: number;
  action: string;
  entity_type: string;
  summary: string;
  created_at: string;
};

type EventSummary = { event_type: string; events: number };

/**
 * Admin dashboard.
 *
 * Every figure on this page is a live count from the database or an aggregate of events
 * that were actually recorded. Where data does not exist yet, the tile says "no data"
 * rather than showing a zero dressed up as a trend.
 */
export default function AdminDashboardPage() {
  const configured = isSupabaseConfigured();
  const [counts, setCounts] = useState<Counts>({ pages: null, posts: null, industries: null, tlds: null, checks: null });
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    void (async () => {
      try {
        const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const [pages, posts, industries, tlds, checks, audit, analytics] = await Promise.all([
          supabase.from("pages").select("id", { count: "exact", head: true }),
          supabase.from("posts").select("id", { count: "exact", head: true }),
          supabase.from("industries").select("id", { count: "exact", head: true }),
          supabase.from("tlds").select("tld", { count: "exact", head: true }),
          supabase.from("availability_checks").select("id", { count: "exact", head: true }),
          supabase.from("audit_logs").select("id,action,entity_type,summary,created_at").order("created_at", { ascending: false }).limit(8),
          supabase.from("analytics_events").select("event_type").gte("created_at", since).limit(5000),
        ]);

        if (cancelled) return;

        const firstError = [pages, posts, industries, tlds, checks, audit, analytics].find((result) => result.error);
        if (firstError?.error) {
          setError(firstError.error.message);
          return;
        }

        setCounts({
          pages: pages.count ?? 0,
          posts: posts.count ?? 0,
          industries: industries.count ?? 0,
          tlds: tlds.count ?? 0,
          checks: checks.count ?? 0,
        });
        setActivity((audit.data ?? []) as ActivityRow[]);

        const tally = new Map<string, number>();
        for (const row of (analytics.data ?? []) as Array<{ event_type: string }>) {
          tally.set(row.event_type, (tally.get(row.event_type) ?? 0) + 1);
        }
        setEvents([...tally.entries()].map(([event_type, events]) => ({ event_type, events })).sort((a, b) => b.events - a.events));
      } catch (loadError) {
        if (!cancelled) setError((loadError as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!configured) {
    return (
      <Callout tone="warn" title="No database connection">
        Supabase is not configured, so there is nothing to report. This dashboard shows only real, measured
        data — it does not generate sample statistics.
      </Callout>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-[13px] text-fg-muted">
          Live counts from the database and events recorded in the last seven days.
        </p>
      </div>

      {error ? (
        <Callout tone="danger" title="Could not load dashboard data">
          {error}
          <p className="mt-1 text-[11px]">
            If this is a permission error, your account may not have an administrator role yet.
          </p>
        </Callout>
      ) : null}

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-24" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Pages" value={counts.pages ?? "—"} icon={<Layers className="size-4" />} hint="All statuses" />
          <StatTile label="Blog posts" value={counts.posts ?? "—"} icon={<BookOpen className="size-4" />} hint="All statuses" />
          <StatTile label="Industries" value={counts.industries ?? "—"} icon={<Globe2 className="size-4" />} hint="Dictionary entries" />
          <StatTile
            label="Availability checks"
            value={counts.checks ?? "—"}
            icon={<Activity className="size-4" />}
            hint="Recorded provider lookups"
            tone="accent"
          />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Recent activity</h2>
            <Link href="/admin/audit/" className="text-[11px] text-accent hover:underline">
              Full log
            </Link>
          </div>
          {activity.length === 0 ? (
            <p className="mt-2 text-[12px] text-fg-subtle">
              No audit entries yet. Every create, update and delete performed here is recorded.
            </p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {activity.map((row) => (
                <li key={row.id} className="flex items-start justify-between gap-2 border-b border-border pb-1.5 last:border-b-0">
                  <div className="min-w-0">
                    <p className="truncate text-[12.5px] text-fg">{row.summary || `${row.action} ${row.entity_type}`}</p>
                    <p className="text-[10.5px] text-fg-subtle">
                      {row.entity_type} · {formatDateTime(row.created_at)}
                    </p>
                  </div>
                  <Badge tone={row.action === "delete" ? "danger" : row.action === "create" ? "success" : "neutral"}>
                    {row.action}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="text-sm font-semibold">Events recorded (7 days)</h2>
          {events.length === 0 ? (
            <EmptyState
              className="mt-2 border-0 py-6"
              title="No events yet"
              description="Generated names, exports, availability checks and affiliate clicks are recorded as first-party events once the site is live."
            />
          ) : (
            <ul className="mt-2 space-y-1">
              {events.map((event) => (
                <li key={event.event_type} className="flex items-center justify-between gap-2 text-[12.5px]">
                  <span className="font-mono text-[11.5px] text-fg-muted">{event.event_type}</span>
                  <span className="tnum text-fg">{event.events.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 flex items-start gap-1.5 text-[10.5px] leading-relaxed text-fg-subtle">
            <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
            These are counts of stored events, not estimated traffic. No third-party analytics is loaded.
          </p>
        </Card>
      </div>

      <Card className="p-4">
        <h2 className="text-sm font-semibold">Quick actions</h2>
        <div className="mt-2 flex flex-wrap gap-2 text-[12px]">
          {(
            [
              ["Create a page", "/admin/pages/"],
              ["Write a post", "/admin/posts/"],
              ["Edit industries", "/admin/industries/"],
              ["Extensions", "/admin/tlds/"],
              ["Ad placements", "/admin/ad-slots/"],
              ["Settings", "/admin/settings/"],
            ] as const
          ).map(([label, href]) => (
            <Link
              key={href}
              href={href}
              className="rounded-full border border-border px-2.5 py-1 text-fg-muted hover:border-border-strong hover:text-fg"
            >
              {label}
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}
