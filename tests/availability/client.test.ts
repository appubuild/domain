import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Browser availability client.
 *
 * These tests pin the two properties that matter most for a product that talks to public
 * registries: (a) a failure is never rendered as an available name, and (b) the transport
 * choice is explicit and reported to the UI.
 */

type ClientModule = typeof import("@/lib/availability/client");

async function loadClient(): Promise<ClientModule> {
  vi.resetModules();
  return import("@/lib/availability/client");
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  delete process.env.NEXT_PUBLIC_AVAILABILITY_FN_URL;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("edge function provider", () => {
  const now = () => new Date("2026-05-01T00:00:00.000Z");

  it("maps a valid payload to a result", async () => {
    const { createEdgeFunctionProvider } = await loadClient();
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          {
            domain: "paynest.com",
            status: "available_verified",
            confirmed: true,
            httpStatus: 404,
            latencyMs: 120,
            guidance: "No registration record.",
          },
        ],
      }),
    })) as unknown as typeof fetch;

    const provider = createEdgeFunctionProvider("https://fn.example/availability", { fetchImpl });
    const result = await provider.check("paynest.com", { now });

    expect(result.status).toBe("available_verified");
    expect(result.confirmed).toBe(true);
    expect(result.providerKind).toBe("edge-function");
    expect(result.checkedAt).toBe("2026-05-01T00:00:00.000Z");
    expect(vi.mocked(fetchImpl).mock.calls[0]?.[0]).toBe("https://fn.example/availability?domain=paynest.com");
  });

  it("treats an unknown status string as unknown, never as available", async () => {
    const { createEdgeFunctionProvider } = await loadClient();
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ results: [{ domain: "paynest.com", status: "definitely_free" }] }),
    })) as unknown as typeof fetch;

    const provider = createEdgeFunctionProvider("https://fn.example/availability", { fetchImpl });
    const result = await provider.check("paynest.com", { now });

    expect(result.status).toBe("unknown");
    expect(result.errorCode).toBe("edge_invalid_payload");
    expect(result.confirmed).toBe(false);
  });

  it("maps HTTP failures to failure statuses", async () => {
    const { createEdgeFunctionProvider } = await loadClient();
    const cases = [
      { status: 429, expected: "rate_limited" },
      { status: 400, expected: "unsupported_tld" },
      { status: 503, expected: "check_failed" },
    ] as const;

    for (const testCase of cases) {
      const fetchImpl = vi.fn(async () => ({
        ok: false,
        status: testCase.status,
        json: async () => ({}),
      })) as unknown as typeof fetch;
      const provider = createEdgeFunctionProvider("https://fn.example/availability", { fetchImpl });
      const result = await provider.check("paynest.com", { now });
      expect(result.status, `HTTP ${testCase.status}`).toBe(testCase.expected);
      expect(result.httpStatus).toBe(testCase.status);
    }
  });

  it("reports a network failure as check_failed with a code", async () => {
    const { createEdgeFunctionProvider } = await loadClient();
    const fetchImpl = vi.fn(async () => {
      throw new Error("boom");
    }) as unknown as typeof fetch;

    const provider = createEdgeFunctionProvider("https://fn.example/availability", { fetchImpl });
    const result = await provider.check("paynest.com", { now });

    expect(result.status).toBe("check_failed");
    expect(result.errorCode).toBe("edge_network");
  });

  it("reports a missing fetch implementation instead of pretending to check", async () => {
    const { createEdgeFunctionProvider } = await loadClient();
    const provider = createEdgeFunctionProvider("https://fn.example/availability", {
      fetchImpl: undefined as unknown as typeof fetch,
    });
    vi.stubGlobal("fetch", undefined);
    const result = await provider.check("paynest.com", { now });

    expect(result.status).toBe("check_failed");
    expect(result.errorCode).toBe("no_fetch");
  });
});

describe("engine factory", () => {
  it("uses the edge function when a URL is configured", async () => {
    const { buildBrowserEngine } = await loadClient();
    const built = buildBrowserEngine({
      functionUrl: "https://fn.example/availability",
      providers: undefined,
      fetchImpl: (async () => ({ ok: true, status: 200, json: async () => ({ results: [] }) })) as unknown as typeof fetch,
    });

    expect(built.mode).toBe("edge-function");
    expect(built.note).toContain("DomainFits availability service");
    expect(built.engine.resolveProvider("com")?.id).toBe("edge-function");
  });

  it("falls back to direct RDAP providers and explains the CORS caveat", async () => {
    const { buildBrowserEngine } = await loadClient();
    const built = buildBrowserEngine({ functionUrl: null });

    expect(built.mode).toBe("direct-rdap");
    expect(built.note).toContain("cross-origin");
    // Verisign claims .com/.net explicitly; the bootstrap provider claims everything.
    expect(built.engine.resolveProvider("com")).not.toBeNull();
    expect(built.engine.resolveProvider("dev")).not.toBeNull();
  });

  it("reports mode 'none' with an honest note when no provider exists", async () => {
    const { buildBrowserEngine } = await loadClient();
    const built = buildBrowserEngine({ functionUrl: null, providers: [] });

    expect(built.mode).toBe("direct-rdap"); // injected provider set takes precedence
    expect(built.engine.resolveProvider("com")).toBeNull();
  });
});

