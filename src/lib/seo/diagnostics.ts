/**
 * SEO diagnostics.
 *
 * This module answers one question: *what is actually wrong with the content, right now?*
 * It is deliberately not a scorer. There is no "SEO score" here and there never will be —
 * a number between 0 and 100 would be fabricated authority. What it produces instead is a
 * list of findings, each traceable to a real row and a real rule, with counts that are
 * literally the length of that list.
 *
 * Everything is pure: the admin screen fetches rows, this file judges them. That keeps the
 * rules testable without a database and lets the same checks run in a future build-time
 * check without duplication.
 *
 * Rules are grouped by the thing they protect:
 *   * indexability — is this ever going to appear in search, and is that intended?
 *   * titles/descriptions — present, distinctive, the right length;
 *   * canonical/slug abuse — pages that shadow real routes;
 *   * images — a cover image with no alt text is an accessibility failure, not a nit;
 *   * redirects — loops, chains, dead targets, and sources that shadow live pages;
 *   * links — internal links that point at nothing, and pages nothing links to.
 */

import { RESERVED_ROUTES } from "@/lib/content/seo";

export type Severity = "error" | "warning" | "notice";

export type EntityKind = "page" | "post" | "redirect";

/** A row from `pages` or `posts`, reduced to the fields that affect search. */
export type SeoRecord = {
  id: string;
  slug: string;
  title: string;
  body?: string | null;
  excerpt?: string | null;
  seo_title?: string | null;
  meta_description?: string | null;
  canonical_url?: string | null;
  noindex?: boolean | null;
  og_image_url?: string | null;
  cover_image_url?: string | null;
  cover_image_alt?: string | null;
  published_at?: string | null;
  status?: string | null;
  updated_at?: string | null;
};

export type RedirectRecord = {
  id: string;
  source_path: string;
  target_path: string;
  status_code?: number | null;
  enabled?: boolean | null;
};

export type IndustryRecord = { slug: string };

export type DiagnosticInput = {
  pages: SeoRecord[];
  posts: SeoRecord[];
  redirects: RedirectRecord[];
  industries?: IndustryRecord[];
  /**
   * Every internal href the site actually renders as navigation: the static `PRIMARY_NAV` and
   * `FOOTER_NAV` from `src/lib/config/site.ts` (those are what the header and footer render)
   * plus any rows in `nav_items`. Missing entries here become false "orphan page" findings,
   * so the admin screen passes both sources.
   */
  navPaths?: string[];
  /** Clock, injected so "future date" checks are deterministic in tests. */
  now?: Date;
};

export type Finding = {
  /** Stable across runs, so a UI can keep a dismissal list. */
  id: string;
  code: string;
  severity: Severity;
  kind: EntityKind | "site";
  /** Human label of the row, e.g. "Post · Choosing an extension". */
  subject: string;
  /** Public path the finding affects, when there is one. */
  path: string | null;
  /** Admin screen that fixes it. */
  editHref: string | null;
  message: string;
  fix: string;
};

export type DiagnosticSummary = {
  scanned: { pages: number; posts: number; redirects: number };
  indexable: number;
  errors: number;
  warnings: number;
  notices: number;
  total: number;
  /** Distinct items (rows) with at least one error. */
  itemsWithErrors: number;
  byCode: Array<{ code: string; severity: Severity; count: number }>;
};

export type DiagnosticReport = {
  findings: Finding[];
  summary: DiagnosticSummary;
};

/* ------------------------------------------------------------------------------------ *
 * Limits
 *
 * Google truncates a title around 600 pixels (~60 characters) and a description around
 * 920 pixels (~160 characters). These are *display* limits, not ranking factors — the
 * messages say "may be truncated", never "hurts your ranking".
 * ------------------------------------------------------------------------------------ */

export const TITLE_LIMITS = { min: 20, good: 60, max: 70 } as const;
export const DESCRIPTION_LIMITS = { min: 70, good: 160 } as const;
export const THIN_CONTENT_CHARS = 300;

/** Routes served by real files, so a CMS page must never claim them. */
export const STATIC_PUBLIC_PATHS = ["/", "/generator/", "/industries/", "/extensions/", "/blog/"] as const;

