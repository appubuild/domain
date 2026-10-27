import { describe, expect, it } from "vitest";
import {
  EVENT_CATALOG,
  MIN_FUNNEL_SAMPLE,
  assembleReport,
  buildFunnel,
  coverage,
  fillDailySeries,
  formatRate,
  windowDays,
  type DayTotal,
  type EventTypeTotal,
} from "@/lib/analytics/report";
import { EVENT_TYPES } from "@/lib/analytics/events";

/**
 * Report arithmetic.
 *
 * These functions exist to stop the dashboard from overstating what it knows, so the tests
 * focus on the refusals: zero days that must appear, rates that must stay hidden under a
 * small sample, and event types that must be labelled as having no producer.
 */

const NOW = new Date("2026-10-27T12:00:00.000Z");

describe("instrumentation catalogue", () => {
  it("classifies every event type the schema accepts", () => {
    for (const type of EVENT_TYPES) {
      expect(EVENT_CATALOG[type], `no catalogue entry for ${type}`).toBeDefined();
    }
    expect(Object.keys(EVENT_CATALOG).sort()).toEqual([...EVENT_TYPES].sort());
  });

  it("gives every unproduced event a reason", () => {
    for (const [type, entry] of Object.entries(EVENT_CATALOG)) {
      if (entry.emitter === null) {
        expect(entry.why, `${type} has no emitter and no explanation`).toBeTruthy();
      } else {
        expect(entry.emitter.length).toBeGreaterThan(3);
      }
    }
  });

  it("marks unwired types distinctly from wired-but-quiet ones", () => {
    const entries = coverage([
      { eventType: "generation_run", events: 12 },
      { eventType: "page_view", events: 0 },
    ]);
    expect(entries.find((entry) => entry.type === "generation_run")?.state).toBe("wired");
    expect(entries.find((entry) => entry.type === "page_view")?.state).toBe("inactive");
    expect(entries.find((entry) => entry.type === "signup")?.state).toBe("unwired");
    expect(entries.find((entry) => entry.type === "affiliate_click")?.state).toBe("unwired");
  });
});

describe("windowDays", () => {
  it("returns one UTC day per day in the window, oldest first, ending today", () => {
    const days = windowDays(7, NOW);
    expect(days).toHaveLength(7);
    expect(days[0]).toBe("2026-10-21");
    expect(days[6]).toBe("2026-10-27");
  });

  it("clamps a nonsense window instead of returning nothing", () => {
    expect(windowDays(0, NOW)).toEqual(["2026-10-27"]);
    expect(windowDays(-3, NOW)).toHaveLength(1);
    expect(windowDays(10_000, NOW)).toHaveLength(366);
  });
});

describe("fillDailySeries", () => {
  it("adds an explicit zero for every day without events", () => {
    const rows: DayTotal[] = [
      { day: "2026-10-22", events: 4 },
      { day: "2026-10-27", events: 9 },
    ];
    const series = fillDailySeries(rows, 7, NOW);
    expect(series).toHaveLength(7);
    expect(series.find((day) => day.day === "2026-10-24")?.events).toBe(0);
    expect(series.reduce((sum, day) => sum + day.events, 0)).toBe(13);
    // A day missing from the input is a zero, not a gap in the axis.
    expect(series.every((day) => typeof day.events === "number")).toBe(true);
  });

  it("sums duplicate rows for one day rather than showing the last one", () => {
    const series = fillDailySeries(
      [
        { day: "2026-10-27", events: 2 },
        { day: "2026-10-27", events: 3 },
      ],
      1,
      NOW,
    );
    expect(series).toEqual([{ day: "2026-10-27", events: 5 }]);
  });

  it("tolerates timestamps by slicing to the date", () => {
    const series = fillDailySeries([{ day: "2026-10-27T23:59:59Z", events: 1 }], 1, NOW);
    expect(series[0]).toEqual({ day: "2026-10-27", events: 1 });
  });
});

