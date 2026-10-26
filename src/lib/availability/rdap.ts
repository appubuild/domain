/**
 * RDAP provider adapter.
 *
 * RDAP (RFC 9082/9083) is the free, documented, machine-readable successor to WHOIS and
 * the only method this project uses for registry lookups. There is no scraping, no CAPTCHA
 * bypassing and no attempt to circumvent provider restrictions.
 *
 * HTTP status mapping (documented, deliberate):
 *   200                 → registered (or premium/reserved when the record says so)
 *   404 with a bootstrap/registry that is authoritative → available_verified
 *   404 from a non-authoritative proxy → unknown (we will not call it available)
 *   429                 → rate_limited
 *   5xx / timeout / DNS → check_failed
 *   anything else       → unknown
 */

import { normalizeTld } from "@/lib/brain/normalize";
import {
  guidanceFor,
  type AvailabilityProvider,
  type AvailabilityResult,
  type AvailabilityStatus,
  type CheckContext,
  type ProviderCapabilities,
  type ProviderConfig,
} from "./types";

const MAX_EXCERPT = 240;

export function buildRdapUrl(config: ProviderConfig, domain: string): string | null {
  if (!config.endpointTemplate) return null;
  const tld = domain.split(".").pop() ?? "";
  if (!config.endpointTemplate.includes("{domain}")) return null;
  const url = config.endpointTemplate
    .replace(/\{domain\}/g, encodeURIComponent(domain))
    .replace(/\{tld\}/g, encodeURIComponent(tld));
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function excerpt(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed.length > MAX_EXCERPT ? `${trimmed.slice(0, MAX_EXCERPT)}…` : trimmed;
}

/** Looks for registry flags that indicate premium or reserved status inside an RDAP record. */
export function detectPremium(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const record = body as Record<string, unknown>;
  const statuses = Array.isArray(record.status) ? (record.status as string[]) : [];
  if (statuses.some((status) => /reserved|premium|blocked/i.test(status))) return true;
  const remarks = Array.isArray(record.remarks) ? record.remarks : [];
  for (const remark of remarks) {
    const description = (remark as { description?: unknown })?.description;
    if (Array.isArray(description) && description.some((line) => /premium|reserved/i.test(String(line)))) {
      return true;
    }
  }
  return false;
}

export function createRdapProvider(config: ProviderConfig): AvailabilityProvider {
  const capabilities: ProviderCapabilities = {
    tlds: config.tlds,
    treatsNotFoundAsUnregistered: true,
    detectsPremium: true,
    // rdap.org is a bootstrap redirector: it forwards to the authoritative registry and
    // surfaces that registry's answer. We still record which service answered.
    authoritative: config.id === "rdap-verisign",
  };

  return {
    id: config.id,
    name: config.name,
    kind: "rdap",
    capabilities: () => capabilities,
    supports: (tld: string) => {
      const normalized = normalizeTld(tld);
      if (!normalized) return false;
      return config.tlds.length === 0 || config.tlds.includes(normalized);
    },
    async check(domain: string, context: CheckContext = {}): Promise<AvailabilityResult> {
      const now = context.now ?? (() => new Date());
      const fetchImpl = context.fetchImpl ?? globalThis.fetch;
      const startedAt = Date.now();
      const tld = normalizeTld(domain.split(".").pop() ?? "") ?? "";
      const base: Omit<AvailabilityResult, "status"> = {
        domain,
        tld,
        providerId: config.id,
        providerKind: "rdap",
        checkedAt: now().toISOString(),
        cached: false,
        confirmed: false,
        guidance: "",
      };

      const url = buildRdapUrl(config, domain);
      if (!url) {
        return {
          ...base,
          status: "unsupported_tld",
          errorCode: "invalid_endpoint",
          guidance: "The configured RDAP endpoint is not a valid HTTPS URL containing {domain}.",
        };
      }

      if (typeof fetchImpl !== "function") {
        return {
          ...base,
          status: "check_failed",
          errorCode: "no_fetch",
          guidance: guidanceFor("check_failed"),
        };
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
      const onExternalAbort = () => controller.abort();
      context.signal?.addEventListener("abort", onExternalAbort);

      try {
        const response = await fetchImpl(url, {
          method: "GET",
          headers: { Accept: "application/rdap+json, application/json" },
          signal: controller.signal,
          // RDAP is a public, unauthenticated endpoint; do not send credentials.
          credentials: "omit",
          redirect: "follow",
        });
        const latencyMs = Date.now() - startedAt;

        const finish = (
          status: AvailabilityStatus,
          extra: Partial<AvailabilityResult> = {},
        ): AvailabilityResult => ({
          ...base,
          status,
          httpStatus: response.status,
          latencyMs,
          guidance: guidanceFor(status),
          ...extra,
        });

        if (response.status === 200) {
          let body: unknown = null;
          try {
            body = await response.json();
          } catch {
            body = null;
          }
          const premium = detectPremium(body);
          return finish(premium ? "premium_or_special_pricing" : "registered", {
            confirmed: true,
            detail: premium ? "Registry record includes a reserved/premium status." : undefined,
          });
        }

        if (response.status === 404) {
          // Only an authoritative source may convert "no record" into "available".
          if (capabilities.treatsNotFoundAsUnregistered) {
            return finish("available_verified", {
              confirmed: true,
              detail: "No registration object returned by the RDAP service.",
            });
          }
          return finish("unknown", { detail: "404 from a non-authoritative provider is inconclusive." });
        }

        if (response.status === 429) {
          const retryAfter = response.headers.get("retry-after");
          return finish("rate_limited", {
            detail: retryAfter ? `Provider asked to retry after ${retryAfter}s.` : undefined,
          });
        }

        if (response.status === 400 || response.status === 422) {
          const text = await safeText(response);
          return finish("unsupported_tld", { detail: excerpt(text) });
        }

        if (response.status >= 500) {
          return finish("check_failed", { detail: `Provider returned ${response.status}.` });
        }

        return finish("unknown", { detail: `Unexpected HTTP ${response.status}.` });
      } catch (error) {
        const latencyMs = Date.now() - startedAt;
        const aborted = (error as Error)?.name === "AbortError";
        return {
          ...base,
          status: aborted ? "check_failed" : "check_failed",
          latencyMs,
          errorCode: aborted ? "timeout" : "network_error",
          guidance: aborted
            ? `No answer within ${config.timeoutMs} ms. The name's status is unknown.`
            : guidanceFor("check_failed"),
          detail: excerpt((error as Error)?.message ?? "Network error"),
        };
      } finally {
        clearTimeout(timeout);
        context.signal?.removeEventListener("abort", onExternalAbort);
      }
    },
  };
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