export function pagePath(slug: string): string {
  return `/${slug}/`;
}

export function postPath(slug: string): string {
  return `/blog/${slug}/`;
}

export function industryPath(slug: string): string {
  return `/industries/${slug}/`;
}

function normalisePath(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "/") return "/";
  const withLead = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLead.endsWith("/") ? withLead : `${withLead}/`;
}

/** Strips query strings and fragments; both are irrelevant to a path comparison. */
function barePath(value: string): string {
  return normalisePath(value.split("#")[0]?.split("?")[0] ?? value);
}

/* ------------------------------------------------------------------------------------ *
 * Link extraction
 * ------------------------------------------------------------------------------------ */

const HREF_PATTERN = /href\s*=\s*["']([^"']+)["']/gi;

/** Internal links only: relative paths and in-page anchors. External URLs are not judged. */
export function internalLinks(html: string | null | undefined): string[] {
  if (!html) return [];
  const found: string[] = [];
  for (const match of html.matchAll(HREF_PATTERN)) {
    const href = match[1]?.trim();
    if (!href) continue;
    if (!href.startsWith("/") && !href.startsWith("#")) continue;
    if (href.startsWith("//")) continue; // protocol-relative: external
    if (href.startsWith("#")) continue; // in-page anchor
    found.push(barePath(href));
  }
  return found;
}

/* ------------------------------------------------------------------------------------ *
 * Judging one record
 * ------------------------------------------------------------------------------------ */

function effectiveTitle(record: SeoRecord): string {
  return (record.seo_title ?? "").trim() || (record.title ?? "").trim();
}

function effectiveDescription(record: SeoRecord): string {
  return (record.meta_description ?? "").trim() || (record.excerpt ?? "").trim();
}

function subjectOf(kind: EntityKind, record: SeoRecord): string {
  const label = kind === "page" ? "Page" : kind === "post" ? "Post" : "Redirect";
  return `${label} · ${record.title || record.slug}`;
}

function editHrefFor(kind: EntityKind): string {
  if (kind === "page") return "/admin/pages/";
  if (kind === "post") return "/admin/posts/";
  return "/admin/redirects/";
}

/** Whether the row can appear in search results at all. */
function isIndexable(record: SeoRecord): boolean {
  if (record.noindex === true) return false;
  const status = record.status ?? "published";
  return status === "published" || status === "scheduled";
}

