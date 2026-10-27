/**
 * Availability Edge Function (Deno / Supabase) — public, read-only registry lookups.
 *
 * A static export runs in the browser and many registry RDAP services send no CORS headers,
 * so this function performs the lookup server-side and shares one cached answer in Postgres.
 * It returns the same result shape the client engine produces, so
 * `src/lib/availability/client.ts` treats it as just another provider.
 *
 * Honesty rules: a provider failure is `check_failed`, never `available_verified`; a 404 is
 * only "available" when the answering service is authoritative for the TLD; rate limits
 * surface as `rate_limited`; and transient failures are not cached, so one timeout cannot be
 * replayed as ten minutes of reported downtime.
 *
 * Public surface (`--no-verify-jwt`, because a static site cannot sign requests): guarded by
 * the `AVAILABILITY_ALLOWED_ORIGIN` allowlist and a soft `AVAILABILITY_RATE_LIMIT` (60/min per
 * caller per isolate). Both, and the operator runbook, are documented in
 * `docs/deployment.md` §5. Deploy with `supabase functions deploy availability --no-verify-jwt`.
 */

// deno-lint-ignore-file no-explicit-any

/* ========================================================================== */
/* Policy — what may be cached, who may call, and how fast                     */
/* ========================================================================== */

/**
 * These four decisions keep a *public, unauthenticated* endpoint honest and affordable. They
 * live in the same file as the handler on purpose: the function is deployed as one source
 * string, so a relative import would have to travel with it. Everything below this banner is
 * free of `Deno` globals and network calls, which is what lets
 * `tests/availability/edge-policy.test.ts` test the shipped code rather than a copy of it.
 */

/* -------------------------------------------------------------------------- */
/* Cache policy                                                               */
/* -------------------------------------------------------------------------- */

export type AvailabilityStatus =
  | "available_verified"
  | "registered"
  | "unavailable"
  | "premium_or_special_pricing"
  | "unknown"
  | "check_failed"
  | "rate_limited"
  | "unsupported_tld";

export const VERIFIED_TTL_SECONDS = 6 * 60 * 60; // 6 hours for definitive answers
export const INCONCLUSIVE_TTL_SECONDS = 10 * 60; // 10 minutes for a registry "no answer"

/**
 * Statuses worth remembering. A timeout is a moment, not a fact about the name: caching
 * `check_failed` would replay one failed attempt as a ten-minute outage to every visitor.
 */
export const CACHEABLE: ReadonlySet<AvailabilityStatus> = new Set<AvailabilityStatus>([
  "available_verified",
  "registered",
  "unavailable",
  "premium_or_special_pricing",
  "unknown",
  "unsupported_tld",
]);

/** Only these describe the registration itself; everything else is a short-lived hint. */
export const DEFINITIVE: ReadonlySet<AvailabilityStatus> = new Set<AvailabilityStatus>([
  "available_verified",
  "registered",
  "unavailable",
  "premium_or_special_pricing",
]);

/** Seconds a result may be served from cache, or `null` when it must not be stored. */
export function cacheTtlSeconds(status: AvailabilityStatus): number | null {
  if (!CACHEABLE.has(status)) return null;
  return DEFINITIVE.has(status) ? VERIFIED_TTL_SECONDS : INCONCLUSIVE_TTL_SECONDS;
}

/* -------------------------------------------------------------------------- */
/* CORS policy                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Parses `AVAILABILITY_ALLOWED_ORIGIN`.
 *
 * `*` (and an unset value) means "any origin" — acceptable for a read-only lookup, but it
 * lets any site spend this project's registry quota. A comma-separated list reflects only
 * the matching origin (entries may contain one `*`, as in `https://domainfits-*.vercel.app`,
 * to cover per-branch preview aliases). A disallowed origin still receives a body but no
 * matching header, so the browser refuses to hand it to the page.
 */
export function parseAllowedOrigins(raw: string | undefined | null): string[] {
  const values = (raw ?? "*")
    .split(",")
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter(Boolean);
  return values.length > 0 ? values : ["*"];
}

