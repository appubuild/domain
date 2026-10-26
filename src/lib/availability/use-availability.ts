"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { trackEvent } from "@/lib/analytics/events";
import {
  buildBrowserEngine,
  chunkDomains,
  domainsForCheck,
  isReportable,
  type AvailabilityMode,
} from "./client";
import type { AvailabilityResult, AvailabilityStatus } from "./types";

export type AvailabilityProgress = {
  completed: number;
  total: number;
  /** Per-status tally for the run so far. */
  tally: Partial<Record<AvailabilityStatus, number>>;
};

export type AvailabilityApi = {
  /** Precise results keyed by full domain. */
  byDomain: Map<string, AvailabilityResult>;
  checking: boolean;
  progress: AvailabilityProgress | null;
  mode: AvailabilityMode;
  note: string;
  run: (domains: string[], options?: { force?: boolean }) => Promise<AvailabilityResult[]>;
  cancel: () => void;
  clear: () => void;
};

const MAX_DOMAINS_PER_RUN = 200;

/**
 * Drives availability checks from the browser.
 *
 * Everything the user sees comes from a provider response or an explicit failure status.
 * The hook never seeds results, never retries into a "probably available" state, and stops
 * itself at a bounded number of domains per run so a 5,000-row result set cannot turn into
 * an accidental denial-of-service against public registries.
 */
export function useAvailability(): AvailabilityApi {
  const [byDomain, setByDomain] = useState<Map<string, AvailabilityResult>>(new Map());
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState<AvailabilityProgress | null>(null);
  const engineRef = useRef<ReturnType<typeof buildBrowserEngine> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const runIdRef = useRef(0);

  const engine = useMemo(() => {
    if (!engineRef.current) engineRef.current = buildBrowserEngine();
    return engineRef.current;
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setChecking(false);
    setProgress(null);
  }, []);

  const clear = useCallback(() => {
    cancel();
    setByDomain(new Map());
  }, [cancel]);

  const run = useCallback(
    async (input: string[], options: { force?: boolean } = {}) => {
      const domains = Array.from(new Set(input.map((domain) => domain.trim().toLowerCase()).filter(Boolean))).slice(
        0,
        MAX_DOMAINS_PER_RUN,
      );
      if (domains.length === 0) return [];
      if (engine.mode === "none") {
        // Nothing can be checked. Report the truth per domain rather than silently doing nothing.
        const results = domains.map<AvailabilityResult>((domain) => ({
          domain,
          tld: domain.split(".").pop() ?? "",
          status: "unsupported_tld",
          providerId: "none",
          providerKind: "edge-function",
          checkedAt: new Date().toISOString(),
          cached: false,
          confirmed: false,
          guidance: "No availability provider is configured for this build.",
          errorCode: "no_provider",
        }));
        setByDomain((current) => {
          const next = new Map(current);
          for (const result of results) next.set(result.domain, result);
          return next;
        });
        return results;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const runId = runIdRef.current + 1;
      runIdRef.current = runId;

      setChecking(true);
      const tally: Partial<Record<AvailabilityStatus, number>> = {};
      let completed = 0;
      setProgress({ completed: 0, total: domains.length, tally });

      const collected: AvailabilityResult[] = [];

      try {
        for (const batch of chunkDomains(domains, 25)) {
          if (controller.signal.aborted || runIdRef.current !== runId) break;
          const batchResults = await engine.engine.checkMany(batch, {
            force: options.force,
            signal: controller.signal,
            concurrency: 4,
            maxRetries: 1,
            onProgress: ({ result }) => {
              if (!result) return;
              completed += 1;
              tally[result.status] = (tally[result.status] ?? 0) + 1;
              if (runIdRef.current === runId) {
                setByDomain((current) => {
                  const next = new Map(current);
                  next.set(result.domain, result);
                  return next;
                });
                setProgress({ completed, total: domains.length, tally: { ...tally } });
              }
            },
          });
          collected.push(...batchResults);
        }
      } finally {
        if (runIdRef.current === runId) {
          setChecking(false);
          setProgress(null);
          abortRef.current = null;
        }
      }

      if (runIdRef.current !== runId) return collected;

      const actionable = collected.filter((result) => isReportable(result.status));
      const failures = collected.filter(
        (result) => result.status === "check_failed" || result.status === "rate_limited" || result.status === "unknown",
      );

      trackEvent("availability_check", {
        payload: {
          checked: collected.length,
          available: collected.filter((result) => result.status === "available_verified").length,
          registered: collected.filter((result) => result.status === "registered").length,
          actionable: actionable.length,
          mode: engine.mode,
        },
      });
      if (failures.length > 0) {
        trackEvent("availability_failure", {
          payload: {
            failed: failures.length,
            codes: Array.from(new Set(failures.map((result) => result.errorCode ?? result.status))).slice(0, 5),
            mode: engine.mode,
          },
        });
      }

      return collected;
    },
    [engine],
  );

  return { byDomain, checking, progress, mode: engine.mode, note: engine.note, run, cancel, clear };
}

export { domainsForCheck };
