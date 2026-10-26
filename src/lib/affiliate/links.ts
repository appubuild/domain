/**
 * Affiliate routing — link construction and validation.
 *
 * Threat model: a URL template is administrator-editable data, and it ends up in an `href`
 * the user clicks. So every link is rebuilt and re-validated here rather than trusted:
 *
 *   1. the template must be `https://` and contain the `{domain}` placeholder (also enforced
 *      by a database CHECK constraint — this is defence in depth, not duplication);
 *   2. `{domain}` is substituted with a *validated* domain label, never raw user text;
 *   3. the resulting URL's host must match `allowed_hosts` exactly (or a subdomain of it),
 *      so a template cannot quietly point at a look-alike domain;
 *   4. credentials, ports and unusual schemes are rejected outright.
 *
 * Nothing in this module decides *whether a name is available*. Availability comes from the
 * registry; commercial routing is applied only to the click, and only for extensions an
 * administrator has mapped to a provider.
 */

export type AffiliateProvider = {
  id: string;
  name: string;
  slug: string;
  enabled: boolean;
  priority: number;
  urlTemplate: string;
  allowedHosts: string[];
  supportedTlds: string[];
  disclosure: string;
  isFallback: boolean;
};

export type AffiliateRule = {
  tld: string;
  providerId: string;
  enabled: boolean;
};

export type AffiliateConfig = {
  providers: AffiliateProvider[];
  rules: AffiliateRule[];
  /** Global switch (`feature_flags.affiliate_routing`). */
  enabled: boolean;
};

export const EMPTY_AFFILIATE_CONFIG: AffiliateConfig = { providers: [], rules: [], enabled: false };

/** RFC-952-ish single label, lower-case. Deliberately strict: this is user-facing input. */
const LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const DOMAIN_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,18}$/;

export function isValidDomain(domain: string): boolean {
  const normalized = domain.trim().toLowerCase();
  if (normalized.length < 3 || normalized.length > 253) return false;
  if (!DOMAIN_PATTERN.test(normalized)) return false;
  const labels = normalized.split(".");
  return labels.every((label) => LABEL_PATTERN.test(label));
}

function hostMatches(host: string, allowed: string[]): boolean {
  const normalizedHost = host.toLowerCase().replace(/\.$/, "");
  return allowed.some((entry) => {
    const candidate = entry.trim().toLowerCase().replace(/\.$/, "");
    if (!candidate) return false;
    return normalizedHost === candidate || normalizedHost.endsWith(`.${candidate}`);
  });
}

export type LinkRejection =
  | "provider-disabled"
  | "template-not-https"
  | "template-missing-domain-token"
  | "invalid-domain"
  | "no-allowed-hosts"
  | "host-not-allowed"
  | "malformed-url";

export type AffiliateLinkResult =
  | { ok: true; url: string; host: string; providerId: string; providerName: string; disclosesAffiliate: true }
  | { ok: false; reason: LinkRejection };

/**
 * Builds the outbound registrar URL for one domain.
 *
 * Returns a rejection reason rather than throwing or guessing: the UI shows no link at all
 * when a provider is misconfigured, and the reason is logged usefully in development.
 */
export function buildAffiliateUrl(provider: AffiliateProvider, domain: string): AffiliateLinkResult {
  if (!provider.enabled) return { ok: false, reason: "provider-disabled" };
  if (!provider.urlTemplate.startsWith("https://")) return { ok: false, reason: "template-not-https" };
  if (!provider.urlTemplate.includes("{domain}")) return { ok: false, reason: "template-missing-domain-token" };
  if (!isValidDomain(domain)) return { ok: false, reason: "invalid-domain" };
  if (provider.allowedHosts.length === 0) return { ok: false, reason: "no-allowed-hosts" };

  const target = domain.trim().toLowerCase();
  const substituted = provider.urlTemplate.split("{domain}").join(encodeURIComponent(target));

  let url: URL;
  try {
    url = new URL(substituted);
  } catch {
    return { ok: false, reason: "malformed-url" };
  }

  if (url.protocol !== "https:") return { ok: false, reason: "template-not-https" };
  // Credentials or an explicit port in a click-through URL are a red flag, not a feature.
  if (url.username || url.password || url.port) return { ok: false, reason: "malformed-url" };
  if (!hostMatches(url.hostname, provider.allowedHosts)) return { ok: false, reason: "host-not-allowed" };

  return {
    ok: true,
    url: url.toString(),
    host: url.hostname.toLowerCase(),
    providerId: provider.id,
    providerName: provider.name,
    disclosesAffiliate: true,
  };
}

