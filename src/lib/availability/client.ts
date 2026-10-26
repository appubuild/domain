/**
 * Browser availability client.
 *
 * The engine (`engine.ts`) and providers (`rdap.ts`) are transport-agnostic. This module
 * supplies the two things a static site needs to make them usable:
 *
 *   1. A **session cache** so a name is not re-queried on every scroll or filter change.
 *      Browsers cannot share a server cache, and localStorage survives a reload.
 *   2. A **transport decision**. Either a deployed Supabase Edge Function proxies RDAP
 *      (preferred: no CORS problems, central rate limiting, shared cache), or the browser
 *      talks to registries directly (some RDAP services allow CORS, others do not).
 *
 * When a lookup cannot happen, the result is `check_failed` or `unsupported_tld` — never
 * `available_verified`. There is no path in this file that turns an error into a sale signal.
 */

import { PUBLIC_ENV } from "@/lib/config/env";
import type { AvailabilityInfo } from "@/lib/generator/filters";
import { AvailabilityEngine, MAX_CONCURRENCY } from "./engine";
import { DEFAULT_PROVIDER_CONFIGS } from "./providers";
import { createRdapProvider } from "./rdap";
import {
  guidanceFor,
  type AvailabilityCache,
  type AvailabilityProvider,
  type AvailabilityResult,
  type AvailabilityStatus,
  type CachedCheck,
  type ProviderCapabilities,
} from "./types";

const CACHE_KEY = "availability.cache.v1";
const MAX_CACHE_ENTRIES = 500;

export type AvailabilityMode = "edge-function" | "direct-rdap" | "none";

export type BrowserEngine = {
  engine: AvailabilityEngine;
  mode: AvailabilityMode;
  /** Human-readable explanation shown in the results panel. */
  note: string;
};

/* -------------------------------------------------------------------------- */
/* Session cache                                                              */
/* -------------------------------------------------------------------------- */

type CacheEnvelope = Record<string, CachedCheck>;

function readEnvelope(): CacheEnvelope {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as CacheEnvelope) : {};
  } catch {
    return {};
  }
}

function writeEnvelope(envelope: CacheEnvelope): boolean {
  if (typeof window === "undefined") return false;
  try {
    // Drop the oldest entries first so a long session cannot fill the quota.
    const entries = Object.entries(envelope);
    if (entries.length > MAX_CACHE_ENTRIES) {
      entries.sort((a, b) => Date.parse(a[1].checkedAt) - Date.parse(b[1].checkedAt));
      envelope = Object.fromEntries(entries.slice(entries.length - MAX_CACHE_ENTRIES));
    }
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(envelope));
    return true;
  } catch {
    return false;
  }
}

/**
 * Availability cache persisted in localStorage.
 *
 * Correctness note: expiry is decided by the *engine* (it compares `expiresAt` with now),
 * this store only round-trips records — so a clock change cannot silently revive a stale
 * "registered" answer as current.
 */
export class SessionAvailabilityCache implements AvailabilityCache {
  private memory: CacheEnvelope;

  constructor(initial?: CacheEnvelope) {
    this.memory = initial ?? readEnvelope();
  }

  get(domain: string): CachedCheck | null {
    return this.memory[domain.trim().toLowerCase()] ?? null;
  }

  set(domain: string, value: CachedCheck): void {
    this.memory[domain.trim().toLowerCase()] = value;
    if (!writeEnvelope(this.memory)) {
      // Storage unavailable (private mode / quota): keep working in memory for this session.
      return;
    }
  }

  size(): number {
    return Object.keys(this.memory).length;
  }

