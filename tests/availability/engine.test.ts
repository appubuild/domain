/**
 * Availability engine tests.
 *
 * A real RDAP endpoint cannot be reached from this sandbox (egress is restricted to
 * GitHub/npm/PyPI), so the adapter is exercised with an injected `fetch` that reproduces
 * the documented HTTP behaviours. The assertions target the honest-status contract:
 * failures must never look like availability.
 */

import { describe, expect, it, vi } from "vitest";
import { AvailabilityEngine, MAX_CONCURRENCY, MemoryAvailabilityCache } from "@/lib/availability/engine";
import { createRdapProvider, buildRdapUrl, detectPremium } from "@/lib/availability/rdap";
import type { AvailabilityProvider, ProviderConfig } from "@/lib/availability/types";

const config: ProviderConfig = {
  id: "rdap-test",
  name: "Test RDAP",
  kind: "rdap",
  endpointTemplate: "https://rdap.example/domain/{domain}",
  tlds: [],
  enabled: true,
  priority: 10,
  timeoutMs: 200,
  rateLimitPerMinute: 60,
  isProduction: true,
};

function jsonResponse(status: number, body: unknown = {}, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/rdap+json", ...headers },
  });
}

function engineWith(fetchImpl: typeof fetch, extra: Partial<ConstructorParameters<typeof AvailabilityEngine>[0]> = {}) {
  return new AvailabilityEngine({
    providers: [createRdapProvider(config)],
    fetchImpl,
    ...extra,
  });
}

describe("RDAP URL construction", () => {
  it("substitutes the domain and tld placeholders", () => {
    expect(buildRdapUrl(config, "paynest.com")).toBe("https://rdap.example/domain/paynest.com");
    const withTld = { ...config, endpointTemplate: "https://rdap.verisign.com/{tld}/v1/domain/{domain}" };
    expect(buildRdapUrl(withTld, "paynest.com")).toBe("https://rdap.verisign.com/com/v1/domain/paynest.com");
  });

  it("refuses non-https or token-less endpoints", () => {
    expect(buildRdapUrl({ ...config, endpointTemplate: "http://rdap.example/{domain}" }, "a.com")).toBeNull();
    expect(buildRdapUrl({ ...config, endpointTemplate: "https://rdap.example/query" }, "a.com")).toBeNull();
    expect(buildRdapUrl({ ...config, endpointTemplate: null }, "a.com")).toBeNull();
  });
});

describe("premium detection", () => {
  it("detects reserved and premium statuses", () => {
    expect(detectPremium({ status: ["reserved"] })).toBe(true);
    expect(detectPremium({ status: ["premium-pricing"] })).toBe(true);
    expect(detectPremium({ status: ["active"], remarks: [{ description: ["Registry premium name"] }] })).toBe(true);
    expect(detectPremium({ status: ["active"] })).toBe(false);
    expect(detectPremium(null)).toBe(false);
  });
});

describe("status mapping", () => {
  it("maps 404 to available_verified with confirmation", async () => {
    const engine = engineWith(async () => jsonResponse(404, { errorCode: 404 }));
    const result = await engine.check("paynest.com");
    expect(result.status).toBe("available_verified");
    expect(result.confirmed).toBe(true);
    expect(result.httpStatus).toBe(404);
    expect(result.guidance).toMatch(/confirm with a registrar/i);
  });

  it("maps 200 to registered", async () => {
    const engine = engineWith(async () => jsonResponse(200, { ldhName: "paynest.com", status: ["active"] }));
    expect((await engine.check("paynest.com")).status).toBe("registered");
  });

  it("maps a premium record to premium_or_special_pricing", async () => {
    const engine = engineWith(async () => jsonResponse(200, { ldhName: "premium.com", status: ["reserved"] }));
    expect((await engine.check("premium.com")).status).toBe("premium_or_special_pricing");
  });

  it("maps 429 to rate_limited and keeps the retry hint", async () => {
    const engine = engineWith(async () => jsonResponse(429, {}, { "retry-after": "30" }));
    const result = await engine.check("busy.com");
    expect(result.status).toBe("rate_limited");
    expect(result.detail).toContain("30");
  });

  it("maps 5xx to check_failed, never to available", async () => {
    const engine = engineWith(async () => jsonResponse(503, {}));
    expect((await engine.check("err.com")).status).toBe("check_failed");
  });

  it("maps a network error to check_failed", async () => {
    const engine = engineWith(async () => {
      throw new TypeError("fetch failed");
    });
    const result = await engine.check("offline.com");
    expect(result.status).toBe("check_failed");
    expect(result.errorCode).toBe("network_error");
  });

  it("times out cleanly when the provider does not answer", async () => {
    const slow: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    const engine = engineWith(slow);
    const result = await engine.check("slow.com");
    expect(result.status).toBe("check_failed");
    expect(result.errorCode).toBe("timeout");
    expect(result.guidance).toMatch(/no answer/i);
  });

  it("reports unsupported_tld when no provider handles the extension", async () => {
    const restricted = createRdapProvider({ ...config, tlds: ["com"] });
    const engine = new AvailabilityEngine({
      providers: [restricted],
      fetchImpl: async () => jsonResponse(404),
    });
    const result = await engine.check("anything.zz");
    expect(result.status).toBe("unsupported_tld");
    expect(result.providerId).toBe("none");
  });

  it("treats a 404 from a non-authoritative provider as unknown", async () => {
    const provider: AvailabilityProvider = {
      id: "proxy",
      name: "Unhelpful proxy",
      kind: "edge-function",
      capabilities: () => ({ tlds: [], treatsNotFoundAsUnregistered: false, detectsPremium: false, authoritative: false }),
      supports: () => true,
      async check(domain) {
        return {
          domain,
          tld: "com",
          status: "unknown",
          providerId: "proxy",
          providerKind: "edge-function",
          checkedAt: new Date().toISOString(),
          cached: false,
          confirmed: false,
          guidance: "No answer",
        };
      },
    };
    const engine = new AvailabilityEngine({ providers: [provider] });
    expect((await engine.check("maybe.com")).status).toBe("unknown");
  });
});

