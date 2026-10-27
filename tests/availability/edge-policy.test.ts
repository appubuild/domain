/**
 * The rules that make a *public* availability endpoint safe to leave open.
 *
 * These are tested here rather than in the function file because the function is Deno-only
 * and is exercised end-to-end by `npm run smoke -- <url> --check-functions`. What is worth
 * locking down in the ordinary suite is the policy: what gets cached, who may call it, and
 * how fast. Each of these has a failure mode that is invisible in the happy path.
 */

/// <reference path="../../supabase/functions/_shared/deno-stub.d.ts" />

import { describe, expect, it } from "vitest";

import {
  CACHEABLE,
  DEFAULT_RATE_LIMIT,
  DEFINITIVE,
  MAX_NAMES_PER_REQUEST,
  RATE_WINDOW_MS,
  VERIFIED_TTL_SECONDS,
  INCONCLUSIVE_TTL_SECONDS,
  cacheTtlSeconds,
  clientKeyFrom,
  corsOriginFor,
  handleRequest,
  isWildcard,
  originMatches,
  parseAllowedOrigins,
  parseDomainList,
  parseRateLimit,
  takeRateToken,
  type RateWindow,
} from "../../supabase/functions/availability/index";

describe("cache policy", () => {
  it("stores a definitive answer for six hours and an inconclusive one for ten minutes", () => {
    expect(cacheTtlSeconds("available_verified")).toBe(VERIFIED_TTL_SECONDS);
    expect(cacheTtlSeconds("registered")).toBe(VERIFIED_TTL_SECONDS);
    expect(cacheTtlSeconds("premium_or_special_pricing")).toBe(VERIFIED_TTL_SECONDS);
    expect(cacheTtlSeconds("unknown")).toBe(INCONCLUSIVE_TTL_SECONDS);
    expect(cacheTtlSeconds("unsupported_tld")).toBe(INCONCLUSIVE_TTL_SECONDS);
  });

  it("refuses to cache a transient failure", () => {
    // The whole point: one timeout must not become ten minutes of reported downtime.
    expect(cacheTtlSeconds("check_failed")).toBeNull();
    expect(cacheTtlSeconds("rate_limited")).toBeNull();
    expect(CACHEABLE.has("check_failed")).toBe(false);
    expect(CACHEABLE.has("rate_limited")).toBe(false);
  });

  it("never treats an inconclusive status as definitive", () => {
    for (const status of ["unknown", "unsupported_tld", "check_failed", "rate_limited"] as const) {
      expect(DEFINITIVE.has(status)).toBe(false);
    }
    expect(DEFINITIVE.has("available_verified")).toBe(true);
    expect(VERIFIED_TTL_SECONDS).toBeGreaterThan(INCONCLUSIVE_TTL_SECONDS);
  });
});

