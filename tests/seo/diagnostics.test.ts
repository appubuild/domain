/**
 * SEO diagnostics rules.
 *
 * The point of this suite is that each finding is traceable: it fires for a specific row
 * because of a specific condition, and it stays quiet otherwise. False positives are as
 * damaging as misses here — an admin screen that cries wolf gets ignored, and then the real
 * broken redirect ships.
 *
 * There is deliberately no assertion about a score, because there is no score.
 */

import { describe, expect, it } from "vitest";
import {
  CODE_LABEL,
  STATIC_PUBLIC_PATHS,
  codeLabel,
  findingsFor,
  internalLinks,
  runDiagnostics,
  type DiagnosticInput,
  type RedirectRecord,
  type SeoRecord,
} from "@/lib/seo/diagnostics";

const NOW = new Date("2026-06-15T12:00:00Z");

function page(overrides: Partial<SeoRecord> = {}): SeoRecord {
  return {
    id: "page-1",
    slug: "about",
    title: "About DomainFits and how the naming engine works",
    body: `<p>${"DomainFits combines a curated word library with scoring. ".repeat(12)}</p>`,
    excerpt: "A short explanation of the naming engine, its data sources and its limits, written for people evaluating the product.",
    seo_title: null,
    meta_description: null,
    canonical_url: null,
    noindex: false,
    cover_image_url: null,
    cover_image_alt: "",
    published_at: "2026-01-01T00:00:00Z",
    status: "published",
    ...overrides,
  };
}

function post(overrides: Partial<SeoRecord> = {}): SeoRecord {
  // A distinct description on purpose: the fixture pages share `page()`'s fields, and a
  // shared excerpt would (correctly) trip the duplicate-description rule in every test.
  return page({
    id: "post-1",
    slug: "choosing-an-extension",
    title: "Choosing an extension for a fintech brand",
    excerpt: "Why .com is not always the answer, and how to pick an extension that does not undercut the name.",
    ...overrides,
  });
}

function redirect(overrides: Partial<RedirectRecord> = {}): RedirectRecord {
  return {
    id: "r1",
    source_path: "/old-page/",
    target_path: "/about/",
    status_code: 301,
    enabled: true,
    ...overrides,
  };
}

function run(overrides: Partial<DiagnosticInput> = {}) {
  return runDiagnostics({
    pages: [page()],
    posts: [post()],
    redirects: [],
    industries: [],
    navPaths: ["/about/"],
    now: NOW,
    ...overrides,
  });
}

const codesFor = (record: SeoRecord, kind: "page" | "post" = "page") =>
  findingsFor(record, kind, NOW).map((finding) => finding.code);

describe("a clean record produces nothing", () => {
  it("stays silent for a well-formed published page", () => {
    expect(codesFor(page())).toEqual([]);
  });

  it("stays silent for a well-formed published post", () => {
    expect(codesFor(post(), "post")).toEqual([]);
  });

  it("reports a clean site as zero findings", () => {
    const report = run();
    expect(report.summary.total).toBe(0);
    expect(report.summary.errors).toBe(0);
    expect(report.summary.indexable).toBe(2);
  });
});

describe("titles", () => {
  it("flags a missing title as an error", () => {
    expect(codesFor(page({ title: "", seo_title: null }))).toContain("missing-title");
  });

  it("prefers the SEO title and measures that instead", () => {
    const long = "x".repeat(90);
    expect(codesFor(page({ title: long, seo_title: "A tidy SEO title for this page" }))).toEqual([]);
  });

  it("warns past 70 characters and notices a very short one", () => {
    expect(codesFor(page({ seo_title: "y".repeat(71) }))).toContain("title-too-long");
    expect(codesFor(page({ seo_title: "y".repeat(70) }))).not.toContain("title-too-long");
    expect(codesFor(page({ seo_title: "Naming" }))).toContain("title-too-short");
  });
});

