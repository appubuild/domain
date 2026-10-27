import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Build-time content pipeline.
 *
 * These tests protect the contract that matters for a static host: whatever the CMS holds,
 * the build must produce complete, non-colliding, indexable pages — and must say so
 * honestly when it fell back to the offline pack.
 */

const ORIGINAL_ENV = { ...process.env };

function clearPublicEnv() {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.NEXT_PUBLIC_APP_URL;
  delete process.env.NEXT_PUBLIC_SITE_NAME;
}

beforeEach(() => {
  clearPublicEnv();
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("offline content pack", () => {
  it("loads every default page without any network access", async () => {
    const { loadSiteContent } = await import("@/lib/content/source");
    const content = await loadSiteContent();

    expect(content.source).toBe("defaults");
    expect(content.warning).toBeNull();
    expect(content.pages.length).toBeGreaterThanOrEqual(8);
    expect(content.posts.length).toBeGreaterThanOrEqual(1);
    expect(content.industries.length).toBeGreaterThanOrEqual(10);
    expect(content.tlds.length).toBeGreaterThanOrEqual(8);
  });

  it("gives every page a slug that is safe to expose at /{slug}", async () => {
    const { loadSiteContent } = await import("@/lib/content/source");
    const { RESERVED_ROUTES } = await import("@/lib/content/seo");
    const content = await loadSiteContent();

    const seen = new Set<string>();
    for (const page of content.pages) {
      expect(page.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(seen.has(page.slug)).toBe(false);
      // A CMS page must never shadow a real application route.
      expect(RESERVED_ROUTES.has(page.slug)).toBe(false);
      expect(page.title.length).toBeGreaterThan(2);
      seen.add(page.slug);
    }
  });

  it("keeps industry and TLD identifiers unique", async () => {
    const { loadSiteContent } = await import("@/lib/content/source");
    const content = await loadSiteContent();

    const ids = new Set(content.industries.map((industry) => industry.id));
    expect(ids.size).toBe(content.industries.length);

    const slugs = new Set(content.industries.map((industry) => industry.slug));
    expect(slugs.size).toBe(content.industries.length);

    const tlds = new Set(content.tlds.map((entry) => entry.tld));
    expect(tlds.size).toBe(content.tlds.length);
    for (const entry of content.tlds) {
      expect(entry.tld).toMatch(/^[a-z]{2,18}$/);
    }
  });

  it("never publishes a post without a slug, title and ISO date", async () => {
    const { loadSiteContent } = await import("@/lib/content/source");
    const content = await loadSiteContent();

    for (const post of content.posts) {
      expect(post.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(post.title.length).toBeGreaterThan(2);
      expect(Number.isNaN(Date.parse(post.publishedAt))).toBe(false);
      expect(post.readingMinutes).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("supabase read path", () => {
  it("falls back to defaults and reports the reason when the CMS is unreachable", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key-for-test";
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const { loadSiteContent } = await import("@/lib/content/source");
    const content = await loadSiteContent();

    expect(content.source).toBe("defaults");
    expect(content.warning).toBeTruthy();
    expect(content.warning).toContain("offline");
  });

  it("uses CMS rows when they are returned", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key-for-test";
    vi.resetModules();

    const payloads: Record<string, unknown[]> = {
      pages: [
        {
          slug: "from-cms",
          title: "Served from the CMS",
          excerpt: "A page that only exists in the database.",
          body: "<p>Hello.</p>",
          seo_title: null,
          meta_description: null,
          canonical_url: null,
          noindex: false,
          published_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-02T00:00:00.000Z",
        },
      ],
      posts: [],
      industries: [],
      tlds: [],
      site_settings: [],
      nav_menus: [{ id: "primary", name: "Primary navigation", location: "primary", position: 10, enabled: true }],
      nav_items: [
        { menu_id: "primary", label: "Generator", href: "/generator", description: "", position: 10, enabled: true, parent_id: null },
      ],
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        const table = Object.keys(payloads).find((key) => url.includes(`/rest/v1/${key}`));
        return {
          ok: true,
          status: 200,
          json: async () => (table ? payloads[table] : []),
        } as unknown as Response;
      }),
    );

    const { loadSiteContent } = await import("@/lib/content/source");
    const content = await loadSiteContent();

    expect(content.source).toBe("supabase");
    expect(content.warning).toBeNull();
    expect(content.pages.map((page) => page.slug)).toEqual(["from-cms"]);
    // Navigation comes from the database too, not from the code constants.
    expect(content.navigation.primary.map((item) => item.label)).toEqual(["Generator"]);
  });

  it("warns when the database has content but no navigation rows", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key-for-test";
    vi.resetModules();

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        const body = url.includes("/rest/v1/pages")
          ? [
              {
                slug: "only-a-page",
                title: "Only a page",
                excerpt: "",
                body: "<p>Text.</p>",
                seo_title: null,
                meta_description: null,
                canonical_url: null,
                noindex: false,
                published_at: "2026-01-01T00:00:00.000Z",
                updated_at: "2026-01-02T00:00:00.000Z",
              },
            ]
          : [];
        return { ok: true, status: 200, json: async () => body } as unknown as Response;
      }),
    );

    const { loadSiteContent } = await import("@/lib/content/source");
    const content = await loadSiteContent();

    expect(content.source).toBe("supabase");
    // The menu still renders (code defaults) but the build is told why.
    expect(content.navigation.primary.length).toBeGreaterThan(0);
    expect(content.warning).toContain("Navigation fell back");
  });
});

describe("sitemap", () => {
  it("lists only unique, indexable public paths", async () => {
    const { loadSiteContent } = await import("@/lib/content/source");
    const { sitemapEntries } = await import("@/lib/content/seo");
    const content = await loadSiteContent();
    const entries = sitemapEntries(content);

    const paths = entries.map((entry) => entry.path);
    expect(new Set(paths).size).toBe(paths.length);

    for (const entry of entries) {
      expect(entry.path.startsWith("/")).toBe(true);
      expect(entry.path).not.toContain("//");
      expect(entry.path.startsWith("/admin")).toBe(false);
      expect(entry.path.startsWith("/api")).toBe(false);
      expect(entry.priority).toBeGreaterThan(0);
      expect(entry.priority).toBeLessThanOrEqual(1);
    }
  });

  it("includes every CMS page exactly once", async () => {
    const { loadSiteContent } = await import("@/lib/content/source");
    const { sitemapEntries } = await import("@/lib/content/seo");
    const content = await loadSiteContent();
    const paths = sitemapEntries(content).map((entry) => entry.path);

    for (const page of content.pages) {
      expect(paths.filter((path) => path === `/${page.slug}/`)).toHaveLength(1);
    }
  });
});

describe("metadata", () => {
  it("omits canonical and Open Graph URLs when no site URL is configured", async () => {
    const { buildMetadata } = await import("@/lib/content/seo");
    const meta = buildMetadata({ title: "Extensions", description: "All extensions", path: "/extensions/" });

    expect(meta.alternates).toBeUndefined();
    expect(meta.openGraph?.url).toBeUndefined();
    expect(String(meta.title)).toContain("Extensions");
  });

  it("emits an absolute canonical when a site URL is configured", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://domainfits.example";
    vi.resetModules();
    const { buildMetadata } = await import("@/lib/content/seo");
    const meta = buildMetadata({ title: "Extensions", description: "All extensions", path: "/extensions/" });

    expect(meta.alternates?.canonical).toBe("https://domainfits.example/extensions/");
    expect(meta.openGraph?.url).toBe("https://domainfits.example/extensions/");
  });

  it("marks noindex pages and keeps the explicit title suffix", async () => {
    const { buildMetadata } = await import("@/lib/content/seo");
    const meta = buildMetadata({ title: "Draft page", description: "x", path: "/draft/", noindex: true, titleSuffix: "" });

    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.title).toBe("Draft page");
  });
});