describe("CORS policy", () => {
  it("defaults to any origin when nothing is configured", () => {
    expect(parseAllowedOrigins(undefined)).toEqual(["*"]);
    expect(parseAllowedOrigins("")).toEqual(["*"]);
    expect(isWildcard(parseAllowedOrigins(null))).toBe(true);
  });

  it("parses a comma-separated allowlist and tolerates whitespace and trailing slashes", () => {
    const list = parseAllowedOrigins("https://domainfits.vercel.app/, https://example.com ,, ");
    expect(list).toEqual(["https://domainfits.vercel.app", "https://example.com"]);
    expect(isWildcard(list)).toBe(false);
  });

  it("reflects only an allowed origin", () => {
    const list = parseAllowedOrigins("https://domainfits.vercel.app,https://staging.example.com");
    expect(corsOriginFor("https://domainfits.vercel.app", list)).toBe("https://domainfits.vercel.app");
    expect(corsOriginFor("https://staging.example.com", list)).toBe("https://staging.example.com");
    // A third-party page gets a header that does not match its own origin, so the browser
    // drops the response even though the (public) body was served.
    expect(corsOriginFor("https://evil.example", list)).toBe("https://domainfits.vercel.app");
    expect(corsOriginFor(null, list)).toBe("https://domainfits.vercel.app");
  });

  it("supports a single `*` for per-branch preview aliases without opening the whole domain", () => {
    const list = parseAllowedOrigins("https://domainfits.vercel.app,https://domainfits-*.vercel.app");
    expect(originMatches("https://domainfits-*.vercel.app", "https://domainfits-git-arena-b181432b-x.vercel.app")).toBe(true);
    expect(originMatches("https://domainfits-*.vercel.app", "https://someone-else.vercel.app")).toBe(false);
    expect(corsOriginFor("https://domainfits-git-arena-abc.vercel.app", list)).toBe(
      "https://domainfits-git-arena-abc.vercel.app",
    );
    // A `*` can never be used to jump hosts: the pattern is anchored and `*` excludes "/".
    expect(originMatches("https://domainfits-*.vercel.app", "https://domainfits-evil.example/vercel.app")).toBe(false);
    expect(originMatches("https://*.example.com", "https://a.b.example.com")).toBe(true);
  });

  it("never echoes a pattern that a browser could not match", () => {
    const list = parseAllowedOrigins("https://domainfits-*.vercel.app");
    expect(corsOriginFor("https://evil.example", list)).toBe("null");
    expect(corsOriginFor(null, list)).toBe("null");
  });

  it("sends `*` when the allowlist is wildcard, regardless of the caller", () => {
    expect(corsOriginFor("https://anything.example", ["*"])).toBe("*");
    expect(corsOriginFor(null, ["*"])).toBe("*");
  });
});

