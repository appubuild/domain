"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, CircleHelp, Clock, MousePointerClick, RefreshCw, Users } from "lucide-react";
import { Badge, Button, Callout, Card, EmptyState, Select, Skeleton, StatTile } from "@/components/ui";
import { formatDateTime, formatNumber } from "@/lib/utils/format";
import { loadAnalyticsReport, type ReportLoad } from "@/lib/analytics/client";
import { formatRate, type AnalyticsReport, type CoverageEntry } from "@/lib/analytics/report";

/**
 * Analytics.
 *
 * Every number here was counted in Postgres (`0009_analytics_reporting.sql`) and represents
 * rows that were really written. There is no third-party tracker, no estimated traffic, no
 * synthetic trend and no "engagement score".
 *
 * Three honesty rules are visible in the UI rather than buried in code:
 *
 *   - a day with no events is drawn as a zero bar, never omitted;
 *   - conversion rates are suppressed below a minimum sample and print `—` instead;
 *   - an event type with no producer is labelled as such, so "0" is not read as "nobody is
 *     using this yet" when the truth is "nothing emits it".
 */

const RANGES = [
  { value: "1", label: "Last 24 hours" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
] as const;

const COVERAGE_TONE: Record<CoverageEntry["state"], "success" | "neutral" | "warn"> = {
  wired: "success",
  inactive: "neutral",
  unwired: "warn",
};

const COVERAGE_LABEL: Record<CoverageEntry["state"], string> = {
  wired: "counting",
  inactive: "wired · zero in range",
  unwired: "no producer",
};

export default function AdminAnalyticsPage() {
  const [days, setDays] = useState("7");
  const [load, setLoad] = useState<ReportLoad | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const result = await loadAnalyticsReport(Number(days));
    setLoad(result);
    setLoading(false);
  }, [days]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const report = load?.report ?? null;
  const maxDay = useMemo(
    () => (report ? Math.max(1, ...report.daily.map((day) => day.events)) : 1),
    [report],
  );

  if (load?.source === "not-configured") {
    return (
      <Callout tone="warn" title="No database connection">
        Analytics are counted from stored events. With Supabase unconfigured there is nothing to measure — and this
        page will not invent a chart.
      </Callout>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Analytics</h1>
          <p className="mt-1 text-[13px] text-fg-muted">
            First-party events only, aggregated in the database. Nothing is sent to third parties.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <Select value={days} onChange={(event) => setDays(event.target.value)} aria-label="Date range" className="w-40">
            {RANGES.map((range) => (
              <option key={range.value} value={range.value}>
                {range.label}
              </option>
            ))}
          </Select>
          <Button variant="secondary" size="sm" onClick={() => void refresh()} loading={loading}>
            <RefreshCw className="size-3.5" aria-hidden="true" /> Refresh
          </Button>
        </div>
      </div>

      {load?.source === "unavailable" ? (
        <Callout tone="danger" title="Could not read analytics">
          {load.error}
        </Callout>
      ) : null}

      {(load?.notes ?? []).map((note) => (
        <Callout key={note} tone="info" title="Partial report">
          {note}
        </Callout>
      ))}

      {loading && !report ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-24" />
          ))}
        </div>
      ) : null}

      {report ? <ReportBody report={report} maxDay={maxDay} /> : null}
    </div>
  );
}