describe("structured data", () => {
  it("escapes the payload so JSON-LD cannot break out of its script tag", async () => {
    vi.resetModules();
    const { serializeJsonLd } = await import("@/lib/content/json-ld");
    const json = serializeJsonLd({
      name: "DomainFits",
      nested: { evil: "</script><img src=x onerror=alert(1)>" },
    });

    expect(json).not.toContain("</script>");
    expect(json).toContain("\\u003c/script");
    // The escaped payload must still be valid JSON.
    expect(JSON.parse(json).nested.evil).toBe("</script><img src=x onerror=alert(1)>");
  });

  it("only produces FAQ markup for questions that are actually rendered", async () => {
    const { faqJsonLd } = await import("@/lib/content/seo");
    expect(faqJsonLd([])).toBeNull();
    const markup = faqJsonLd([{ question: "Is it free?", answer: "Yes." }]);
    expect(markup).not.toBeNull();
    expect(JSON.stringify(markup)).toContain("Is it free?");
  });
});

describe("HTML sanitiser", () => {
  it("removes scripts, event handlers and javascript: URLs", async () => {
    const { sanitizeHtml } = await import("@/lib/content/sanitize");
    const dirty = [
      '<p onclick="steal()">Hello <strong>world</strong></p>',
      "<script>fetch('https://evil.example')</script>",
      '<a href="javascript:alert(1)">click</a>',
      '<img src="x" onerror="alert(1)">',
      "<iframe src=\"https://evil.example\"></iframe>",
    ].join("");

    const clean = sanitizeHtml(dirty);
    expect(clean).not.toMatch(/<script/i);
    expect(clean).not.toMatch(/onerror/i);
    expect(clean).not.toMatch(/onclick/i);
    expect(clean).not.toMatch(/javascript:/i);
    expect(clean).not.toMatch(/<iframe/i);
    expect(clean).toContain("<strong>world</strong>");
  });

  it("keeps safe links and forces rel on external ones", async () => {
    const { sanitizeHtml } = await import("@/lib/content/sanitize");
    const clean = sanitizeHtml('<a href="https://example.com" target="_blank">safe</a>');
    expect(clean).toContain('href="https://example.com');
    expect(clean).toContain("noopener");
  });

  it("rejects unsafe URL schemes and accepts relative ones", async () => {
    const { sanitizeUrl } = await import("@/lib/content/sanitize");
    expect(sanitizeUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizeUrl("data:text/html;base64,PHNjcmlwdD4=")).toBeNull();
    expect(sanitizeUrl("//evil.example/path")).toBeNull();
    expect(sanitizeUrl("/privacy/")).toBe("/privacy/");
    expect(sanitizeUrl("https://example.com/a")).toBe("https://example.com/a");
  });

  it("estimates reading time from text, not markup", async () => {
    const { readingMinutes, toPlainText } = await import("@/lib/content/sanitize");
    const words = Array.from({ length: 440 }, () => "word").join(" ");
    expect(readingMinutes(`<p>${words}</p>`)).toBe(2);
    expect(toPlainText("<p>Hello <em>there</em></p>")).toBe("Hello there");
  });
});