export function isWildcard(allowlist: readonly string[]): boolean {
  return allowlist.includes("*");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Matches one allowlist entry against a caller origin.
 *
 * An entry may contain `*`, which stands for one or more characters that are not a slash —
 * enough to cover `https://domainfits-*.vercel.app` (per-branch preview aliases) without
 * opening the endpoint to every `*.vercel.app` site. Because an origin has no path, `*`
 * cannot be used to smuggle in a different host.
 */
export function originMatches(pattern: string, requestOrigin: string): boolean {
  if (pattern === requestOrigin) return true;
  if (!pattern.includes("*")) return false;
  const expression = pattern.split("*").map(escapeRegExp).join("[^/]+");
  return new RegExp(`^${expression}$`).test(requestOrigin);
}

/**
 * The value to send in `access-control-allow-origin` for one request.
 *
 * When the allowlist is explicit and the caller is not on it, the first allowed origin is
 * echoed rather than a lie: the response is still usable by a person with curl, and unusable
 * by the disallowed page, which is the intent.
 */
export function corsOriginFor(requestOrigin: string | null, allowlist: readonly string[]): string {
  if (isWildcard(allowlist)) return "*";
  if (requestOrigin && allowlist.some((pattern) => originMatches(pattern, requestOrigin))) {
    return requestOrigin;
  }
  // Never echo a pattern containing `*`: the browser would not match it against a literal
  // origin, and a header that looks permissive while doing nothing is worse than an obvious
  // mismatch. A concrete entry (the first one without `*`, else `"null"`) is honest.
  return allowlist.find((pattern) => !pattern.includes("*")) ?? "null";
}

/* -------------------------------------------------------------------------- */
/* Rate limit policy (per isolate, soft)                                      */
/* -------------------------------------------------------------------------- */

export type RateWindow = { count: number; resetAt: number };

export const DEFAULT_RATE_LIMIT = 60;
export const RATE_WINDOW_MS = 60_000;

/** `AVAILABILITY_RATE_LIMIT`, sanitised: a garbage value must not disable the limit. */
export function parseRateLimit(raw: string | undefined | null): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_RATE_LIMIT;
  return Math.floor(parsed);
}

export type RateDecision = { limited: false } | { limited: true; retryAfterSeconds: number };

/**
 * Counts one request against a caller's window.
 *
 * This mutates the map it is given; that is the point. The limit is **soft** — the isolate's
 * memory is not shared and is recycled — so it exists to blunt a runaway loop or a naive
 * scraper, not to guarantee a quota. The Postgres cache is what actually protects the
 * registries from repeat lookups.
 */
export function takeRateToken(
  windows: Map<string, RateWindow>,
  key: string,
  limit: number,
  now = Date.now(),
  windowMs = RATE_WINDOW_MS,
): RateDecision {
  if (windows.size > 5_000) {
    for (const [candidate, window] of windows) if (window.resetAt <= now) windows.delete(candidate);
  }
  const existing = windows.get(key);
  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { limited: false };
  }
  existing.count += 1;
  if (existing.count > limit) {
    return { limited: true, retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)) };
  }
  return { limited: false };
}

/** Best-effort caller identity from the headers the platform sets. */
export function clientKeyFrom(headers: { get(name: string): string | null }): string {
  const forwarded = headers.get("x-forwarded-for") ?? "";
  const first = forwarded.split(",")[0]?.trim();
  return first || headers.get("cf-connecting-ip") || headers.get("x-real-ip") || "unknown";
}

/* -------------------------------------------------------------------------- */
/* Domain shape                                                               */
/* -------------------------------------------------------------------------- */

export const DOMAIN_PATTERN = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,18}$/;

export const MAX_NAMES_PER_REQUEST = 10;

/** Normalises and caps a `domains=` list. Duplicates collapse — one lookup per name. */
export function parseDomainList(raw: string | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of raw.split(",")) {
    const domain = value.trim().toLowerCase();
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    out.push(domain);
    if (out.length >= MAX_NAMES_PER_REQUEST) break;
  }
  return out;
}


/**
 * Reads a secret without assuming Deno exists.
 *
 * The ordinary test suite imports this module to exercise the policy above, and vitest has no
 * `Deno` global. Reading configuration through one guarded accessor is what lets the tested
 * file be the deployed file; in production the branch is always taken and the `catch` never
 * runs. A missing value is `undefined`, never a silent empty string that would look configured.
 */
function envValue(name: string): string | undefined {
  try {
    if (typeof Deno === "undefined" || typeof Deno.env?.get !== "function") return undefined;
    return Deno.env.get(name) ?? undefined;
  } catch {
    return undefined;
  }
}