export function findingsFor(record: SeoRecord, kind: "page" | "post", now: Date): Finding[] {
  const findings: Finding[] = [];
  const path = kind === "page" ? pagePath(record.slug) : postPath(record.slug);
  const push = (
    code: string,
    severity: Severity,
    message: string,
    fix: string,
  ) => {
    findings.push({
      id: `${code}:${kind}:${record.id}`,
      code,
      severity,
      kind,
      subject: subjectOf(kind, record),
      path,
      editHref: editHrefFor(kind),
      message,
      fix,
    });
  };

  const status = record.status ?? "published";
  const indexable = isIndexable(record);

  /* Indexability ---------------------------------------------------------------- */
  if (status === "published" && !record.published_at) {
    push(
      "published-without-date",
      "error",
      "Marked published but has no publish date, so the site never renders it and the sitemap omits it.",
      "Set a publish date in the past (or now) to make it public.",
    );
  }

  if (status === "published" && record.published_at) {
    const published = new Date(record.published_at);
    if (!Number.isNaN(published.getTime()) && published.getTime() > now.getTime()) {
      push(
        "future-publish-date",
        "notice",
        `Publish date is in the future (${published.toISOString().slice(0, 10)}), so the page is not public yet.`,
        "This is fine for scheduling. Change the date if it should be live now.",
      );
    }
  }

  if (status === "scheduled") {
    push(
      "scheduled-content",
      "notice",
      "Status is scheduled. The static site only publishes on rebuild, so the date alone does not make it live.",
      "Set it to published and rebuild when the content is ready.",
    );
  }

  if (indexable) {
    /* Titles -------------------------------------------------------------------- */
    const title = effectiveTitle(record);
    if (!title) {
      push("missing-title", "error", "No title and no SEO title.", "Add a title — it becomes the search result heading.");
    } else if (title.length > TITLE_LIMITS.max) {
      push(
        "title-too-long",
        "warning",
        `Title is ${title.length} characters; around ${TITLE_LIMITS.good} is where Google truncates it.`,
        "Shorten the SEO title. The page title can stay long.",
      );
    } else if (title.length < TITLE_LIMITS.min) {
      push(
        "title-too-short",
        "notice",
        `Title is ${title.length} characters, which rarely describes anything specific.`,
        "Make it distinguish this page from the rest of the site.",
      );
    }

    /* Descriptions -------------------------------------------------------------- */
    const description = effectiveDescription(record);
    if (!description) {
      push(
        "missing-description",
        "warning",
        "No meta description and no excerpt, so search engines invent a snippet.",
        "Write a meta description of about 150 characters, or add an excerpt.",
      );
    } else if (description.length > DESCRIPTION_LIMITS.good) {
      push(
        "description-too-long",
        "notice",
        `Description is ${description.length} characters; beyond ${DESCRIPTION_LIMITS.good} it may be cut off.`,
        "Trim it to the part that matters most.",
      );
    } else if (description.length < DESCRIPTION_LIMITS.min) {
      push(
        "description-too-short",
        "notice",
        `Description is only ${description.length} characters.`,
        "Say what the page offers and why someone should click.",
      );
    }

    /* Thin content -------------------------------------------------------------- */
    const bodyLength = (record.body ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().length;
    if (bodyLength < THIN_CONTENT_CHARS) {
      push(
        "thin-content",
        "warning",
        `Body has ${bodyLength} characters of text, which is unlikely to satisfy anyone arriving from search.`,
        "Add the substance: what it is, how it works, what it costs, what it cannot do.",
      );
    }
  }

  /* Media ----------------------------------------------------------------------- */
  if (record.cover_image_url && !(record.cover_image_alt ?? "").trim()) {
    push(
      "cover-image-without-alt",
      "error",
      "A cover image is set with no alt text, so screen-reader users get nothing and the image is decoration at best.",
      "Add alt text describing the image (the media library refuses such uploads for the same reason).",
    );
  }

  /* Slugs and canonicals -------------------------------------------------------- */
  if (kind === "page" && RESERVED_ROUTES.has(record.slug)) {
    push(
      "reserved-slug",
      "error",
      `Slug “${record.slug}” collides with a real application route, so this page's URL is unreachable.`,
      "Change the slug. Reserved values are: " + Array.from(RESERVED_ROUTES).join(", ") + ".",
    );
  }

  if (record.canonical_url && indexable) {
    const canonical = record.canonical_url.trim();
    if (canonical === "") {
      // nothing
    } else if (canonical.startsWith("/") && barePath(canonical) === path) {
      push(
        "canonical-self",
        "notice",
        "Canonical URL points at the page itself, which is the default anyway.",
        "Clear the field unless you intend to de-duplicate this page elsewhere.",
      );
    } else if (/^https?:\/\//i.test(canonical) && canonical.replace(/\/+$/, "").endsWith(path.replace(/\/$/, ""))) {
      push(
        "canonical-self",
        "notice",
        "Canonical URL is this page's own absolute URL, which is already emitted by default.",
        "Clear the field.",
      );
    } else if (canonical.startsWith("/")) {
      push(
        "canonical-relative",
        "warning",
        "Canonical URL is a relative path. It works, but an absolute URL is unambiguous to crawlers.",
        `Use the full URL, e.g. https://example.com${normalisePath(canonical)}.`,
      );
    }
  }

  return findings;
}

/* ------------------------------------------------------------------------------------ *
 * Duplicates
 *
 * Computed across the indexable set only: a draft sharing a title with a published post
 * is not a problem yet.
 * ------------------------------------------------------------------------------------ */

function duplicateFindings(
  records: Array<{ kind: "page" | "post"; record: SeoRecord }>,
  extract: (record: SeoRecord) => string,
  code: string,
  what: string,
): Finding[] {
  const buckets = new Map<string, Array<{ kind: "page" | "post"; record: SeoRecord }>>();
  for (const item of records) {
    if (!isIndexable(item.record)) continue;
    const value = extract(item.record).trim().toLowerCase();
    if (!value) continue;
    buckets.set(value, [...(buckets.get(value) ?? []), item]);
  }

  const findings: Finding[] = [];
  for (const [value, group] of buckets) {
    if (group.length < 2) continue;
    const others = group.map((item) => `${item.kind} “${item.record.slug}”`).join(", ");
    for (const item of group) {
      findings.push({
        id: `${code}:${item.kind}:${item.record.id}`,
        code,
        severity: "warning",
        kind: item.kind,
        subject: subjectOf(item.kind, item.record),
        path: item.kind === "page" ? pagePath(item.record.slug) : postPath(item.record.slug),
        editHref: editHrefFor(item.kind),
        message: `The same ${what} is used by ${group.length} indexable pages: ${others}.`,
        fix: `Make this ${what} distinct — near-duplicate pages compete with each other: "${value.slice(0, 70)}".`,
      });
    }
  }
  return findings;
}

/* ------------------------------------------------------------------------------------ *
 * Redirects
 * ------------------------------------------------------------------------------------ */

export function redirectFindings(
  redirects: RedirectRecord[],
  livePaths: Set<string>,
  knownPaths: Set<string>,
): Finding[] {
  const findings: Finding[] = [];
  const enabled = redirects.filter((redirect) => redirect.enabled !== false);
  const bySource = new Map(enabled.map((redirect) => [barePath(redirect.source_path), redirect]));

  const push = (redirect: RedirectRecord, code: string, severity: Severity, message: string, fix: string) => {
    findings.push({
      id: `${code}:redirect:${redirect.id}`,
      code,
      severity,
      kind: "redirect",
      subject: `Redirect · ${redirect.source_path} → ${redirect.target_path}`,
      path: barePath(redirect.source_path),
      editHref: "/admin/redirects/",
      message,
      fix,
    });
  };

  for (const redirect of enabled) {
    const source = barePath(redirect.source_path);
    const target = redirect.target_path.trim();

    if (source === barePath(target)) {
      push(redirect, "redirect-self", "error", "Redirects to itself.", "Delete it or point it somewhere else.");
      continue;
    }

    if (livePaths.has(source)) {
      push(
        redirect,
        "redirect-shadows-live-page",
        "error",
        "The source path is also a live page. Apache matching order decides which wins, so the result is unpredictable.",
        "Remove the redirect or rename the page's slug.",
      );
    }

    if (/^https?:\/\//i.test(target)) continue; // external target: nothing to verify locally

    const targetPath = barePath(target);

    // Loop detection: follow the chain and see whether it returns to a visited source.
    const seen: string[] = [source];
    let cursor = targetPath;
    let hops = 0;
    let looped = false;
    while (bySource.has(cursor) && hops < 20) {
      if (seen.includes(cursor)) {
        looped = true;
        break;
      }
      seen.push(cursor);
      cursor = barePath(bySource.get(cursor)!.target_path);
      hops += 1;
    }

    if (looped) {
      push(
        redirect,
        "redirect-loop",
        "error",
        `Following this redirect returns to ${cursor}, so the request never terminates.`,
        "Point the chain at a final destination.",
      );
      continue;
    }

    if (hops > 0) {
      push(
        redirect,
        "redirect-chain",
        "warning",
        `Target is itself redirected (${hops} extra hop${hops === 1 ? "" : "s"}). Each hop costs latency and dilutes signals.`,
        `Point this directly at ${cursor}.`,
      );
    }

    if (!knownPaths.has(targetPath) && !bySource.has(targetPath)) {
      push(
        redirect,
        "redirect-to-missing",
        "error",
        `Target ${targetPath} matches no page, post, industry or redirect, so visitors land on a 404.`,
        "Correct the target, or create the destination page.",
      );
    }

    if (redirect.status_code === 302 || redirect.status_code === 307) {
      push(
        redirect,
        "redirect-temporary",
        "notice",
        `Uses a ${redirect.status_code} (temporary) status. Search engines keep the old URL indexed.`,
        "Use 301 or 308 unless the move really is temporary.",
      );
    }
  }

  return findings;
}

/* ------------------------------------------------------------------------------------ *
 * Links
 * ------------------------------------------------------------------------------------ */

export function linkFindings(
  inbound: Map<string, Set<string>>,
  knownPaths: Set<string>,
  redirectSources: Set<string>,
): Finding[] {
  const findings: Finding[] = [];
  for (const [fromPath, targets] of inbound) {
    for (const target of targets) {
      if (knownPaths.has(target) || redirectSources.has(target)) continue;
      findings.push({
        id: `broken-internal-link:${fromPath}:${target}`,
        code: "broken-internal-link",
        severity: "error",
        kind: "site",
        subject: `Link on ${fromPath}`,
        path: fromPath,
        editHref: null,
        message: `${target} does not exist as a page, post, industry or redirect.`,
        fix: "Fix the href in the body, or create the target.",
      });
    }
  }
  return findings;
}

/**
 * Menu entries are links too, and they are the ones every visitor sees. A navigation item
 * pointing at a deleted page is a guaranteed 404 in the header.
 */
export function navFindings(
  navPaths: string[],
  knownPaths: Set<string>,
  redirectSources: Set<string>,
): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const raw of navPaths) {
    const target = barePath(raw);
    if (target === "/") continue;
    if (knownPaths.has(target) || redirectSources.has(target)) continue;
    if (seen.has(target)) continue;
    seen.add(target);
    findings.push({
      id: `nav-link-missing:site:${target}`,
      code: "nav-link-missing",
      severity: "error",
      kind: "site",
      subject: "Navigation menu",
      path: target,
      editHref: null,
      message: `The menu links to ${target}, which is not a page, post, industry or redirect.`,
      fix: "Create the page, repoint the link, or remove the menu entry. Header and footer links are configured in src/lib/config/site.ts.",
    });
  }
  return findings;
}