describe("descriptions", () => {
  it("falls back to the excerpt before complaining", () => {
    expect(codesFor(page({ meta_description: null, excerpt: "Falls back to the excerpt." }))).not.toContain(
      "missing-description",
    );
  });

  it("warns when neither exists", () => {
    expect(codesFor(page({ meta_description: null, excerpt: "" }))).toContain("missing-description");
  });

  it("notices lengths outside the useful band", () => {
    expect(codesFor(page({ meta_description: "short" }))).toContain("description-too-short");
    expect(codesFor(page({ meta_description: "z".repeat(161) }))).toContain("description-too-long");
    expect(codesFor(page({ meta_description: "z".repeat(160) }))).not.toContain("description-too-long");
  });
});

describe("indexability", () => {
  it("treats published-without-date as an error, because nothing renders", () => {
    expect(codesFor(page({ published_at: null }))).toContain("published-without-date");
  });

  it("notices a future publish date without calling it broken", () => {
    const findings = findingsFor(page({ published_at: "2026-12-01T00:00:00Z" }), "page", NOW);
    expect(findings.find((f) => f.code === "future-publish-date")?.severity).toBe("notice");
  });

  it("flags scheduled content, because the export only changes on rebuild", () => {
    expect(codesFor(page({ status: "scheduled" }))).toContain("scheduled-content");
  });

  it("does not judge drafts at all", () => {
    const draft = page({ status: "draft", title: "", published_at: null, meta_description: null, excerpt: "" });
    expect(codesFor(draft)).toEqual([]);
  });

  it("skips content-level checks when noindex is set", () => {
    const quiet = page({ noindex: true, title: "", meta_description: null, excerpt: "" });
    expect(codesFor(quiet)).toEqual([]);
  });

  it("still reports a cover image without alt text even on noindex pages", () => {
    const hidden = page({ noindex: true, cover_image_url: "https://x.test/a.jpg", cover_image_alt: "" });
    expect(codesFor(hidden)).toContain("cover-image-without-alt");
  });
});

describe("thin content", () => {
  it("counts text, not markup", () => {
    const markupOnly = `<div class="${"x".repeat(500)}"><img src="/a.jpg"></div>`;
    expect(codesFor(page({ body: markupOnly }))).toContain("thin-content");
  });

  it("accepts a substantial body", () => {
    expect(codesFor(page({ body: "Sentence about domains. ".repeat(40) }))).not.toContain("thin-content");
  });
});

describe("images", () => {
  it("requires alt text alongside a cover image", () => {
    const withImage = page({ cover_image_url: "https://cdn.test/hero.jpg", cover_image_alt: "A hero image" });
    expect(codesFor(withImage)).not.toContain("cover-image-without-alt");
  });

  it("does not demand alt text when there is no image", () => {
    expect(codesFor(page({ cover_image_url: null, cover_image_alt: "" }))).not.toContain(
      "cover-image-without-alt",
    );
  });
});

describe("slugs and canonicals", () => {
  it("catches a page whose slug shadows a real route", () => {
    expect(codesFor(page({ slug: "generator" }))).toContain("reserved-slug");
  });

  it("does not apply the reserved-slug rule to posts", () => {
    expect(codesFor(post({ slug: "generator" }), "post")).not.toContain("reserved-slug");
  });

  it("notices a canonical pointing at the page itself", () => {
    expect(codesFor(page({ canonical_url: "/about/" }))).toContain("canonical-self");
    expect(codesFor(page({ canonical_url: "https://domainfits.com/about/" }))).toContain("canonical-self");
  });

  it("warns about a relative canonical", () => {
    expect(codesFor(page({ canonical_url: "/elsewhere/" }))).toContain("canonical-relative");
  });

  it("accepts an absolute canonical to another URL", () => {
    expect(codesFor(page({ canonical_url: "https://other.example/original" }))).toEqual([]);
  });
});