/**
 * Chooses the provider for a TLD.
 *
 * Order of precedence: an explicit enabled `affiliate_tld_rules` row, then a provider that
 * lists the TLD in `supported_tlds`, then the single enabled fallback provider if one exists.
 * Ties are broken by `priority` (lower wins) and then by name, so routing is deterministic
 * and reproducible — never random.
 */
export function selectProvider(
  config: AffiliateConfig,
  tld: string,
): AffiliateProvider | null {
  if (!config.enabled) return null;
  const normalized = tld.trim().toLowerCase().replace(/^\./, "");
  if (!normalized) return null;

  const byId = new Map(config.providers.filter((provider) => provider.enabled).map((provider) => [provider.id, provider]));
  if (byId.size === 0) return null;

  const rank = (provider: AffiliateProvider) => [provider.priority, provider.name.toLowerCase()] as const;
  const sortProviders = (list: AffiliateProvider[]) =>
    [...list].sort((left, right) => {
      const [leftPriority, leftName] = rank(left);
      const [rightPriority, rightName] = rank(right);
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;
      return leftName.localeCompare(rightName);
    });

  const ruled = config.rules
    .filter((rule) => rule.enabled && rule.tld.trim().toLowerCase().replace(/^\./, "") === normalized)
    .map((rule) => byId.get(rule.providerId))
    .filter((provider): provider is AffiliateProvider => Boolean(provider));
  if (ruled.length > 0) return sortProviders(ruled)[0] ?? null;

  const supporting = [...byId.values()].filter((provider) =>
    provider.supportedTlds.map((entry) => entry.trim().toLowerCase().replace(/^\./, "")).includes(normalized),
  );
  if (supporting.length > 0) return sortProviders(supporting)[0] ?? null;

  const fallbacks = [...byId.values()].filter((provider) => provider.isFallback);
  return fallbacks.length === 0 ? null : (sortProviders(fallbacks)[0] ?? null);
}

export type RegistrarLink = {
  domain: string;
  tld: string;
  url: string;
  host: string;
  providerId: string;
  providerName: string;
  disclosure: string;
};

/**
 * Builds one link per domain for the given candidates' domains.
 *
 * Returns an empty list when nothing is configured — which is the default state and the
 * reason no registrar links appear on a fresh install.
 */
export function registrarLinks(
  config: AffiliateConfig,
  domains: Array<{ domain: string }>,
): RegistrarLink[] {
  const links: RegistrarLink[] = [];
  const seen = new Set<string>();

  for (const entry of domains) {
    const domain = entry.domain.trim().toLowerCase();
    if (seen.has(domain)) continue;
    seen.add(domain);

    const tld = domain.split(".").pop() ?? "";
    const provider = selectProvider(config, tld);
    if (!provider) continue;

    const built = buildAffiliateUrl(provider, domain);
    if (!built.ok) continue;

    links.push({
      domain,
      tld,
      url: built.url,
      host: built.host,
      providerId: built.providerId,
      providerName: built.providerName,
      disclosure: provider.disclosure || "Affiliate link — we may earn a commission.",
    });
  }

  return links;
}

/** Parses a REST row into the internal shape, dropping anything malformed. */
export function parseProviderRow(row: Record<string, unknown>): AffiliateProvider | null {
  const id = typeof row.id === "string" ? row.id : null;
  const name = typeof row.name === "string" ? row.name : null;
  const slug = typeof row.slug === "string" ? row.slug : null;
  const urlTemplate = typeof row.url_template === "string" ? row.url_template : null;
  if (!id || !name || !slug || !urlTemplate) return null;

  const toStringArray = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

  return {
    id,
    name,
    slug,
    enabled: row.enabled === true,
    priority: typeof row.priority === "number" ? row.priority : 100,
    urlTemplate,
    allowedHosts: toStringArray(row.allowed_hosts),
    supportedTlds: toStringArray(row.supported_tlds),
    disclosure: typeof row.disclosure === "string" ? row.disclosure : "",
    isFallback: row.is_fallback === true,
  };
}