export function orphanFindings(
  pages: SeoRecord[],
  inbound: Map<string, Set<string>>,
  navPaths: string[],
): Finding[] {
  const linked = new Set<string>(navPaths.map(barePath));
  for (const targets of inbound.values()) {
    for (const target of targets) linked.add(target);
  }

  const findings: Finding[] = [];
  for (const page of pages) {
    if (!isIndexable(page)) continue;
    if (RESERVED_ROUTES.has(page.slug)) continue; // already reported as an error
    const path = pagePath(page.slug);
    if (linked.has(path)) continue;
    findings.push({
      id: `orphan-page:page:${page.id}`,
      code: "orphan-page",
      severity: "warning",
      kind: "page",
      subject: subjectOf("page", page),
      path,
      editHref: editHrefFor("page"),
      message: "Published, indexable, and linked from nowhere — no menu entry and no inbound link from another page or post.",
      fix: "Link to it from navigation or from related content, or set it to draft if it is not meant to be found.",
    });
  }
  return findings;
}

/* ------------------------------------------------------------------------------------ *
 * Report
 * ------------------------------------------------------------------------------------ */

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, notice: 2 };

export function runDiagnostics(input: DiagnosticInput): DiagnosticReport {
  const now = input.now ?? new Date();
  const industries = input.industries ?? [];
  const navPaths = input.navPaths ?? [];

  const findings: Finding[] = [
    ...input.pages.flatMap((page) => findingsFor(page, "page", now)),
    ...input.posts.flatMap((post) => findingsFor(post, "post", now)),
  ];

  const indexableRecords = [
    ...input.pages.map((record) => ({ kind: "page" as const, record })),
    ...input.posts.map((record) => ({ kind: "post" as const, record })),
  ].filter((item) => isIndexable(item.record));

  findings.push(
    ...duplicateFindings(indexableRecords, effectiveTitle, "duplicate-title", "title"),
    ...duplicateFindings(indexableRecords, effectiveDescription, "duplicate-description", "description"),
  );

  // Live paths = every URL the site actually serves with content.
  const publishedPages = input.pages.filter((page) => isIndexable(page) && !RESERVED_ROUTES.has(page.slug));
  const publishedPosts = input.posts.filter((post) => isIndexable(post) && post.published_at && new Date(post.published_at) <= now);

  const livePaths = new Set<string>([
    ...STATIC_PUBLIC_PATHS,
    ...publishedPages.map((page) => pagePath(page.slug)),
    ...publishedPosts.map((post) => postPath(post.slug)),
    ...industries.map((industry) => industryPath(industry.slug)),
  ]);

  const redirectSources = new Set(input.redirects.filter((r) => r.enabled !== false).map((r) => barePath(r.source_path)));

  // Internal links from bodies plus navigation. A link may also point at a redirect source,
  // which resolves fine for a visitor.
  const inbound = new Map<string, Set<string>>();
  const recordLinks = (fromPath: string, html: string | null | undefined) => {
    const links = internalLinks(html);
    if (links.length === 0) return;
    inbound.set(fromPath, new Set(links));
  };
  for (const page of input.pages) recordLinks(pagePath(page.slug), page.body);
  for (const post of input.posts) recordLinks(postPath(post.slug), post.body);

  findings.push(
    ...redirectFindings(input.redirects, livePaths, new Set([...livePaths, ...redirectSources])),
    ...linkFindings(inbound, livePaths, redirectSources),
    ...navFindings(navPaths, livePaths, redirectSources),
    ...orphanFindings(input.pages, inbound, navPaths),
  );

  findings.sort((a, b) => {
    const severity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (severity !== 0) return severity;
    return (a.path ?? "").localeCompare(b.path ?? "") || a.code.localeCompare(b.code);
  });

  const byCodeMap = new Map<string, { code: string; severity: Severity; count: number }>();
  for (const finding of findings) {
    const entry = byCodeMap.get(finding.code);
    if (entry) entry.count += 1;
    else byCodeMap.set(finding.code, { code: finding.code, severity: finding.severity, count: 1 });
  }

  const itemsWithErrors = new Set(
    findings.filter((finding) => finding.severity === "error").map((finding) => `${finding.kind}:${finding.path}`),
  ).size;

  return {
    findings,
    summary: {
      scanned: { pages: input.pages.length, posts: input.posts.length, redirects: input.redirects.length },
      indexable: indexableRecords.length,
      errors: findings.filter((finding) => finding.severity === "error").length,
      warnings: findings.filter((finding) => finding.severity === "warning").length,
      notices: findings.filter((finding) => finding.severity === "notice").length,
      total: findings.length,
      itemsWithErrors,
      byCode: Array.from(byCodeMap.values()).sort(
        (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.count - a.count,
      ),
    },
  };
}

/* ------------------------------------------------------------------------------------ *
 * Presentation helpers
 * ------------------------------------------------------------------------------------ */

export const SEVERITY_LABEL: Record<Severity, string> = {
  error: "Error",
  warning: "Warning",
  notice: "Notice",
};

export const SEVERITY_MEANING: Record<Severity, string> = {
  error: "Broken for visitors or search engines — fix before the next deploy.",
  warning: "Works, but loses traffic, clarity or accessibility.",
  notice: "Worth knowing. Sometimes intentional.",
};

export const CODE_LABEL: Record<string, string> = {
  "published-without-date": "Published with no date",
  "future-publish-date": "Publish date in the future",
  "scheduled-content": "Scheduled, not live",
  "missing-title": "No title",
  "title-too-long": "Title too long",
  "title-too-short": "Title very short",
  "missing-description": "No meta description",
  "description-too-long": "Description too long",
  "description-too-short": "Description short",
  "thin-content": "Thin content",
  "cover-image-without-alt": "Cover image without alt text",
  "reserved-slug": "Slug shadows a real route",
  "canonical-self": "Canonical points at itself",
  "canonical-relative": "Relative canonical",
  "duplicate-title": "Duplicate title",
  "duplicate-description": "Duplicate description",
  "redirect-self": "Redirect to itself",
  "redirect-shadows-live-page": "Redirect hides a live page",
  "redirect-loop": "Redirect loop",
  "redirect-chain": "Redirect chain",
  "redirect-to-missing": "Redirect to a missing page",
  "redirect-temporary": "Temporary redirect",
  "broken-internal-link": "Broken internal link",
  "orphan-page": "Orphan page",
  "nav-link-missing": "Menu links to a missing page",
};

export function codeLabel(code: string): string {
  return CODE_LABEL[code] ?? code;
}