describe("duplicates", () => {
  it("flags every member of a duplicate-title group across pages and posts", () => {
    const shared = "Choosing an extension for a fintech brand";
    const report = run({
      pages: [page({ id: "p1", slug: "alpha", title: shared, seo_title: shared })],
      posts: [post({ id: "q1", slug: "beta", title: shared, seo_title: shared })],
      navPaths: ["/alpha/", "/blog/beta/"],
    });
    const duplicates = report.findings.filter((finding) => finding.code === "duplicate-title");
    expect(duplicates).toHaveLength(2);
    expect(duplicates[0]?.message).toContain("alpha");
  });

  it("ignores drafts when checking duplicates", () => {
    const report = run({
      pages: [page({ id: "p1", slug: "alpha" })],
      posts: [post({ id: "q1", slug: "beta", status: "draft" })],
    });
    expect(report.findings.filter((finding) => finding.code === "duplicate-title")).toHaveLength(0);
  });

  it("detects duplicated descriptions too", () => {
    const same = "The same description, copied between two pages without a thought for anyone reading it.";
    const report = run({
      pages: [page({ id: "p1", slug: "alpha", excerpt: same, meta_description: same })],
      posts: [post({ id: "q1", slug: "beta", excerpt: same, meta_description: same })],
      navPaths: ["/alpha/", "/blog/beta/"],
    });
    expect(report.findings.filter((finding) => finding.code === "duplicate-description")).toHaveLength(2);
  });
});

describe("redirects", () => {
  const live = new Set<string>([...STATIC_PUBLIC_PATHS, "/about/", "/blog/choosing-an-extension/"]);
  const base = { pages: [page()], posts: [post()], navPaths: ["/about/"], now: NOW };

  it("accepts a single clean redirect", () => {
    expect(run({ ...base, redirects: [redirect()] }).findings).toEqual([]);
  });

  it("catches a two-step loop", () => {
    const report = run({
      ...base,
      redirects: [
        redirect({ id: "a", source_path: "/one/", target_path: "/two/" }),
        redirect({ id: "b", source_path: "/two/", target_path: "/one/" }),
      ],
    });
    const codes = report.findings.map((finding) => finding.code);
    expect(codes).toContain("redirect-loop");
    expect(codes).not.toContain("redirect-to-missing");
  });

  it("warns about a chain and names the final destination", () => {
    const report = run({
      ...base,
      redirects: [
        redirect({ id: "a", source_path: "/one/", target_path: "/two/" }),
        redirect({ id: "b", source_path: "/two/", target_path: "/about/" }),
      ],
    });
    const chain = report.findings.find((finding) => finding.code === "redirect-chain");
    expect(chain?.message).toContain("1 extra hop");
    expect(chain?.fix).toContain("/about/");
  });

  it("treats a redirect to nowhere as an error", () => {
    const report = run({ ...base, redirects: [redirect({ target_path: "/does-not-exist/" })] });
    expect(report.findings[0]?.code).toBe("redirect-to-missing");
    expect(report.findings[0]?.severity).toBe("error");
  });

  it("accepts an external target without checking it", () => {
    expect(run({ ...base, redirects: [redirect({ target_path: "https://partner.example/x" })] }).findings).toEqual([]);
  });

  it("accepts a target that is another redirect's source", () => {
    // /one/ → /two/ → /about/ : the chain is reported, but /two/ must not also read as missing.
    const report = run({
      ...base,
      redirects: [
        redirect({ id: "a", source_path: "/one/", target_path: "/two/" }),
        redirect({ id: "b", source_path: "/two/", target_path: "/about/" }),
      ],
    });
    expect(report.findings.some((finding) => finding.code === "redirect-to-missing")).toBe(false);
  });

  it("flags a redirect whose source is a live page", () => {
    const report = run({ ...base, redirects: [redirect({ source_path: "/about/", target_path: "/blog/" })] });
    expect(report.findings.map((finding) => finding.code)).toContain("redirect-shadows-live-page");
  });

  it("ignores disabled redirects entirely", () => {
    const report = run({
      ...base,
      redirects: [redirect({ enabled: false, target_path: "/nowhere/" })],
    });
    expect(report.findings).toEqual([]);
  });

  it("mentions that a 302 keeps the old URL indexed", () => {
    const report = run({ ...base, redirects: [redirect({ status_code: 302 })] });
    expect(report.findings[0]?.code).toBe("redirect-temporary");
    expect(report.findings[0]?.severity).toBe("notice");
  });
});

