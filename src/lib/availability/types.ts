/**
 * Availability domain model.
 *
 * The status vocabulary is fixed and each value has a precise meaning. Nothing in this
 * module may turn "no answer" into "available": the distinction between *unknown*,
 * *check_failed* and *available_verified* is the entire point (Section 9.2).
 */

export type AvailabilityStatus =
  | "available_verified"
  | "registered"
  | "unavailable"
  | "premium_or_special_pricing"
  | "unknown"
  | "check_failed"
  | "rate_limited"
  | "unsupported_tld";

export type ProviderKind = "rdap" | "dns" | "registrar-api" | "edge-function" | "mock";

export type AvailabilityResult = {
  /** Full domain, e.g. `paynest.com`. */
  domain: string;
  tld: string;
  status: AvailabilityStatus;
  providerId: string;
  providerKind: ProviderKind;
  /** ISO timestamp of the lookup (or of the cached value). */
  checkedAt: string;
  /** True when the answer came from cache rather than a fresh request. */
  cached: boolean;
  /**
   * True only when the provider is authoritative for the TLD *and* returned a definitive
   * answer. Registration ability is still not confirmed — see `guidance`.
   */
  confirmed: boolean;
  httpStatus?: number;
  latencyMs?: number;
  /** Machine-readable error code when the check failed. */
  errorCode?: string;
  /** Human guidance shown next to the badge. */
  guidance: string;
  /** Extra provider detail, redacted to a short excerpt. */
  detail?: string;
};

export type ProviderCapabilities = {
  /** TLDs the provider can answer for. Empty array means "unknown, try and see". */
  tlds: string[];
  /** Whether a 404 from this provider means "no registration record". */
  treatsNotFoundAsUnregistered: boolean;
  /** Whether the provider can distinguish premium pricing. */
  detectsPremium: boolean;
  /** Whether the provider is authoritative (registry) or a proxy/bootstrap service. */
  authoritative: boolean;
};

export type ProviderConfig = {
  id: string;
  name: string;
  kind: ProviderKind;
  /** Endpoint template with `{domain}` and optional `{tld}` placeholders. */
  endpointTemplate: string | null;
  tlds: string[];
  enabled: boolean;
  priority: number;
  timeoutMs: number;
  rateLimitPerMinute: number;
  isProduction: boolean;
};

export type CheckContext = {
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  now?: () => Date;
  /** Forces a fresh lookup, bypassing the cache read. */
  force?: boolean;
  cache?: AvailabilityCache;
};

export interface AvailabilityProvider {
  readonly id: string;
  readonly name: string;
  readonly kind: ProviderKind;
  capabilities(): ProviderCapabilities;
  supports(tld: string): boolean;
  check(domain: string, context?: CheckContext): Promise<AvailabilityResult>;
}

export interface AvailabilityCache {
  get(domain: string): Promise<CachedCheck | null> | CachedCheck | null;
  set(domain: string, value: CachedCheck): Promise<void> | void;
}

export type CachedCheck = {
  domain: string;
  status: AvailabilityStatus;
  providerId: string;
  providerKind: ProviderKind;
  checkedAt: string;
  expiresAt: string;
  confirmed: boolean;
  guidance: string;
};

const STATUS_GUIDANCE: Record<AvailabilityStatus, string> = {
  available_verified:
    "The registry returned no registration record for this name at the time of checking. Registration is not guaranteed — confirm with a registrar before paying.",
  registered: "A registration record exists. This name is taken.",
  unavailable: "The provider reports this name cannot be registered.",
  premium_or_special_pricing:
    "The registry marks this name as reserved or premium-priced. Standard pricing does not apply.",
  unknown:
    "The provider gave no usable answer. This is not evidence that the name is free.",
  check_failed: "The lookup failed (network, provider error or timeout). Try again later.",
  rate_limited: "The provider asked us to slow down. Retry after the indicated period.",
  unsupported_tld: "No availability provider is configured for this extension.",
};

export function guidanceFor(status: AvailabilityStatus): string {
  return STATUS_GUIDANCE[status];
}

export function isVerifiedStatus(status: AvailabilityStatus): boolean {
  return status === "available_verified" || status === "registered" || status === "premium_or_special_pricing";
}

/** Statuses that must never be rendered with a positive/available style. */
export function isIndeterminate(status: AvailabilityStatus): boolean {
  return status === "unknown" || status === "check_failed" || status === "rate_limited" || status === "unsupported_tld";
}
