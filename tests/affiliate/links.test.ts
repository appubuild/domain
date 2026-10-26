import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EMPTY_AFFILIATE_CONFIG,
  buildAffiliateUrl,
  isValidDomain,
  parseProviderRow,
  registrarLinks,
  selectProvider,
  type AffiliateConfig,
  type AffiliateProvider,
} from "@/lib/affiliate/links";

/**
 * Affiliate link building.
 *
 * These tests are mostly security tests. A URL template is administrator-editable data that
 * becomes an `href`, so the interesting cases are the ones that must be *refused*.
 */

function provider(overrides: Partial<AffiliateProvider> = {}): AffiliateProvider {
  return {
    id: "registrar-a",
    name: "Registrar A",
    slug: "registrar-a",
    enabled: true,
    priority: 10,
    urlTemplate: "https://registrar-a.example/domains/{domain}?ref=domainfits",
    allowedHosts: ["registrar-a.example"],
    supportedTlds: ["com", "net"],
    disclosure: "Affiliate link — we may earn a commission.",
    isFallback: false,
    ...overrides,
  };
}

function config(overrides: Partial<AffiliateConfig> = {}): AffiliateConfig {
  return { enabled: true, providers: [provider()], rules: [], ...overrides };
}

describe("domain validation", () => {
  it("accepts ordinary names and rejects hostile input", () => {
    for (const good of ["paynest.com", "a-b.co", "ledger.ly", "xn--bcher-kva.de"]) {
      expect(isValidDomain(good), good).toBe(true);
    }
    for (const bad of [
      "",
      "paynest",
      ".com",
      "pay nest.com",
      "paynest..com",
      "-paynest.com",
      "paynest-.com",
      "paynest.com/path",
      "paynest.com?x=1",
      "javascript:alert(1)",
      "paynest.c",
      `${"a".repeat(64)}.com`,
    ]) {
      expect(isValidDomain(bad), bad).toBe(false);
    }
  });
});

describe("buildAffiliateUrl", () => {
  it("substitutes the domain and returns an allowlisted https URL", () => {
    const built = buildAffiliateUrl(provider(), "PayNest.com");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.url).toBe("https://registrar-a.example/domains/paynest.com?ref=domainfits");
    expect(built.host).toBe("registrar-a.example");
    expect(built.disclosesAffiliate).toBe(true);
  });

  it("refuses http templates", () => {
    const built = buildAffiliateUrl(provider({ urlTemplate: "http://registrar-a.example/{domain}" }), "paynest.com");
    expect(built).toEqual({ ok: false, reason: "template-not-https" });
  });

  it("refuses templates without the domain token", () => {
    const built = buildAffiliateUrl(provider({ urlTemplate: "https://registrar-a.example/search" }), "paynest.com");
    expect(built).toEqual({ ok: false, reason: "template-missing-domain-token" });
  });

  it("refuses a destination host outside the allowlist", () => {
    const built = buildAffiliateUrl(
      provider({ urlTemplate: "https://evil.example/{domain}", allowedHosts: ["registrar-a.example"] }),
      "paynest.com",
    );
    expect(built).toEqual({ ok: false, reason: "host-not-allowed" });
  });

  it("is not fooled by look-alike or suffixed hosts", () => {
    const cases = [
      "https://registrar-a.example.evil.com/{domain}",
      "https://evilregistrar-a.example/{domain}",
      // userinfo trick: host is evil.com, not registrar-a.example
      "https://registrar-a.example@evil.com/{domain}",
    ];
    for (const template of cases) {
      const built = buildAffiliateUrl(provider({ urlTemplate: template }), "paynest.com");
      expect(built.ok, template).toBe(false);
    }
  });

  it("refuses credentials and explicit ports", () => {
    expect(buildAffiliateUrl(provider({ urlTemplate: "https://user:pw@registrar-a.example/{domain}" }), "paynest.com")).toEqual({
      ok: false,
      reason: "malformed-url",
    });
    expect(buildAffiliateUrl(provider({ urlTemplate: "https://registrar-a.example:8443/{domain}" }), "paynest.com")).toEqual({
      ok: false,
      reason: "malformed-url",
    });
  });

  it("refuses invalid domains and disabled providers", () => {
    expect(buildAffiliateUrl(provider(), "not a domain")).toEqual({ ok: false, reason: "invalid-domain" });
    expect(buildAffiliateUrl(provider({ enabled: false }), "paynest.com")).toEqual({
      ok: false,
      reason: "provider-disabled",
    });
  });

  it("refuses a provider with no allowlist at all", () => {
    expect(buildAffiliateUrl(provider({ allowedHosts: [] }), "paynest.com")).toEqual({
      ok: false,
      reason: "no-allowed-hosts",
    });
  });

  it("url-encodes the substituted domain", () => {
    const built = buildAffiliateUrl(provider(), "xn--bcher-kva.de");
    expect(built.ok).toBe(true);
    if (built.ok) expect(built.url).toContain("xn--bcher-kva.de");
  });
});