describe("caching", () => {
  it("serves a second lookup from cache and marks it cached", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404));
    const cache = new MemoryAvailabilityCache();
    const engine = engineWith(fetchImpl as unknown as typeof fetch, { cache });

    const first = await engine.check("paynest.com");
    const second = await engine.check("paynest.com");

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.status).toBe(first.status);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(1);
  });

  it("bypasses the cache when forced", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404));
    const cache = new MemoryAvailabilityCache();
    const engine = engineWith(fetchImpl as unknown as typeof fetch, { cache });
    await engine.check("paynest.com");
    await engine.check("paynest.com", { force: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("re-checks once the cache entry expires", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404));
    const cache = new MemoryAvailabilityCache();
    let now = new Date("2026-01-01T00:00:00.000Z");
    const engine = engineWith(fetchImpl as unknown as typeof fetch, { cache, now: () => now, verifiedTtlMs: 1000 });

    await engine.check("paynest.com");
    now = new Date("2026-01-01T00:00:02.000Z");
    const second = await engine.check("paynest.com");

    expect(second.cached).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("batch checking", () => {
  it("de-duplicates, preserves order and reports progress", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return url.includes("taken") ? jsonResponse(200, { status: ["active"] }) : jsonResponse(404);
    });
    const engine = engineWith(fetchImpl as unknown as typeof fetch);
    const progress: number[] = [];

    const results = await engine.checkMany(
      ["a.com", "taken.com", "a.com", "b.com"],
      { concurrency: 2, onProgress: (event) => progress.push(event.completed) },
    );

    expect(results).toHaveLength(3);
    expect(results.map((result) => result.domain)).toEqual(["a.com", "taken.com", "b.com"]);
    expect(results.find((result) => result.domain === "taken.com")?.status).toBe("registered");
    expect(progress.at(-1)).toBe(3);
  });

  it("never exceeds the concurrency cap", async () => {
    let inFlight = 0;
    let peak = 0;
    const fetchImpl = async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return jsonResponse(404);
    };
    const engine = engineWith(fetchImpl as unknown as typeof fetch);
    await engine.checkMany(
      Array.from({ length: 20 }, (_, index) => `name${index}.com`),
      { concurrency: 100 },
    );
    expect(peak).toBeLessThanOrEqual(MAX_CONCURRENCY);
  });

  it("retries retryable failures and then gives up", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500));
    const engine = engineWith(fetchImpl as unknown as typeof fetch);
    const results = await engine.checkMany(["flaky.com"], { maxRetries: 2, concurrency: 1 });
    expect(results[0]?.status).toBe("check_failed");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("does not retry a rate limit", async () => {
    // Retrying into a rate limiter is what turns a pause into a ban; the status and the
    // retry-after hint are the answer, not another request.
    const fetchImpl = vi.fn(async () => jsonResponse(429, {}, { "retry-after": "30" }));
    const engine = engineWith(fetchImpl as unknown as typeof fetch);
    const results = await engine.checkMany(["slow.com"], { maxRetries: 2, concurrency: 1 });
    expect(results[0]?.status).toBe("rate_limited");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("stops when the caller aborts", async () => {
    const controller = new AbortController();
    const fetchImpl = async () => {
      controller.abort();
      return jsonResponse(404);
    };
    const engine = engineWith(fetchImpl as unknown as typeof fetch);
    const results = await engine.checkMany(["a.com", "b.com", "c.com"], {
      signal: controller.signal,
      concurrency: 1,
    });
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it("reports every failure status as indeterminate, never available", async () => {
    const statuses = [500, 503, 429];
    for (const status of statuses) {
      const engine = engineWith(async () => jsonResponse(status));
      const result = await engine.check("x.com");
      expect(result.status).not.toBe("available_verified");
      expect(["check_failed", "rate_limited"]).toContain(result.status);
      expect(result.confirmed).toBe(false);
    }
  });
});