const SUPABASE_URL = envValue("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = envValue("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const FETCH_TIMEOUT_MS = 8000;

const ALLOWED_ORIGINS = parseAllowedOrigins(envValue("AVAILABILITY_ALLOWED_ORIGIN"));
const RATE_LIMIT = parseRateLimit(envValue("AVAILABILITY_RATE_LIMIT"));

const BASE_CORS_HEADERS: Record<string, string> = {
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-max-age": "86400",
  vary: "origin",
};

type Status = AvailabilityStatus;

type Result = {
  domain: string;
  tld: string;
  status: Status;
  providerId: string;
  providerKind: "rdap";
  checkedAt: string;
  cached: boolean;
  confirmed: boolean;
  httpStatus?: number;
  latencyMs?: number;
  errorCode?: string;
  guidance: string;
  detail?: string;
};

const GUIDANCE: Record<Status, string> = {
  available_verified:
    "The registry returned no registration record. Registration is not guaranteed — confirm with a registrar before paying.",
  registered: "A registration record exists. This name is taken.",
  unavailable: "The registry reports this name cannot be registered.",
  premium_or_special_pricing: "The registry marks this name as reserved or premium-priced.",
  unknown: "The registry gave no usable answer. This is not evidence that the name is free.",
  check_failed: "The lookup failed (network, provider error or timeout). Try again later.",
  rate_limited: "The registry asked us to slow down. Retry after a short wait.",
  unsupported_tld: "No RDAP service is configured for this extension.",
};

/**
 * RDAP bootstrap. `rdap.org` redirects to the authoritative registry, so a 404 there means
 * "the registry has no record" for TLDs it covers; for everything else we downgrade to
 * `unknown` rather than claim availability.
 */
const BOOTSTRAP_URL = "https://rdap.org/domain/{domain}";
const AUTHORITATIVE_HOSTS = ["rdap.verisign.com", "rdap.org"];

/* -------------------------------------------------------------------------- */
/* CORS                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Reflects the caller's origin only when it is on the allowlist. A disallowed origin still
 * gets a response body (the data is public), but without a matching header the browser
 * refuses to hand it to the page — which is what stops a third-party site from using this
 * project as a free proxy.
 */
function corsHeaders(request: Request): Record<string, string> {
  return {
    ...BASE_CORS_HEADERS,
    "access-control-allow-origin": corsOriginFor(request.headers.get("origin"), ALLOWED_ORIGINS),
  };
}

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

/* -------------------------------------------------------------------------- */
/* Rate limit (per isolate, soft)                                             */
/* -------------------------------------------------------------------------- */

const windows = new Map<string, RateWindow>();

/** Returns the seconds to wait when over budget, or 0 when the call may proceed. */
function rateLimited(key: string, now = Date.now()): number {
  const decision = takeRateToken(windows, key, RATE_LIMIT, now);
  return decision.limited ? decision.retryAfterSeconds : 0;
}

/* -------------------------------------------------------------------------- */
/* Cache                                                                      */
/* -------------------------------------------------------------------------- */

async function db(path: string, init: RequestInit = {}): Promise<Response | null> {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return null;
  try {
    return await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: SERVICE_ROLE_KEY,
        authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates,return=minimal",
        ...(init.headers ?? {}),
      },
    });
  } catch {
    return null;
  }
}

async function readCache(domain: string): Promise<Result | null> {
  const response = await db(
    `availability_cache?domain=eq.${encodeURIComponent(domain)}&expires_at=gt.${new Date().toISOString()}&select=domain,status,provider_id,provider_kind,confirmed,checked_at`,
  );
  if (!response?.ok) return null;
  const rows = (await response.json()) as any[];
  const row = rows?.[0];
  if (!row) return null;
  return {
    domain: row.domain,
    tld: row.domain.split(".").pop() ?? "",
    status: row.status as Status,
    providerId: String(row.provider_id ?? "rdap-bootstrap"),
    providerKind: "rdap",
    checkedAt: row.checked_at,
    cached: true,
    confirmed: Boolean(row.confirmed),
    guidance: GUIDANCE[row.status as Status] ?? GUIDANCE.unknown,
  };
}

/**
 * Writes a cache row only for statuses that describe the name rather than the moment.
 * Skipping transient failures keeps the next visitor's answer honest: "check_failed" is a
 * statement about one attempt, and replaying it for ten minutes would turn a momentary
 * blip into a reported outage.
 */
async function writeCache(result: Result): Promise<boolean> {
  const ttl = cacheTtlSeconds(result.status);
  if (ttl === null) return false;
  const response = await db("availability_cache", {
    method: "POST",
    body: JSON.stringify({
      domain: result.domain,
      status: result.status,
      provider_id: null, // kept null: provider rows are admin-managed, the id is informational
      provider_kind: "rdap",
      confirmed: result.confirmed,
      checked_at: result.checkedAt,
      expires_at: new Date(Date.now() + ttl * 1000).toISOString(),
    }),
  });
  return Boolean(response?.ok);
}

/* -------------------------------------------------------------------------- */
/* Lookup                                                                     */
/* -------------------------------------------------------------------------- */

function detectPremium(body: any): boolean {
  const text = JSON.stringify(body ?? {}).toLowerCase();
  return /"status"\s*:\s*\[[^\]]*"(reserved|premium|blocked)"/.test(text) || /premium|reserved/.test(text);
}