describe("rate limit policy", () => {
  it("allows the configured number of lookups per window, then asks the caller to wait", () => {
    const windows = new Map<string, RateWindow>();
    const start = 1_700_000_000_000;
    for (let i = 0; i < 3; i += 1) {
      expect(takeRateToken(windows, "1.2.3.4", 3, start).limited).toBe(false);
    }
    const blocked = takeRateToken(windows, "1.2.3.4", 3, start);
    expect(blocked.limited).toBe(true);
    if (blocked.limited) expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("counts callers separately and forgets them once the window has passed", () => {
    const windows = new Map<string, RateWindow>();
    const start = 1_700_000_000_000;
    for (let i = 0; i < 3; i += 1) takeRateToken(windows, "1.1.1.1", 3, start);

    expect(takeRateToken(windows, "2.2.2.2", 3, start).limited).toBe(false);
    // A fresh window: the earlier burst no longer counts against the same caller.
    expect(takeRateToken(windows, "1.1.1.1", 3, start + RATE_WINDOW_MS + 1).limited).toBe(false);
  });

  it("sweeps expired windows instead of growing without bound", () => {
    const windows = new Map<string, RateWindow>();
    const start = 1_700_000_000_000;
    for (let i = 0; i < 5_100; i += 1) takeRateToken(windows, `10.0.${Math.floor(i / 256)}.${i % 256}`, 1, start);
    takeRateToken(windows, "new", 1, start + RATE_WINDOW_MS + 1);
    expect(windows.size).toBeLessThan(5_100);
  });

  it("falls back to a real limit when the configured value is garbage", () => {
    expect(parseRateLimit(undefined)).toBe(DEFAULT_RATE_LIMIT);
    expect(parseRateLimit("abc")).toBe(DEFAULT_RATE_LIMIT);
    expect(parseRateLimit("0")).toBe(DEFAULT_RATE_LIMIT);
    expect(parseRateLimit("-5")).toBe(DEFAULT_RATE_LIMIT);
    expect(parseRateLimit("12")).toBe(12);
  });

  it("identifies the caller from the proxy headers, first hop first", () => {
    const headers = (values: Record<string, string>) => ({ get: (name: string) => values[name] ?? null });
    expect(clientKeyFrom(headers({ "x-forwarded-for": "203.0.113.9, 70.41.3.18" }))).toBe("203.0.113.9");
    expect(clientKeyFrom(headers({ "cf-connecting-ip": "203.0.113.10" }))).toBe("203.0.113.10");
    expect(clientKeyFrom(headers({ "x-real-ip": "203.0.113.11" }))).toBe("203.0.113.11");
    expect(clientKeyFrom(headers({}))).toBe("unknown");
  });
});

describe("request parsing", () => {
  it("caps a batch at ten names", () => {
    const many = Array.from({ length: 25 }, (_, index) => `name${index}.com`).join(",");
    expect(parseDomainList(many)).toHaveLength(MAX_NAMES_PER_REQUEST);
  });

  it("collapses duplicates so one name costs one registry query", () => {
    expect(parseDomainList("Pixel.com,pixel.com,PIXEL.COM")).toEqual(["pixel.com"]);
  });

  it("drops blanks and returns an empty list for a missing parameter", () => {
    expect(parseDomainList("")).toEqual([]);
    expect(parseDomainList(null)).toEqual([]);
    expect(parseDomainList(" , ,")).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* The handler itself                                                         */
/* -------------------------------------------------------------------------- */

const ip = (suffix: string) => `${suffix}.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;

function get(query: string, init: { ip: string; origin?: string; method?: string }): Request {
  const headers: Record<string, string> = { "x-forwarded-for": init.ip };
  if (init.origin) headers.origin = init.origin;
  return new Request(`https://example.supabase.co/functions/v1/availability${query}`, {
    method: init.method ?? "GET",
    headers,
  });
}

describe("edge function handler", () => {
  it("answers the CORS preflight with 204 and the allowlisted headers", async () => {
    const response = await handleRequest(get("?domain=pixel.com", { ip: ip("198"), origin: "https://example.test", method: "OPTIONS" }));
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toContain("GET");
    expect(response.headers.get("access-control-allow-headers")).toContain("apikey");
  });

  it("refuses anything that is not a GET", async () => {
    const response = await handleRequest(get("?domain=pixel.com", { ip: ip("199"), method: "POST" }));
    expect(response.status).toBe(405);
    expect(await response.json()).toEqual({ error: "Method not allowed" });
  });

  it("explains the request shape when no name is supplied", async () => {
    const response = await handleRequest(get("", { ip: ip("200") }));
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain("?domain=");
  });

  it("reports a malformed name as unsupported instead of guessing", async () => {
    const response = await handleRequest(get("?domain=not_a_domain", { ip: ip("201") }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { results: { status: string; confirmed: boolean; errorCode?: string }[] };
    expect(body.results).toHaveLength(1);
    expect(body.results[0]?.status).toBe("unsupported_tld");
    expect(body.results[0]?.confirmed).toBe(false);
    expect(body.results[0]?.errorCode).toBe("invalid_domain");
  });

  it("stops a runaway caller with 429 and a Retry-After the UI can show", async () => {
    const caller = ip("202");
    const request = () => get("?domain=not_a_domain", { ip: caller });
    const limit = parseRateLimit(undefined);
    for (let i = 0; i < limit; i += 1) {
      expect((await handleRequest(request())).status).toBe(200);
    }
    const blocked = await handleRequest(request());
    expect(blocked.status).toBe(429);
    const retryAfter = Number(blocked.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
    // The client maps a bare 429 to `rate_limited`, so the body must not look like an answer.
    expect(await blocked.json()).not.toHaveProperty("results");
  });

  it("treats a duplicate batch as one name and caps the list at ten", async () => {
    const many = Array.from({ length: 14 }, (_, index) => `bad_name_${index}`).join(",");
    const response = await handleRequest(get(`?domains=${many}`, { ip: ip("203") }));
    const body = (await response.json()) as { results: unknown[] };
    expect(body.results).toHaveLength(MAX_NAMES_PER_REQUEST);
  });
});