describe("buildFunnel", () => {
  it("computes step and start rates from real counts", () => {
    const funnel = buildFunnel({ generations: 100, availabilityChecks: 40, clicks: 10 });
    expect(funnel.sufficient).toBe(true);
    expect(funnel.steps[0]?.fromPrevious).toBeNull();
    expect(funnel.steps[1]?.fromPrevious).toBeCloseTo(0.4);
    expect(funnel.steps[2]?.fromPrevious).toBeCloseTo(0.25);
    expect(funnel.steps[2]?.fromStart).toBeCloseTo(0.1);
  });

  it("refuses to describe a trend from a small sample", () => {
    const funnel = buildFunnel({ generations: MIN_FUNNEL_SAMPLE - 1, availabilityChecks: 3, clicks: 1 });
    expect(funnel.sufficient).toBe(false);
    expect(funnel.note).toContain("not shown");
  });

  it("returns null rates instead of dividing by zero", () => {
    const funnel = buildFunnel({ generations: 0, availabilityChecks: 5, clicks: 0 });
    expect(funnel.steps[0]?.fromStart).toBeNull();
    expect(funnel.steps[1]?.fromPrevious).toBeNull();
    expect(funnel.sufficient).toBe(false);
  });

  it("says the counts are aggregate, not per-visitor", () => {
    const funnel = buildFunnel({ generations: 50, availabilityChecks: 10, clicks: 2 });
    expect(funnel.note).toContain("Aggregate counts");
  });
});

describe("formatRate", () => {
  it("prints a percentage only when it is allowed to", () => {
    expect(formatRate(0.184)).toBe("18.4%");
    expect(formatRate(0.184, false)).toBe("—");
    expect(formatRate(null)).toBe("—");
    expect(formatRate(Number.NaN)).toBe("—");
  });
});

describe("assembleReport", () => {
  const totals: EventTypeTotal[] = [
    { eventType: "generation_run", events: 30 },
    { eventType: "availability_check", events: 12 },
    { eventType: "export_created", events: 3 },
  ];

  const base: Parameters<typeof assembleReport>[0] = {
    days: 7,
    since: "2026-10-20T12:00:00.000Z",
    totals,
    daily: [
      { day: "2026-10-24", events: 20 },
      { day: "2026-10-26", events: 6 },
    ],
    paths: [{ path: "/generator/", events: 40 }],
    roots: [{ root: "pay", events: 9 }],
    activity: { events: 26, sessions: 5, newest: "2026-10-27T11:00:00.000Z" },
    clicks: 4,
    now: NOW,
  };

  it("fills the series over the whole window and finds the busiest day", () => {
    const report = assembleReport({ ...base });
    expect(report.daily).toHaveLength(7);
    expect(report.peakDay).toEqual({ day: "2026-10-24", events: 20 });
    expect(report.perDay).toBeCloseTo(26 / 7);
  });

  it("passes the exact click count into the funnel", () => {
    const report = assembleReport({ ...base });
    expect(report.funnel.steps[2]?.events).toBe(4);
    expect(report.funnel.sufficient).toBe(true);
  });

  it("keeps an unreadable click count as null and still reports the rest", () => {
    const report = assembleReport({ ...base, clicks: null });
    expect(report.clicks).toBeNull();
    // The funnel must not silently treat an unknown as zero clicks… it shows 0 for the step,
    // and the UI prints the click tile as "—". Both facts stay visible.
    expect(report.funnel.steps[2]?.events).toBe(0);
    expect(report.totals).toHaveLength(3);
  });

  it("reports an empty window as empty rather than a flat fake trend", () => {
    const report = assembleReport({
      ...base,
      totals: [],
      daily: [],
      paths: [],
      roots: [],
      activity: { events: 0, sessions: 0, newest: null },
      clicks: 0,
    });
    expect(report.peakDay).toBeNull();
    expect(report.daily.every((day) => day.events === 0)).toBe(true);
    expect(report.funnel.sufficient).toBe(false);
    expect(report.coverage.every((entry) => entry.events === 0)).toBe(true);
  });
});