function ReportBody({ report, maxDay }: { report: AnalyticsReport; maxDay: number }) {
  const isEmpty = report.activity.events === 0;

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Events"
          value={formatNumber(report.activity.events)}
          icon={<Activity className="size-3.5" aria-hidden="true" />}
          hint={`${report.days === 1 ? "last 24 hours" : `last ${report.days} days`} · database totals`}
        />
        <StatTile
          label="Sessions"
          value={formatNumber(report.activity.sessions)}
          icon={<Users className="size-3.5" aria-hidden="true" />}
          hint="distinct per-tab ids — not people"
        />
        <StatTile
          label="Registrar clicks"
          value={report.clicks === null ? "—" : formatNumber(report.clicks)}
          icon={<MousePointerClick className="size-3.5" aria-hidden="true" />}
          tone={report.clicks ? "accent" : "neutral"}
          hint={report.clicks === null ? "could not be counted" : "from click_events"}
        />
        <StatTile
          label="Newest event"
          value={report.activity.newest ? <span className="text-base">{formatDateTime(report.activity.newest)}</span> : "—"}
          icon={<Clock className="size-3.5" aria-hidden="true" />}
          hint={report.activity.newest ? `${report.perDay.toFixed(1)} events/day in range` : "nothing recorded yet"}
        />
      </div>

      {isEmpty ? (
        <EmptyState
          title="No events in this range"
          description="A page view, a generation, an availability check or an export would each create a row here. An empty window is reported as empty — it is not filled with placeholders."
        />
      ) : null}

      <Card className="p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">Events per day (UTC)</h2>
          <span className="text-[11px] text-fg-subtle">
            {report.peakDay
              ? `busiest day: ${report.peakDay.day} · ${formatNumber(report.peakDay.events)} events`
              : "no events recorded in this window"}
          </span>
        </div>

        <ul className="mt-4 flex items-end gap-[3px]" aria-hidden="true">
          {report.daily.map((day) => (
            <li key={day.day} className="group relative flex-1" title={`${day.day}: ${formatNumber(day.events)}`}>
              <div
                className={`w-full rounded-t-sm ${day.events > 0 ? "bg-accent" : "bg-surface-3"}`}
                style={{ height: `${Math.max(2, (day.events / maxDay) * 96)}px` }}
              />
            </li>
          ))}
        </ul>

        {/* The chart is decorative for screen readers; the same data is available as text. */}
        <table className="sr-only">
          <caption>Events per UTC day</caption>
          <tbody>
            {report.daily.map((day) => (
              <tr key={day.day}>
                <th scope="row">{day.day}</th>
                <td>{day.events}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="mt-2 flex items-center justify-between text-[11px] text-fg-subtle">
          <span>{report.daily[0]?.day}</span>
          <span>{report.daily[report.daily.length - 1]?.day}</span>
        </p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="text-sm font-semibold">Funnel</h2>
          <p className="mt-1 text-[11.5px] leading-relaxed text-fg-subtle">
            {report.funnel.sufficient ? report.funnel.note : <span className="text-warn">{report.funnel.note}</span>}
          </p>
          <ol className="mt-3 space-y-2.5">
            {report.funnel.steps.map((step, index) => (
              <li key={step.key}>
                <div className="flex items-baseline justify-between gap-2 text-[12px]">
                  <span className="text-fg-muted">
                    {index + 1}. {step.label}
                  </span>
                  <span className="tnum font-medium text-fg">{formatNumber(step.events)}</span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{ width: `${report.funnel.base === 0 ? 0 : (step.events / report.funnel.base) * 100}%` }}
                    />
                  </div>
                  <span className="tnum w-24 text-right text-[11px] text-fg-subtle">
                    {index === 0 ? "base" : `${formatRate(step.fromPrevious, report.funnel.sufficient)} of previous`}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </Card>

        <Card className="p-4">
          <h2 className="text-sm font-semibold">Events by type</h2>
          <ul className="mt-3 space-y-1.5">
            {report.totals.length === 0 ? (
              <li className="text-[12px] text-fg-subtle">No events in this range.</li>
            ) : (
              report.totals.map((row) => (
                <li key={row.eventType} className="flex items-center justify-between gap-2 text-[12px]">
                  <code className="truncate text-[11.5px] text-fg-muted">{row.eventType}</code>
                  <span className="tnum text-fg">{formatNumber(row.events)}</span>
                </li>
              ))
            )}
          </ul>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="text-sm font-semibold">Top paths</h2>
          {report.paths.length === 0 ? (
            <p className="mt-2 text-[12px] text-fg-subtle">No paths recorded in this range.</p>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {report.paths.map((row) => (
                <li key={row.path} className="flex items-center justify-between gap-2 text-[12px]">
                  <code className="truncate text-[11.5px] text-fg-muted">{row.path}</code>
                  <span className="tnum text-fg">{formatNumber(row.events)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="text-sm font-semibold">Keywords people generate from</h2>
          {report.roots.length === 0 ? (
            <p className="mt-2 text-[12px] text-fg-subtle">
              No generation runs in this range — or the reporting function is not applied yet.
            </p>
          ) : (
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {report.roots.map((row) => (
                <li
                  key={row.root}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[12px] text-fg-muted"
                >
                  <span className="font-medium text-fg">{row.root}</span>
                  <span className="tnum text-[11px] text-fg-subtle">{formatNumber(row.events)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="p-4">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Instrumentation</h2>
          <CircleHelp className="size-3.5 text-fg-subtle" aria-hidden="true" />
        </div>
        <p className="mt-1 text-[11.5px] leading-relaxed text-fg-subtle">
          Every event type the schema accepts, what emits it, and how many rows it produced in this window. A zero
          against “no producer” is a missing feature, not a missing user.
        </p>
        <ul className="mt-3 divide-y divide-border">
          {report.coverage.map((entry) => (
            <li key={entry.type} className="flex flex-wrap items-baseline justify-between gap-2 py-1.5 text-[12px]">
              <span className="flex min-w-0 flex-col">
                <span className="flex items-center gap-2">
                  <code className="text-[11.5px] text-fg">{entry.type}</code>
                  <Badge tone={COVERAGE_TONE[entry.state]}>{COVERAGE_LABEL[entry.state]}</Badge>
                </span>
                <span className="mt-0.5 text-[11px] leading-snug text-fg-subtle">{entry.emitter ?? entry.why}</span>
              </span>
              <span className="tnum text-fg-muted">{formatNumber(entry.events)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
