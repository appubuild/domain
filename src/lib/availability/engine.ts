/**
 * Availability engine: provider resolution, caching, retries and bounded batch checks.
 *
 * Design constraints:
 *  - the browser must never fire thousands of uncontrolled requests (Section 9.4)
 *  - a failed check must never be reported as available (Section 9.2)
 *  - every result carries provider, timestamp and cache state (Section 9.5)
 */

import { isVerifiedStatus, type AvailabilityCache, type AvailabilityProvider, type AvailabilityResult } from "./types";
import { guidanceFor } from "./types";

export type EngineOptions = {
  providers: AvailabilityProvider[];
  cache?: AvailabilityCache;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  /** TTL for definitive answers. Default 6 hours. */
  verifiedTtlMs?: number;
  /** TTL for inconclusive answers (failures, rate limits). Default 10 minutes. */
  inconclusiveTtlMs?: number;
};

export type CheckOptions = {
  force?: boolean;
  signal?: AbortSignal;
};

export type BatchOptions = CheckOptions & {
  concurrency?: number;
  maxRetries?: number;
  onProgress?: (progress: { completed: number; total: number; result?: AvailabilityResult }) => void;
};

const DEFAULT_VERIFIED_TTL = 6 * 60 * 60 * 1000;
const DEFAULT_INCONCLUSIVE_TTL = 10 * 60 * 1000;
const MIN_CONCURRENCY = 1;
export const MAX_CONCURRENCY = 8;

export class AvailabilityEngine {
  private readonly options: EngineOptions;

  constructor(options: EngineOptions) {
    this.options = options;
  }

  /** Returns the highest-priority enabled provider that claims this TLD. */
  resolveProvider(tld: string): AvailabilityProvider | null {
    const normalized = tld.toLowerCase().replace(/^\./, "");
    const candidates = this.options.providers.filter((provider) => provider.supports(normalized));
    if (candidates.length === 0) return null;
    const priority = (provider: AvailabilityProvider) =>
      this.options.providers.findIndex((candidate) => candidate.id === provider.id);
    return [...candidates].sort((a, b) => priority(a) - priority(b))[0] ?? null;
  }

  async check(domain: string, options: CheckOptions = {}): Promise<AvailabilityResult> {
    const normalizedDomain = domain.trim().toLowerCase();
    const tld = normalizedDomain.split(".").pop() ?? "";
    const now = this.options.now ?? (() => new Date());
    const provider = this.resolveProvider(tld);

    if (!provider) {
      return {
        domain: normalizedDomain,
        tld,
        status: "unsupported_tld",
        providerId: "none",
        providerKind: "edge-function",
        checkedAt: now().toISOString(),
        cached: false,
        confirmed: false,
        guidance: guidanceFor("unsupported_tld"),
      };
    }

    const cache = this.options.cache;
    if (cache && !options.force) {
      const cached = await cache.get(normalizedDomain);
      if (cached && new Date(cached.expiresAt).getTime() > now().getTime()) {
        return {
          domain: cached.domain,
          tld,
          status: cached.status,
          providerId: cached.providerId,
          providerKind: cached.providerKind,
          checkedAt: cached.checkedAt,
          cached: true,
          confirmed: cached.confirmed,
          guidance: cached.guidance,
          detail: "Served from cache.",
        };
      }
    }

    const result = await provider.check(normalizedDomain, {
      fetchImpl: this.options.fetchImpl,
      signal: options.signal,
      now,
    });

    if (cache) {
      const ttl = isVerifiedStatus(result.status)
        ? (this.options.verifiedTtlMs ?? DEFAULT_VERIFIED_TTL)
        : (this.options.inconclusiveTtlMs ?? DEFAULT_INCONCLUSIVE_TTL);
      await cache.set(normalizedDomain, {
        domain: result.domain,
        status: result.status,
        providerId: result.providerId,
        providerKind: result.providerKind,
        checkedAt: result.checkedAt,
        expiresAt: new Date(now().getTime() + ttl).toISOString(),
        confirmed: result.confirmed,
        guidance: result.guidance,
      });
    }

    return result;
  }

  /**
   * Checks a bounded set of domains with limited concurrency and simple exponential
   * backoff for retryable failures. Preserves input order and de-duplicates input.
   */
  async checkMany(domains: string[], options: BatchOptions = {}): Promise<AvailabilityResult[]> {
    const unique = Array.from(new Set(domains.map((domain) => domain.trim().toLowerCase()).filter(Boolean)));
    const concurrency = Math.min(
      MAX_CONCURRENCY,
      Math.max(MIN_CONCURRENCY, options.concurrency ?? 4),
    );
    const maxRetries = Math.max(0, Math.min(3, options.maxRetries ?? 1));
    const results = new Map<string, AvailabilityResult>();
    let completed = 0;

    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < unique.length) {
        if (options.signal?.aborted) return;
        const index = cursor;
        cursor += 1;
        const domain = unique[index];
        if (!domain) continue;

        let attempt = 0;
        let result = await this.check(domain, options);
        while (attempt < maxRetries && (result.status === "check_failed" || result.status === "rate_limited")) {
          attempt += 1;
          await delay(Math.min(2000, 250 * 2 ** attempt));
          if (options.signal?.aborted) break;
          result = await this.check(domain, options);
        }

        results.set(domain, result);
        completed += 1;
        options.onProgress?.({ completed, total: unique.length, result });
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, unique.length) }, worker));

    // Preserve the original ordering (de-duplicated) for predictable display.
    return unique
      .map((domain) => results.get(domain))
      .filter((result): result is AvailabilityResult => Boolean(result));
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Simple in-memory cache, used by tests and short-lived sessions. */
export class MemoryAvailabilityCache implements AvailabilityCache {
  private readonly entries = new Map<string, Parameters<AvailabilityCache["set"]>[1]>();

  get(domain: string) {
    return this.entries.get(domain.toLowerCase()) ?? null;
  }

  set(domain: string, value: Parameters<AvailabilityCache["set"]>[1]) {
    this.entries.set(domain.toLowerCase(), value);
  }

  clear() {
    this.entries.clear();
  }

  get size() {
    return this.entries.size;
  }
}