async function lookup(domain: string): Promise<Result> {
  const tld = domain.split(".").pop() ?? "";
  const startedAt = Date.now();
  const base = {
    domain,
    tld,
    providerId: "rdap-bootstrap",
    providerKind: "rdap" as const,
    checkedAt: new Date().toISOString(),
    cached: false,
    confirmed: false,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(BOOTSTRAP_URL.replace("{domain}", encodeURIComponent(domain)), {
      headers: { accept: "application/rdap+json, application/json" },
      redirect: "follow",
      signal: controller.signal,
    });
    const latencyMs = Date.now() - startedAt;
    const host = hostOf(response.url) ?? "rdap.org";
    const authoritative = AUTHORITATIVE_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));

    if (response.status === 404) {
      return {
        ...base,
        status: authoritative ? "available_verified" : "unknown",
        confirmed: authoritative,
        httpStatus: 404,
        latencyMs,
        guidance: authoritative ? GUIDANCE.available_verified : GUIDANCE.unknown,
        detail: `Answered by ${host}`,
      };
    }

    if (response.status === 429) {
      return { ...base, status: "rate_limited", httpStatus: 429, latencyMs, guidance: GUIDANCE.rate_limited };
    }

    if (response.status === 400 || response.status === 422) {
      return { ...base, status: "unsupported_tld", httpStatus: response.status, latencyMs, guidance: GUIDANCE.unsupported_tld };
    }

    if (response.status >= 500) {
      return {
        ...base,
        status: "check_failed",
        httpStatus: response.status,
        latencyMs,
        errorCode: `registry_${response.status}`,
        guidance: GUIDANCE.check_failed,
      };
    }

    if (response.ok) {
      const body = await response.json().catch(() => null);
      const premium = detectPremium(body);
      return {
        ...base,
        status: premium ? "premium_or_special_pricing" : "registered",
        confirmed: true,
        httpStatus: response.status,
        latencyMs,
        guidance: premium ? GUIDANCE.premium_or_special_pricing : GUIDANCE.registered,
        detail: `Answered by ${host}`,
      };
    }

    return {
      ...base,
      status: "unknown",
      httpStatus: response.status,
      latencyMs,
      guidance: GUIDANCE.unknown,
    };
  } catch (error) {
    return {
      ...base,
      status: "check_failed",
      latencyMs: Date.now() - startedAt,
      errorCode: (error as Error)?.name === "AbortError" ? "timeout" : "network",
      guidance: GUIDANCE.check_failed,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** `new URL("")` throws; the answering host is a detail, not a reason to fail a lookup. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

/**
 * Collapses concurrent lookups of the same name. A results grid asks about the same candidate
 * from several places at once (a re-render, a filter change, a second tab); without this each
 * request would hit the registry and race to write the same cache row.
 */
const inFlight = new Map<string, Promise<Result>>();

async function checkOne(input: string): Promise<Result> {
  const domain = input.trim().toLowerCase();
  if (!DOMAIN_PATTERN.test(domain)) {
    return {
      domain,
      tld: domain.split(".").pop() ?? "",
      status: "unsupported_tld",
      providerId: "none",
      providerKind: "rdap",
      checkedAt: new Date().toISOString(),
      cached: false,
      confirmed: false,
      errorCode: "invalid_domain",
      guidance: "That is not a valid domain name.",
    };
  }

  const cached = await readCache(domain);
  if (cached) return cached;

  const pending = inFlight.get(domain);
  if (pending) return pending;

  const task = (async () => {
    const result = await lookup(domain);
    await writeCache(result);
    return result;
  })().finally(() => inFlight.delete(domain));

  inFlight.set(domain, task);
  return task;
}

/* -------------------------------------------------------------------------- */
/* Handler                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The handler, exported so a test can drive it with a `Request` and assert on the response
 * status and headers — CORS reflection and the 429 path are behaviour, not configuration.
 */
export async function handleRequest(request: Request, now = Date.now()): Promise<Response> {
  const cors = corsHeaders(request);

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405, cors);

  const wait = rateLimited(clientKeyFrom(request.headers), now);
  if (wait > 0) {
    return new Response(
      JSON.stringify({ error: "Too many lookups", retryAfterSeconds: wait }),
      {
        status: 429,
        headers: {
          ...cors,
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "retry-after": String(wait),
        },
      },
    );
  }

  const url = new URL(request.url);
  const domain = url.searchParams.get("domain");
  const list = url.searchParams.get("domains");

  if (!domain && !list) return json({ error: "Provide ?domain=<name> or ?domains=a.com,b.io" }, 400, cors);

  const inputs = parseDomainList(list ?? domain ?? "");
  if (inputs.length === 0) return json({ error: "No domains supplied" }, 400, cors);

  const results = await Promise.all(inputs.map((input) => checkOne(input)));
  return json({ results, checkedAt: new Date().toISOString() }, 200, cors);
}

// Leaves the module importable (tests) while starting the server under Deno.
if (typeof Deno !== "undefined" && typeof Deno.serve === "function") {
  Deno.serve(handleRequest);
}
