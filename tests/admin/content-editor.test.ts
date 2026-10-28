/**
 * Content editor rules.
 *
 * These decide whether a post or page can be saved and what exactly is written. They are plain
 * functions so the rules are testable without a browser, a database or a clock.
 */

import { describe, expect, it } from "vitest";
import {
  applyPublishDefaults,
  buildPayload,
  budget,
  draftFromRow,
  emptyDraft,
  estimateReadingMinutes,
  normalizeTags,
  publicPath,
  redirectForSlugChange,
  searchPreview,
  slugify,
  stripHtml,
  toLocalDateTime,
  validateDraft,
  type ContentDraft,
} from "@/lib/admin/content-editor";

const NOW = new Date("2026-05-01T12:00:00.000Z");

function draft(overrides: Partial<ContentDraft> = {}): ContentDraft {
  return {
    ...emptyDraft("post", "Ada"),
    title: "Choosing a domain name",
    slug: "choosing-a-domain-name",
    body: "<p>A real body with enough words to be considered content.</p>",
    ...overrides,
  };
}

describe("slugs", () => {
  it("folds accents instead of dropping the letters", () => {
    expect(slugify("Café Crème")).toBe("cafe-creme");
  });

  it("collapses punctuation, spaces and repeated hyphens", () => {
    expect(slugify("  Choosing a Domain Name!  ")).toBe("choosing-a-domain-name");
    expect(slugify("a -- b__c")).toBe("a-b-c");
    expect(slugify("---")).toBe("");
  });

  it("produces the public path the static export serves", () => {
    expect(publicPath("post", "hello")).toBe("/blog/hello/");
    expect(publicPath("page", "about")).toBe("/about/");
    expect(publicPath("page", "/about/")).toBe("/about/");
  });

  it("never emits a slug that fails the database check constraint", () => {
    for (const input of ["Hello, World!", "Ünïcode — test", "x".repeat(200), "Trailing--"]) {
      const slug = slugify(input);
      if (slug) expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });
});

describe("validation", () => {
  it("lets an incomplete draft be saved", () => {
    const issues = validateDraft({ ...emptyDraft("post"), title: "Idea", slug: "idea" }, { now: NOW });
    expect(issues).toEqual([]);
  });

  it("requires a title and a slug", () => {
    expect(validateDraft(emptyDraft("post"), { now: NOW }).map((issue) => issue.field)).toEqual(["title", "slug"]);
  });

  it("rejects capitals and spaces in a slug", () => {
    const issues = validateDraft(draft({ slug: "Not A Slug" }), { now: NOW });
    expect(issues.map((issue) => issue.field)).toContain("slug");
  });

  it("detects a duplicate slug unless it is this row's own slug", () => {
    const context = { now: NOW, takenSlugs: ["taken"], originalSlug: "mine" };
    expect(validateDraft(draft({ slug: "taken" }), context).map((issue) => issue.field)).toContain("slug");
    expect(validateDraft(draft({ slug: "mine" }), context)).toEqual([]);
  });

  it("will not publish an empty body but will happily save it as a draft", () => {
    expect(validateDraft(draft({ status: "published", body: "<p> &nbsp; </p>" }), { now: NOW }).map((i) => i.field)).toContain("body");
    expect(validateDraft(draft({ status: "draft", body: "" }), { now: NOW })).toEqual([]);
  });

  it("requires a date to publish and a future date to schedule", () => {
    expect(
      validateDraft(draft({ status: "published", publishedAt: "" }), { now: NOW }).map((issue) => issue.field),
    ).toContain("publishedAt");

    expect(
      validateDraft(draft({ status: "scheduled", scheduledFor: "2026-04-30T09:00" }), { now: NOW }).map((issue) => issue.field),
    ).toContain("scheduledFor");

    expect(
      validateDraft(draft({ status: "scheduled", scheduledFor: "2026-05-02T09:00" }), { now: NOW }),
    ).toEqual([]);
  });

  it("refuses a future publish date and points at scheduling instead", () => {
    const issues = validateDraft(draft({ status: "published", publishedAt: "2026-06-01T09:00" }), { now: NOW });
    expect(issues.map((issue) => issue.field)).toContain("publishedAt");
    expect(issues[0]!.message).toMatch(/scheduled/i);
  });

  it("requires absolute https canonical URLs and bounded SEO fields", () => {
    expect(validateDraft(draft({ canonicalUrl: "/relative" }), { now: NOW }).map((i) => i.field)).toContain("canonicalUrl");
    expect(validateDraft(draft({ metaDescription: "x".repeat(171) }), { now: NOW }).map((i) => i.field)).toContain("metaDescription");
    expect(validateDraft(draft({ seoTitle: "x".repeat(71) }), { now: NOW }).map((i) => i.field)).toContain("seoTitle");
  });

  it("asks for cover image alt text on posts", () => {
    const issues = validateDraft(draft({ coverImageUrl: "https://cdn.example.com/a.jpg" }), { now: NOW });
    expect(issues.map((issue) => issue.field)).toContain("coverImageAlt");
  });
});

describe("payloads", () => {
  it("stores null rather than empty strings for nullable columns", () => {
    const payload = buildPayload(draft());
    expect(payload.seo_title).toBeNull();
    expect(payload.meta_description).toBeNull();
    expect(payload.canonical_url).toBeNull();
    expect(payload.cover_image_url).toBeNull();
    expect(payload.category_id).toBeNull();
  });

  it("derives dates from the status", () => {
    const published = buildPayload(draft({ status: "published", publishedAt: "2026-04-01T10:00", scheduledFor: "2026-05-09T10:00" }));
    expect(published.published_at).toBe(new Date("2026-04-01T10:00").toISOString());
    expect(published.scheduled_for).toBeNull();

    const scheduled = buildPayload(draft({ status: "scheduled", scheduledFor: "2026-05-09T10:00" }));
    expect(scheduled.scheduled_for).toBe(new Date("2026-05-09T10:00").toISOString());
    expect(scheduled.published_at).toBeNull();

    const draftRow = buildPayload(draft({ status: "draft", scheduledFor: "2026-05-09T10:00" }));
    expect(draftRow.scheduled_for).toBeNull();
  });

  it("fills an empty reading time from the body instead of storing zero", () => {
    const long = `<p>${"word ".repeat(660)}</p>`;
    expect(buildPayload(draft({ body: long })).reading_minutes).toBe(3);
    expect(buildPayload(draft({ body: "<p>two words</p>" })).reading_minutes).toBe(1);
    expect(buildPayload(draft({ body: "" })).reading_minutes).toBe(0);
    expect(buildPayload(draft({ readingMinutes: "7" })).reading_minutes).toBe(7);
  });

  it("keeps post-only columns out of a page payload", () => {
    const payload = buildPayload({ ...draft(), type: "page" });
    expect(payload).not.toHaveProperty("category_id");
    expect(payload).not.toHaveProperty("cover_image_url");
    expect(payload).not.toHaveProperty("reading_minutes");
  });
});

describe("reading time, tags and redirects", () => {
  it("estimates reading time from the text, not the markup", () => {
    const body = `<p>${"word ".repeat(660)}</p>`;
    expect(estimateReadingMinutes(body)).toBe(3);
    expect(stripHtml("<p>Hello <strong>there</strong></p>")).toBe("Hello there");
  });

  it("normalises and de-duplicates tags by slug", () => {
    expect(normalizeTags(["Domain  Names", "domain names", "", "Branding"])).toEqual([
      { name: "Domain Names", slug: "domain-names" },
      { name: "Branding", slug: "branding" },
    ]);
  });

  it("creates a 301 only when a published slug moves", () => {
    expect(
      redirectForSlugChange({ type: "post", previousSlug: "old", nextSlug: "new", wasPublished: true }),
    ).toMatchObject({ source_path: "/blog/old/", target_path: "/blog/new/", status_code: 301, enabled: true });
    expect(redirectForSlugChange({ type: "post", previousSlug: "old", nextSlug: "new", wasPublished: false })).toBeNull();
    expect(redirectForSlugChange({ type: "post", previousSlug: "same", nextSlug: "same", wasPublished: true })).toBeNull();
    expect(redirectForSlugChange({ type: "post", previousSlug: "", nextSlug: "new", wasPublished: true })).toBeNull();
  });
});

describe("publish defaults", () => {
  it("stamps 'now' when publishing without a date", () => {
    const filled = applyPublishDefaults(draft({ status: "published", publishedAt: "" }), NOW);
    expect(filled.publishedAt).toBe(toLocalDateTime(NOW.toISOString()));
    // ...and the stamped draft is publishable, where the empty one was not.
    expect(validateDraft(draft({ status: "published", publishedAt: "" }), { now: NOW })).not.toEqual([]);
    expect(validateDraft(filled, { now: NOW })).toEqual([]);
    expect(buildPayload(filled).published_at).toBe(NOW.toISOString());
  });

  it("never overwrites a date the author chose", () => {
    const kept = applyPublishDefaults(draft({ status: "published", publishedAt: "2026-01-02T03:04" }), NOW);
    expect(kept.publishedAt).toBe("2026-01-02T03:04");
  });

  it("leaves drafts and scheduled rows alone", () => {
    expect(applyPublishDefaults(draft({ status: "draft" }), NOW).publishedAt).toBe("");
    const scheduled = draft({ status: "scheduled", scheduledFor: "2026-05-09T10:00" });
    expect(applyPublishDefaults(scheduled, NOW).publishedAt).toBe("");
  });
});

describe("row round-trip and previews", () => {
  it("maps a row into a draft and back without losing fields", () => {
    const draft = draftFromRow(
      "post",
      {
        id: "11111111-1111-4111-8111-111111111111",
        slug: "hello",
        title: "Hello",
        excerpt: "Short",
        body: "<p>Body</p>",
        status: "scheduled",
        published_at: null,
        scheduled_for: "2026-05-09T10:00:00.000Z",
        category_id: null,
        cover_image_url: null,
        cover_image_alt: "",
        og_image_url: null,
        seo_title: null,
        meta_description: null,
        canonical_url: null,
        noindex: true,
        author_name: "Ada",
        reading_minutes: 2,
      },
      ["naming"],
    );

    expect(draft.status).toBe("scheduled");
    expect(draft.tags).toEqual(["naming"]);
    expect(draft.noindex).toBe(true);
    expect(draft.seoTitle).toBe("");
    expect(toLocalDateTime(new Date(draft.scheduledFor).toISOString())).toBe(draft.scheduledFor);
  });

  it("builds a preview that falls back to title and excerpt", () => {
    const preview = searchPreview({
      kind: "post",
      slug: "hello",
      title: "Hello there",
      seoTitle: "",
      metaDescription: "",
      excerpt: "A short summary",
      siteUrl: "https://example.com/",
      noindex: false,
    });
    expect(preview.title).toBe("Hello there");
    expect(preview.description).toBe("A short summary");
    expect(preview.url).toBe("https://example.com/blog/hello/");
    expect(preview.warning).toBeNull();
  });

  it("warns when the result would be suppressed or truncated", () => {
    const hidden = searchPreview({
      kind: "page",
      slug: "about",
      title: "About",
      seoTitle: "",
      metaDescription: "",
      excerpt: "",
      siteUrl: "https://example.com",
      noindex: true,
    });
    expect(hidden.warning).toMatch(/noindex/i);
    expect(hidden.description).toMatch(/no description/i);

    const long = searchPreview({
      kind: "page",
      slug: "about",
      title: "x".repeat(61),
      seoTitle: "",
      metaDescription: "",
      excerpt: "Plenty of words here",
      siteUrl: "https://example.com",
      noindex: false,
    });
    expect(long.warning).toMatch(/truncated/i);
  });

  it("classifies SEO field lengths", () => {
    expect(budget("", 60, 70)).toBe("empty");
    expect(budget("short", 60, 70)).toBe("short");
    expect(budget("x".repeat(60), 60, 70)).toBe("good");
    expect(budget("x".repeat(66), 60, 70)).toBe("long");
    expect(budget("x".repeat(71), 60, 70)).toBe("over");
  });
});