describe("internal links", () => {
  it("extracts only internal hrefs", () => {
    const html = `
      <a href="/about/">ok</a>
      <a href="https://external.example/">external</a>
      <a href="#section">anchor</a>
      <a href="//cdn.example/x">protocol-relative</a>
      <a href="/missing/">bad</a>
    `;
    expect(internalLinks(html)).toEqual(["/about/", "/missing/"]);
  });

  it("reports a link to a page that does not exist", () => {
    const report = run({ pages: [page({ body: `<p>${"text ".repeat(60)}</p><a href="/ghost/">x</a>` })] });
    const broken = report.findings.find((finding) => finding.code === "broken-internal-link");
    expect(broken?.message).toContain("/ghost/");
    expect(broken?.editHref).toBeNull();
  });

  it("does not report a link to a redirect source, since visitors resolve it", () => {
    const report = run({
      pages: [page({ body: `<p>${"text ".repeat(60)}</p><a href="/old-page/">x</a>` })],
      redirects: [redirect()],
    });
    expect(report.findings.some((finding) => finding.code === "broken-internal-link")).toBe(false);
  });

  it("accepts links to posts and industries", () => {
    const report = run({
      pages: [
        page({
          body: `<p>${"text ".repeat(60)}</p><a href="/blog/choosing-an-extension/">p</a><a href="/industries/fintech/">i</a>`,
        }),
      ],
      industries: [{ slug: "fintech" }],
    });
    expect(report.findings.filter((finding) => finding.code === "broken-internal-link")).toEqual([]);
  });
});

describe("navigation", () => {
  it("flags a menu entry that resolves to nothing", () => {
    const report = run({ navPaths: ["/about/", "/deleted-page/"] });
    const broken = report.findings.find((finding) => finding.code === "nav-link-missing");
    expect(broken?.severity).toBe("error");
    expect(broken?.message).toContain("/deleted-page/");
  });

  it("accepts menu entries that hit a page, a post, an industry or a redirect", () => {
    const report = run({
      industries: [{ slug: "fintech" }],
      redirects: [redirect({ source_path: "/old-page/", target_path: "/about/" })],
      navPaths: ["/", "/about/", "/blog/choosing-an-extension/", "/industries/fintech/", "/old-page/"],
    });
    expect(report.findings.filter((finding) => finding.code === "nav-link-missing")).toEqual([]);
  });

  it("treats a query string or fragment in a menu entry as the same path", () => {
    const report = run({ navPaths: ["/about/?ref=footer", "/about/#team"] });
    expect(report.findings).toEqual([]);
  });

  it("explains that the menu lives in code, not the database", () => {
    const report = run({ navPaths: ["/ghost/"] });
    const finding = report.findings.find((item) => item.code === "nav-link-missing");
    expect(finding?.fix).toContain("site.ts");
  });
});

describe("orphans", () => {
  it("flags a published page that nothing links to", () => {
    const report = run({ pages: [page({ slug: "hidden" })], navPaths: ["/about/"] });
    expect(report.findings.map((finding) => finding.code)).toContain("orphan-page");
  });

  it("clears a page reachable from the menu", () => {
    const report = run({ pages: [page({ slug: "hidden" })], navPaths: ["/hidden/"] });
    expect(report.findings.map((finding) => finding.code)).not.toContain("orphan-page");
  });

  it("clears a page linked from a post body", () => {
    const report = run({
      pages: [page({ slug: "hidden" })],
      posts: [post({ body: `<p>${"text ".repeat(60)}</p><a href="/hidden/">x</a>` })],
      navPaths: [],
    });
    expect(report.findings.map((finding) => finding.code)).not.toContain("orphan-page");
  });

  it("does not treat posts as orphans, because /blog/ lists them", () => {
    const report = run({ pages: [], posts: [post()], navPaths: [] });
    expect(report.findings.map((finding) => finding.code)).not.toContain("orphan-page");
  });

  it("does not flag a draft as an orphan", () => {
    const report = run({ pages: [page({ slug: "wip", status: "draft" })], navPaths: [] });
    expect(report.findings.map((finding) => finding.code)).not.toContain("orphan-page");
  });
});

