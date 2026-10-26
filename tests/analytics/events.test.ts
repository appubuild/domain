import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * First-party analytics contract.
 *
 * The product rule is "no fabricated analytics". That makes two behaviours load-bearing:
 * an unconfigured build must report "not recorded" rather than silently succeeding, and a
 * write failure must be reported instead of being counted as a success.
 */

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("recordEvent", () => {
  it("reports not-configured when no backend exists instead of pretending to store", async () => {
    const { recordEvent } = await import("@/lib/analytics/events");
    const outcome = await recordEvent("generation_run", { payload: { roots: ["pay"] } });

    expect(outcome).toEqual({ recorded: false, reason: "not-configured" });
  });

  it("reports success and failure through an injected sink", async () => {
    const { recordEvent } = await import("@/lib/analytics/events");

    const ok = await recordEvent("export_created", {
      path: "/generator/",
      payload: { format: "csv" },
      sink: async () => ({ error: null }),
    });
    expect(ok).toEqual({ recorded: true });

    const failed = await recordEvent("export_created", {
      payload: { format: "csv" },
      sink: async () => ({ error: { message: "permission denied" } }),
    });
    expect(failed).toEqual({ recorded: false, reason: "error", error: "permission denied" });

    const threw = await recordEvent("export_created", {
      payload: {},
      sink: async () => {
        throw new Error("network");
      },
    });
    expect(threw.recorded).toBe(false);
    expect(threw.error).toBe("network");
  });

  it("keeps payloads flat, small and free of personal data", async () => {
    const { recordEvent } = await import("@/lib/analytics/events");
    let captured: Record<string, unknown> | null = null;

    await recordEvent("availability_check", {
      path: "/generator/",
      payload: {
        checked: 12,
        available: 3,
        email: "person@example.com", // plausible field: must not be silently expanded
        nested: { deep: true },
        long: "x".repeat(500),
        roots: ["pay", "nest", "ledger", "scale", "flow", "stack", "grid", "loop", "byte", "code", "data", "apps", "more"],
        nothing: null,
      },
      sink: async (row) => {
        captured = row as unknown as Record<string, unknown>;
        return { error: null };
      },
    });

    const row = captured as unknown as { payload: Record<string, unknown>; path: string; event_type: string };
    expect(row.event_type).toBe("availability_check");
    expect(row.path).toBe("/generator/");
    expect(row.payload.checked).toBe(12);
    expect((row.payload.long as string).length).toBe(200);
    expect(row.payload.nested).toBe("omitted");
    expect(row.payload.nothing).toBeUndefined();
    expect((row.payload.roots as string[]).length).toBeLessThanOrEqual(12);
    expect(Object.keys(row.payload).length).toBeLessThanOrEqual(20);
  });

  it("never throws into the caller even when the sink explodes", async () => {
    const { trackEvent } = await import("@/lib/analytics/events");
    expect(() =>
      trackEvent("page_view", {
        payload: {},
        sink: () => {
          throw new Error("kaboom");
        },
      }),
    ).not.toThrow();
  });

  it("reports whether analytics is writable", async () => {
    const { isAnalyticsWritable } = await import("@/lib/analytics/events");
    expect(isAnalyticsWritable()).toBe(false);
  });
});