  clear(): void {
    this.memory = {};
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(CACHE_KEY);
    } catch {
      /* ignore */
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Edge function transport                                                    */
/* -------------------------------------------------------------------------- */

const VALID_STATUSES: ReadonlySet<string> = new Set<AvailabilityStatus>([
  "available_verified",
  "registered",
  "unavailable",
  "premium_or_special_pricing",
  "unknown",
  "check_failed",
  "rate_limited",
  "unsupported_tld",
]);

type EdgeResponse = {
  results?: Array<Partial<AvailabilityResult> & { domain?: string }>;
  error?: string;
};

/**
 * Provider backed by our own Supabase Edge Function.
 *
 * The function returns results with the same shape as the local engine. Every field is
 * re-validated here: an unknown status counts as `unknown`, and a response that fails
 * schema checks becomes `check_failed` rather than being displayed as an answer.
 */
export function createEdgeFunctionProvider(
  functionUrl: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): AvailabilityProvider {
  const capabilities: ProviderCapabilities = {
    tlds: [],
    treatsNotFoundAsUnregistered: true,
    detectsPremium: true,
    authoritative: false,
  };

  const normalizedUrl = functionUrl.replace(/\/$/, "");

  return {
    id: "edge-function",
    name: "DomainFits availability service",
    kind: "edge-function",
    capabilities: () => capabilities,
    supports: () => true,
    async check(domain, context = {}): Promise<AvailabilityResult> {
      const now = context.now ?? (() => new Date());
      const fetchImpl = options.fetchImpl ?? context.fetchImpl ?? globalThis.fetch;
      const tld = domain.split(".").pop() ?? "";
      const base = {
        domain,
        tld,
        providerId: "edge-function",
        providerKind: "edge-function" as const,
        checkedAt: now().toISOString(),
        cached: false,
        confirmed: false,
      };

      if (typeof fetchImpl !== "function") {
        return {
          ...base,
          status: "check_failed",
          errorCode: "no_fetch",
          guidance: guidanceFor("check_failed"),
        };
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 12_000);
      const startedAt = Date.now();

      try {
        const response = await fetchImpl(`${normalizedUrl}?domain=${encodeURIComponent(domain)}`, {
          method: "GET",
          headers: { accept: "application/json" },
          signal: context.signal ?? controller.signal,
        });

        if (response.status === 429) {
          return {
            ...base,
            status: "rate_limited",
            httpStatus: 429,
            latencyMs: Date.now() - startedAt,
            errorCode: "edge_rate_limited",
            guidance: guidanceFor("rate_limited"),
          };
        }
        if (response.status === 400 || response.status === 422) {
          return {
            ...base,
            status: "unsupported_tld",
            httpStatus: response.status,
            latencyMs: Date.now() - startedAt,
            errorCode: "edge_unsupported",
            guidance: guidanceFor("unsupported_tld"),
          };
        }
        if (!response.ok) {
          return {
            ...base,
            status: "check_failed",
            httpStatus: response.status,
            latencyMs: Date.now() - startedAt,
            errorCode: `edge_http_${response.status}`,
            guidance: guidanceFor("check_failed"),
          };
        }

        const body = (await response.json()) as EdgeResponse;
        const row = body.results?.find((entry) => entry.domain?.toLowerCase() === domain.toLowerCase()) ?? body.results?.[0];
        const status = String(row?.status ?? "");
        if (!row || !VALID_STATUSES.has(status)) {
          return {
            ...base,
            status: "unknown",
            httpStatus: response.status,
            latencyMs: Date.now() - startedAt,
            errorCode: "edge_invalid_payload",
            guidance: guidanceFor("unknown"),
          };
        }

        return {
          ...base,
          status: status as AvailabilityStatus,
          httpStatus: row.httpStatus ?? response.status,
          latencyMs: row.latencyMs ?? Date.now() - startedAt,
          confirmed: row.confirmed === true,
          errorCode: typeof row.errorCode === "string" ? row.errorCode : undefined,
          detail: typeof row.detail === "string" ? row.detail.slice(0, 240) : undefined,
          guidance: typeof row.guidance === "string" && row.guidance ? row.guidance : guidanceFor(status as AvailabilityStatus),
        };
      } catch (error) {
        const aborted = (error as Error)?.name === "AbortError";
        return {
          ...base,
          status: "check_failed",
          latencyMs: Date.now() - startedAt,
          errorCode: aborted ? "edge_timeout" : "edge_network",
          guidance: guidanceFor("check_failed"),
        };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Engine factory                                                             */
/* -------------------------------------------------------------------------- */

export type BrowserEngineOptions = {
  functionUrl?: string | null;
  fetchImpl?: typeof fetch;
  cache?: AvailabilityCache;
  /** Override the provider list (tests). */
  providers?: AvailabilityProvider[];
  now?: () => Date;
};

/**
 * Chooses a transport and returns a ready engine.
 *
 * `mode` and `note` are surfaced in the UI so the user knows whether an answer came from
 * our service or straight from a registry — and when nothing can be checked at all.
 */
export function buildBrowserEngine(options: BrowserEngineOptions = {}): BrowserEngine {
  const functionUrl = options.functionUrl ?? PUBLIC_ENV.availabilityFunctionUrl;
  const cache = options.cache ?? new SessionAvailabilityCache();

  const engineOptions = {
    cache,
    fetchImpl: options.fetchImpl,
    now: options.now,
  };

  if (options.providers) {
    return {
      engine: new AvailabilityEngine({ providers: options.providers, ...engineOptions }),
      mode: "direct-rdap",
      note: "Using the injected provider set.",
    };
  }

  if (functionUrl) {
    return {
      engine: new AvailabilityEngine({
        providers: [createEdgeFunctionProvider(functionUrl, { fetchImpl: options.fetchImpl })],
        ...engineOptions,
      }),
      mode: "edge-function",
      note: "Checks run through the DomainFits availability service, which queries each registry once and caches the answer.",
    };
  }

  const providers = DEFAULT_PROVIDER_CONFIGS.filter((config) => config.isProduction && config.enabled).map(
    createRdapProvider,
  );

  if (providers.length === 0) {
    return {
      engine: new AvailabilityEngine({ providers: [], ...engineOptions }),
      mode: "none",
      note: "No availability provider is configured, so every check reports an unsupported extension.",
    };
  }

  return {
    engine: new AvailabilityEngine({ providers, ...engineOptions }),
    mode: "direct-rdap",
    note: "Checks query public RDAP services directly from your browser. Some registries block cross-origin requests; those results are reported as failed checks, never as available.",
  };
}

/* -------------------------------------------------------------------------- */
/* Mapping + helpers                                                          */
/* -------------------------------------------------------------------------- */

/** Converts an engine result into the shape the filter/UI layer consumes. */
export function toAvailabilityInfo(result: AvailabilityResult): AvailabilityInfo {
  return {
    status: result.status,
    checkedAt: result.checkedAt,
    provider: result.providerId === "none" ? null : result.providerId,
    cached: result.cached,
    confirmed: result.confirmed,
  };
}

/** Domains a candidate should be checked under, in display order. */
export function domainsForCheck(
  candidates: Array<{ label: string; domains: Array<{ domain: string }> }>,
  extensions: string[],
): string[] {
  const wanted = new Set(extensions.map((tld) => tld.toLowerCase().replace(/^\./, "")));
  const domains: string[] = [];
  for (const candidate of candidates) {
    for (const entry of candidate.domains) {
      const tld = entry.domain.split(".").pop()?.toLowerCase() ?? "";
      if (wanted.size > 0 && !wanted.has(tld)) continue;
      domains.push(entry.domain);
    }
  }
  return Array.from(new Set(domains));
}

export const AVAILABILITY_BATCH_FLOOR = MAX_CONCURRENCY;

/**
 * Splits a large check set into batches so the UI can report progress and stay responsive.
 * The engine already bounds concurrency; batching bounds *total* work per interaction.
 */
export function chunkDomains(domains: string[], size = 25): string[][] {
  const batchSize = Math.max(1, Math.min(100, Math.floor(size)));
  const batches: string[][] = [];
  for (let index = 0; index < domains.length; index += batchSize) {
    batches.push(domains.slice(index, index + batchSize));
  }
  return batches;
}

/** True when the status is one the user should act on. */
export function isReportable(status: AvailabilityStatus): boolean {
  return status !== "unknown" && status !== "check_failed" && status !== "rate_limited" && status !== "unsupported_tld";
}

/**
 * Builds the per-candidate summary the result list and filters use.
 *
 * A candidate may have several domains (one per selected extension). The summary takes the
 * **first checked domain in the candidate's own order**, so the badge always describes a
 * specific domain rather than an optimistic average. Per-domain detail stays available to
 * the UI through `byDomain`.
 */
export function summarizeByLabel(
  candidates: Array<{ label: string; domains: Array<{ domain: string }> }>,
  byDomain: Map<string, AvailabilityResult>,
): Map<string, AvailabilityInfo> {
  const summary = new Map<string, AvailabilityInfo>();
  for (const candidate of candidates) {
    for (const entry of candidate.domains) {
      const result = byDomain.get(entry.domain.toLowerCase());
      if (!result) continue;
      summary.set(candidate.label, toAvailabilityInfo(result));
      break;
    }
  }
  return summary;
}

/** Counts results by status, used for the run summary toast. */
export function summarizeResults(results: AvailabilityResult[]): Array<{ status: AvailabilityStatus; count: number }> {
  const counts = new Map<AvailabilityStatus, number>();
  for (const result of results) counts.set(result.status, (counts.get(result.status) ?? 0) + 1);
  return [...counts.entries()]
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);
}