describe("selectProvider", () => {
  it("returns nothing when routing is switched off", () => {
    expect(selectProvider(config({ enabled: false }), "com")).toBeNull();
  });

  it("prefers an explicit TLD rule", () => {
    const second = provider({ id: "registrar-b", name: "Registrar B", priority: 99, supportedTlds: ["com"] });
    const selected = selectProvider(
      config({ providers: [provider(), second], rules: [{ tld: "com", providerId: "registrar-b", enabled: true }] }),
      "com",
    );
    expect(selected?.id).toBe("registrar-b");
  });

  it("falls back to supported TLDs, ordered by priority then name", () => {
    const cheap = provider({ id: "b", name: "Beta", priority: 50 });
    const dearest = provider({ id: "a", name: "Alpha", priority: 10 });
    const selected = selectProvider(config({ providers: [cheap, dearest] }), "com");
    expect(selected?.id).toBe("a");
  });

  it("uses the fallback provider only when nothing claims the TLD", () => {
    const fallback = provider({ id: "fallback", name: "Fallback", supportedTlds: [], isFallback: true });
    const selected = selectProvider(config({ providers: [provider(), fallback] }), "dev");
    expect(selected?.id).toBe("fallback");
  });

  it("returns nothing when the TLD is unclaimed and no fallback exists", () => {
    expect(selectProvider(config(), "dev")).toBeNull();
  });

  it("ignores disabled providers and disabled rules", () => {
    const disabled = provider({ enabled: false });
    expect(selectProvider(config({ providers: [disabled] }), "com")).toBeNull();

    const ruled = selectProvider(
      config({ providers: [provider()], rules: [{ tld: "com", providerId: "registrar-a", enabled: false }] }),
      "com",
    );
    // The rule is ignored, but the provider still claims .com through supported_tlds.
    expect(ruled?.id).toBe("registrar-a");
  });
});

describe("registrarLinks", () => {
  it("builds one link per routable domain and skips the rest", () => {
    const links = registrarLinks(config(), [
      { domain: "paynest.com" },
      { domain: "paynest.dev" },
      { domain: "paynest.com" }, // duplicate
    ]);

    expect(links).toHaveLength(1);
    expect(links[0]?.domain).toBe("paynest.com");
    expect(links[0]?.tld).toBe("com");
    expect(links[0]?.url).toContain("registrar-a.example");
  });

  it("returns nothing at all when no provider is configured", () => {
    expect(registrarLinks(EMPTY_AFFILIATE_CONFIG, [{ domain: "paynest.com" }])).toEqual([]);
  });

  it("drops a domain whose provider is misconfigured instead of emitting a bad link", () => {
    const broken = provider({ urlTemplate: "https://evil.example/{domain}", allowedHosts: ["registrar-a.example"] });
    expect(registrarLinks(config({ providers: [broken] }), [{ domain: "paynest.com" }])).toEqual([]);
  });
});

describe("parseProviderRow", () => {
  it("maps a REST row and tolerates missing optional columns", () => {
    const parsed = parseProviderRow({
      id: "p1",
      name: "Provider",
      slug: "provider",
      url_template: "https://r.example/{domain}",
      allowed_hosts: ["r.example"],
      supported_tlds: ["com"],
      enabled: true,
      priority: 5,
      disclosure: "We may earn a commission.",
      is_fallback: false,
    });

    expect(parsed).toMatchObject({
      id: "p1",
      enabled: true,
      priority: 5,
      allowedHosts: ["r.example"],
      supportedTlds: ["com"],
    });
  });

  it("drops rows without the fields a link needs", () => {
    expect(parseProviderRow({ id: "p1", name: "No template" })).toBeNull();
    expect(parseProviderRow({ name: "x", slug: "x", url_template: "https://r.example/{domain}" })).toBeNull();
  });
});

describe("click recording", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    vi.resetModules();
  });

  it("reports not-configured rather than claiming a click was tracked", async () => {
    const { recordAffiliateClick } = await import("@/lib/affiliate/client");
    const outcome = await recordAffiliateClick({ domain: "paynest.com", tld: "com", providerId: "p1" });
    expect(outcome).toEqual({ recorded: false, reason: "not-configured" });
  });

  it("records through an injected sink and reports failures honestly", async () => {
    const { recordAffiliateClick } = await import("@/lib/affiliate/client");

    let captured: Record<string, unknown> | null = null;
    const ok = await recordAffiliateClick({
      domain: "paynest.com",
      tld: "com",
      providerId: "p1",
      sourcePath: "/generator/",
      sink: async (row) => {
        captured = row as unknown as Record<string, unknown>;
        return { error: null };
      },
    });
    expect(ok).toEqual({ recorded: true });
    const row = captured as unknown as { provider_id: string; domain: string; source_path: string };
    expect(row.provider_id).toBe("p1");
    expect(row.domain).toBe("paynest.com");
    expect(row.source_path).toBe("/generator/");

    const failed = await recordAffiliateClick({
      domain: "paynest.com",
      tld: "com",
      providerId: "p1",
      sink: async () => ({ error: { message: "rls denied" } }),
    });
    expect(failed).toEqual({ recorded: false, reason: "error", error: "rls denied" });
  });

  it("truncates oversized values before they reach the database", async () => {
    const { recordAffiliateClick } = await import("@/lib/affiliate/client");
    let captured: Record<string, unknown> | null = null;

    await recordAffiliateClick({
      domain: `${"a".repeat(400)}.com`,
      tld: "c".repeat(50),
      providerId: "p1",
      sourcePath: `/generator/?${"q".repeat(500)}`,
      sink: async (row) => {
        captured = row as unknown as Record<string, unknown>;
        return { error: null };
      },
    });

    const row = captured as unknown as { domain: string; tld: string; source_path: string };
    expect(row.domain.length).toBeLessThanOrEqual(253);
    expect(row.tld.length).toBeLessThanOrEqual(18);
    expect(row.source_path.length).toBeLessThanOrEqual(300);
  });
});