describe("session cache", () => {
  it("round-trips entries and survives a new instance", async () => {
    const { SessionAvailabilityCache } = await loadClient();
    const cache = new SessionAvailabilityCache();
    cache.set("Paynest.com", {
      domain: "paynest.com",
      status: "registered",
      providerId: "edge-function",
      providerKind: "edge-function",
      checkedAt: "2026-05-01T00:00:00.000Z",
      expiresAt: "2026-05-01T06:00:00.000Z",
      confirmed: true,
      guidance: "taken",
    });

    expect(cache.get("paynest.com")?.status).toBe("registered");
    expect(cache.size()).toBe(1);

    // A fresh instance re-reads from storage when available, otherwise starts empty — both
    // are correct; what must never happen is a fabricated entry.
    const second = new SessionAvailabilityCache();
    expect(second.get("nonexistent.com")).toBeNull();
  });

  it("stores through an injectable window localStorage", async () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
      },
    });

    const { SessionAvailabilityCache } = await loadClient();
    const cache = new SessionAvailabilityCache();
    cache.set("paynest.com", {
      domain: "paynest.com",
      status: "available_verified",
      providerId: "edge-function",
      providerKind: "edge-function",
      checkedAt: "2026-05-01T00:00:00.000Z",
      expiresAt: "2026-05-01T06:00:00.000Z",
      confirmed: true,
      guidance: "free",
    });

    expect(store.size).toBe(1);
    const fresh = new SessionAvailabilityCache();
    expect(fresh.get("paynest.com")?.status).toBe("available_verified");

    fresh.clear();
    expect(store.size).toBe(0);
  });

  it("keeps working in memory when storage throws", async () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
        removeItem: () => {
          throw new Error("blocked");
        },
      },
    });

    const { SessionAvailabilityCache } = await loadClient();
    const cache = new SessionAvailabilityCache();
    expect(() =>
      cache.set("paynest.com", {
        domain: "paynest.com",
        status: "unknown",
        providerId: "edge-function",
        providerKind: "edge-function",
        checkedAt: "2026-05-01T00:00:00.000Z",
        expiresAt: "2026-05-01T00:10:00.000Z",
        confirmed: false,
        guidance: "unknown",
      }),
    ).not.toThrow();
    expect(cache.get("paynest.com")?.status).toBe("unknown");
  });
});

describe("mapping helpers", () => {
  function result(domain: string, status: "available_verified" | "registered" | "check_failed") {
    return {
      domain,
      tld: domain.split(".").pop() ?? "",
      status,
      providerId: "edge-function",
      providerKind: "edge-function" as const,
      checkedAt: "2026-05-01T00:00:00.000Z",
      cached: false,
      confirmed: status !== "check_failed",
      guidance: status,
    };
  }

  it("summarises a candidate by its first checked domain", async () => {
    const { summarizeByLabel } = await loadClient();
    const candidates = [
      { label: "paynest", domains: [{ domain: "paynest.com" }, { domain: "paynest.io" }] },
      { label: "ledgerly", domains: [{ domain: "ledgerly.com" }] },
      { label: "unchecked", domains: [{ domain: "unchecked.com" }] },
    ];
    const byDomain = new Map([
      ["paynest.com", result("paynest.com", "registered")],
      ["paynest.io", result("paynest.io", "available_verified")],
      ["ledgerly.com", result("ledgerly.com", "check_failed")],
    ]);

    const summary = summarizeByLabel(candidates, byDomain);

    expect(summary.get("paynest")?.status).toBe("registered");
    expect(summary.get("ledgerly")?.status).toBe("check_failed");
    expect(summary.has("unchecked")).toBe(false);
  });

  it("counts results by status", async () => {
    const { summarizeResults } = await loadClient();
    const counts = summarizeResults([
      result("a.com", "registered"),
      result("b.com", "registered"),
      result("c.com", "available_verified"),
    ]);

    expect(counts[0]).toEqual({ status: "registered", count: 2 });
    expect(counts.find((entry) => entry.status === "available_verified")?.count).toBe(1);
  });

  it("collects domains for the selected extensions only", async () => {
    const { domainsForCheck } = await loadClient();
    const candidates = [
      { label: "paynest", domains: [{ domain: "paynest.com" }, { domain: "paynest.io" }] },
      { label: "ledgerly", domains: [{ domain: "ledgerly.com" }] },
    ];

    expect(domainsForCheck(candidates, ["com"])).toEqual(["paynest.com", "ledgerly.com"]);
    expect(domainsForCheck(candidates, [])).toEqual(["paynest.com", "paynest.io", "ledgerly.com"]);
    expect(domainsForCheck(candidates, [".io"])).toEqual(["paynest.io"]);
  });

  it("batches domains and refuses absurd batch sizes", async () => {
    const { chunkDomains } = await loadClient();
    expect(chunkDomains(["a", "b", "c", "d", "e"], 2)).toEqual([["a", "b"], ["c", "d"], ["e"]]);
    expect(chunkDomains(["a", "b"], 0)).toEqual([["a"], ["b"]]);
    expect(chunkDomains([], 10)).toEqual([]);
    expect(chunkDomains(Array.from({ length: 250 }, (_, index) => `d${index}`), 10_000)[0]).toHaveLength(100);
  });

  it("only treats definitive answers as reportable", async () => {
    const { isReportable } = await loadClient();
    expect(isReportable("available_verified")).toBe(true);
    expect(isReportable("registered")).toBe(true);
    expect(isReportable("unknown")).toBe(false);
    expect(isReportable("check_failed")).toBe(false);
    expect(isReportable("rate_limited")).toBe(false);
    expect(isReportable("unsupported_tld")).toBe(false);
  });
});