describe("summary", () => {
  it("counts the findings it returns, exactly", () => {
    const report = run({
      pages: [page({ title: "", slug: "generator", published_at: null })],
      redirects: [redirect({ target_path: "/nowhere/" })],
    });
    const { summary } = report;
    expect(summary.total).toBe(report.findings.length);
    expect(summary.errors + summary.warnings + summary.notices).toBe(summary.total);
    expect(summary.byCode.reduce((total, entry) => total + entry.count, 0)).toBe(summary.total);
    expect(summary.scanned).toEqual({ pages: 1, posts: 1, redirects: 1 });
  });

  it("orders errors before warnings, and warnings before notices", () => {
    // Three records, one per severity: no title at all (error), no description (warning),
    // and a very short SEO title (notice).
    const report = run({
      pages: [
        page({ id: "p1", slug: "alpha", title: "", seo_title: "", published_at: null }),
        page({ id: "p2", slug: "beta", title: "A complete second page title", excerpt: "", meta_description: null }),
      ],
      posts: [post({ seo_title: "Naming" })],
      navPaths: ["/alpha/", "/beta/", "/blog/choosing-an-extension/"],
    });
    const severities = report.findings.map((finding) => finding.severity);
    expect(severities).toContain("error");
    expect(severities).toContain("warning");
    expect(severities).toContain("notice");
    expect(severities.lastIndexOf("error")).toBeLessThan(severities.indexOf("warning"));
    expect(severities.lastIndexOf("warning")).toBeLessThan(severities.indexOf("notice"));
  });

  it("counts distinct items with errors, not error findings", () => {
    const report = run({ pages: [page({ title: "", seo_title: null, published_at: null })], posts: [] });
    expect(report.summary.errors).toBeGreaterThan(report.summary.itemsWithErrors);
    expect(report.summary.itemsWithErrors).toBe(1);
  });

  it("stays at zero for an empty site rather than inventing health", () => {
    const report = runDiagnostics({ pages: [], posts: [], redirects: [], now: NOW });
    expect(report.summary.total).toBe(0);
    expect(report.summary.indexable).toBe(0);
    expect(report.summary.scanned).toEqual({ pages: 0, posts: 0, redirects: 0 });
  });
});

describe("labels", () => {
  it("has a human label for every code the engine can emit", () => {
    const emitted = new Set<string>();
    const report = runDiagnostics({
      pages: [page({ title: "", slug: "generator", published_at: null, cover_image_url: "https://x/a.jpg", canonical_url: "/about/" })],
      posts: [post({ body: `<a href="/ghost/">x</a>`, seo_title: "y".repeat(80), excerpt: "", meta_description: "" })],
      redirects: [
        redirect({ id: "a", source_path: "/one/", target_path: "/two/" }),
        redirect({ id: "b", source_path: "/two/", target_path: "/one/" }),
        redirect({ id: "c", source_path: "/three/", target_path: "/nowhere/", status_code: 302 }),
      ],
      now: NOW,
    });
    for (const finding of report.findings) emitted.add(finding.code);
    expect(emitted.size).toBeGreaterThan(5);
    for (const code of emitted) {
      expect(CODE_LABEL[code], `missing label for ${code}`).toBeDefined();
      expect(codeLabel(code)).not.toBe(code);
    }
  });
});
