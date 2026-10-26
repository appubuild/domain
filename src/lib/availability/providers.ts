/**
 * Provider catalogue.
 *
 * Seeded from the same data as `supabase/seed/seed.sql`. `test-fake` is only used by the
 * automated test suite and must never be enabled in a production build — the provider is
 * marked `isProduction: false` and the app filters it out unless explicitly requested.
 */

import type { ProviderConfig } from "./types";

export const DEFAULT_PROVIDER_CONFIGS: ProviderConfig[] = [
  {
    id: "rdap-org",
    name: "RDAP bootstrap (rdap.org)",
    kind: "rdap",
    endpointTemplate: "https://rdap.org/domain/{domain}",
    tlds: [],
    enabled: true,
    priority: 10,
    timeoutMs: 8000,
    rateLimitPerMinute: 30,
    isProduction: true,
  },
  {
    id: "rdap-verisign",
    name: "Verisign RDAP (.com/.net)",
    kind: "rdap",
    endpointTemplate: "https://rdap.verisign.com/{tld}/v1/domain/{domain}",
    tlds: ["com", "net"],
    enabled: true,
    priority: 20,
    timeoutMs: 6000,
    rateLimitPerMinute: 60,
    isProduction: true,
  },
  {
    id: "test-fake",
    name: "Local fake registry (tests only)",
    kind: "mock",
    endpointTemplate: null,
    tlds: [],
    enabled: false,
    priority: 999,
    timeoutMs: 2000,
    rateLimitPerMinute: 1000,
    isProduction: false,
  },
];

/** TLDs we know we cannot verify, with the reason shown in the UI. */
export const UNVERIFIABLE_TLDS: Record<string, string> = {
  sh: "The .sh registry publishes no reliable public RDAP service.",
  ai: "The .ai registry's RDAP coverage is inconsistent; confirm at a registrar.",
};
