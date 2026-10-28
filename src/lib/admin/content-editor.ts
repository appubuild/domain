/**
 * Logic for the content editor, kept out of React so it can be unit-tested.
 *
 * The editor writes to the same `posts` / `pages` tables the generic resource manager used, so
 * these helpers own the rules a form has to enforce before a row is written: a valid slug, a
 * publication date that matches the status, and a payload whose nullable columns are `null`
 * rather than empty strings (an empty string is a value; a missing value is not).
 */

export type ContentType = "post" | "page";
/** Alias kept for readability inside this module. */
export type ContentKind = ContentType;
export type ContentStatus = "draft" | "scheduled" | "published" | "archived";

export const CONTENT_STATUSES: ContentStatus[] = ["draft", "scheduled", "published", "archived"];

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A `datetime-local` value, as the browser's date-time input produces. */
export type LocalDateTime = string;

export type ContentDraft = {
  type: ContentType;
  /** Row uuid once the record exists; `null` for a new record. */
  id: string | null;
  tags: string[];
  slug: string;
  title: string;
  excerpt: string;
  body: string;
  status: ContentStatus;
  /** Publish instant as `datetime-local`. Required for `published`. */
  publishedAt: LocalDateTime;
  /** Scheduled instant as `datetime-local`. Required for `scheduled`. */
  scheduledFor: LocalDateTime;
  seoTitle: string;
  metaDescription: string;
  canonicalUrl: string;
  noindex: boolean;
  ogImageUrl: string;
  /** Posts only. */
  categoryId: string;
  coverImageUrl: string;
  coverImageAlt: string;
  authorName: string;
  readingMinutes: string;
};

/** A blank draft for a new record. */
export function emptyDraft(type: ContentType = "post", authorName = ""): ContentDraft {
  return { ...EMPTY_DRAFT, type, id: null, tags: [], authorName };
}

export const EMPTY_DRAFT: Omit<ContentDraft, "type" | "id" | "tags"> = {
  slug: "",
  title: "",
  excerpt: "",
  body: "",
  status: "draft",
  publishedAt: "",
  scheduledFor: "",
  seoTitle: "",
  metaDescription: "",
  canonicalUrl: "",
  noindex: false,
  ogImageUrl: "",
  categoryId: "",
  coverImageUrl: "",
  coverImageAlt: "",
  authorName: "",
  readingMinutes: "",
};

/** Public path a piece of content is served at. Trailing slash matches the static export. */
export function publicPath(kind: ContentKind, slug: string): string {
  const clean = slug.trim().replace(/^\/+|\/+$/g, "");
  return kind === "post" ? `/blog/${clean}/` : `/${clean}/`;
}

/**
 * Turns arbitrary text into a slug.
 *
 * Accents are folded rather than dropped ("café" → "cafe") because a slug is an identifier the
 * user may have to type; dropping the letter would silently produce a different word.
 */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 96)
    .replace(/-+$/g, "");
}

/** `datetime-local` string → ISO, or `null` when the value is unusable. */
export function parseLocalDateTime(value: string): string | null {
  if (!value.trim()) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export const toLocalInputValue = toLocalDateTime;

/** ISO timestamp → `datetime-local` string in the browser's timezone. */
export function toLocalDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export type ValidationIssue = { field: keyof ContentDraft | "form"; message: string };

export type ValidationContext = {
  /** Slugs already used by other rows of this table. Checked separately by the editor, which
   *  is the only place that can query the database. */
  takenSlugs?: string[];
  /** The slug this row had when it was loaded; excludes the row from the duplicate check. */
  originalSlug?: string | null;
  /** "now" injected so the tests are not time-dependent. */
  now?: Date;
};

/**
 * Field validation.
 *
 * `draft` is the only status that may be incomplete: saving a half-written post has to work, or
 * people lose work. Everything else must be publishable, which means a body and a date.
 */
export function validateDraft(draft: ContentDraft, context: ValidationContext = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const now = context.now ?? new Date();
  const kind = draft.type;

  if (!draft.title.trim()) issues.push({ field: "title", message: "A title is required." });
  if (draft.title.trim().length > 160) {
    issues.push({ field: "title", message: "Keep the title under 160 characters so it is not truncated in search results." });
  }

  if (!draft.slug.trim()) {
    issues.push({ field: "slug", message: "A slug is required — it is the address of this content." });
  } else if (!SLUG_PATTERN.test(draft.slug.trim())) {
    issues.push({
      field: "slug",
      message: "Use lower-case letters, numbers and single hyphens only (no spaces or slashes).",
    });
  } else if (
    (context.takenSlugs ?? []).includes(draft.slug.trim()) &&
    draft.slug.trim() !== (context.originalSlug ?? "").trim()
  ) {
    issues.push({ field: "slug", message: `“${draft.slug.trim()}” is already used by another ${kind}.` });
  }

  if (draft.status === "published" || draft.status === "scheduled") {
    if (!stripHtml(draft.body).trim()) {
      issues.push({ field: "body", message: "Published content needs a body. Save it as a draft instead." });
    }
    if (draft.status === "published" && !parseLocalDateTime(draft.publishedAt)) {
      issues.push({ field: "publishedAt", message: "Set the date and time this was published." });
    }
    if (draft.status === "published" && parseLocalDateTime(draft.publishedAt)) {
      const at = new Date(parseLocalDateTime(draft.publishedAt)!);
      if (at.getTime() > now.getTime() + 60_000) {
        issues.push({
          field: "publishedAt",
          message: "That publish date is in the future — use the scheduled status instead.",
        });
      }
    }
    if (draft.status === "scheduled") {
      const at = parseLocalDateTime(draft.scheduledFor);
      if (!at) {
        issues.push({ field: "scheduledFor", message: "Choose the date and time to publish." });
      } else if (new Date(at).getTime() <= now.getTime()) {
        issues.push({ field: "scheduledFor", message: "The scheduled time has already passed." });
      }
    }
  }

  if (draft.canonicalUrl.trim() && !/^https:\/\/[^\s]+$/i.test(draft.canonicalUrl.trim())) {
    issues.push({ field: "canonicalUrl", message: "A canonical URL must be an absolute https:// address." });
  }
  if (draft.metaDescription.length > 170) {
    issues.push({ field: "metaDescription", message: "Meta descriptions over 170 characters are cut off." });
  }
  if (draft.seoTitle.length > 70) {
    issues.push({ field: "seoTitle", message: "SEO titles over 70 characters are cut off." });
  }
  if (kind === "post" && draft.coverImageUrl.trim() && !draft.coverImageAlt.trim()) {
    issues.push({ field: "coverImageAlt", message: "Describe the cover image for people who cannot see it." });
  }

  return issues;
}

/**
 * Fills the publish timestamp a row cannot be stored without.
 *
 * `posts` and `pages` both carry a `status = 'published' ⇒ published_at not null` check, and the
 * public policies only expose rows whose `published_at` has passed. Publishing with an empty date
 * therefore has to mean "now": leaving it empty would either be rejected by the database or, worse,
 * hide the record from the site. The function is pure apart from the injected clock.
 */
export function applyPublishDefaults(draft: ContentDraft, now: Date = new Date()): ContentDraft {
  if (draft.status !== "published" || draft.publishedAt.trim()) return draft;
  return { ...draft, publishedAt: toLocalDateTime(now.toISOString()) };
}

/** Removes tags and decodes the few entities the sanitiser emits, for emptiness checks. */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Builds the row payload.
 *
 * Dates are derived from the status rather than trusted from the form: a draft never keeps a
 * scheduled time, and a scheduled row stores its target instant in `scheduled_for` while its
 * `published_at` stays empty until the database job promotes it. Nullable columns become `null`
 * so a blank social image falls back to the site default instead of rendering an empty `src`.
 */
export function buildPayload(draft: ContentDraft): Record<string, unknown> {
  const kind: ContentType = draft.type;
  const nullable = (value: string) => (value.trim() ? value.trim() : null);

  const payload: Record<string, unknown> = {
    slug: draft.slug.trim(),
    title: draft.title.trim(),
    excerpt: draft.excerpt.trim(),
    body: draft.body,
    status: draft.status,
    seo_title: nullable(draft.seoTitle),
    meta_description: nullable(draft.metaDescription),
    canonical_url: nullable(draft.canonicalUrl),
    noindex: draft.noindex,
    og_image_url: nullable(draft.ogImageUrl),
  };

  if (draft.status === "published") {
    payload.published_at = parseLocalDateTime(draft.publishedAt);
    payload.scheduled_for = null;
  } else if (draft.status === "scheduled") {
    payload.published_at = null;
    payload.scheduled_for = parseLocalDateTime(draft.scheduledFor);
  } else {
    // Drafts and archives keep whatever publication date they already had, and never a schedule.
    payload.published_at = parseLocalDateTime(draft.publishedAt);
    payload.scheduled_for = null;
  }

  if (kind === "post") {
    payload.author_name = draft.authorName.trim();
    payload.category_id = draft.categoryId.trim() ? draft.categoryId.trim() : null;
    payload.cover_image_url = nullable(draft.coverImageUrl);
    payload.cover_image_alt = draft.coverImageAlt.trim();
    // The reader recomputes reading time from the body, but the column is what the list screen
    // sorts and displays, so an empty field is filled with the same estimate instead of zero.
    const declared = Math.max(0, Number.parseInt(draft.readingMinutes || "0", 10) || 0);
    payload.reading_minutes =
      declared > 0 ? declared : stripHtml(draft.body) ? Math.max(1, estimateReadingMinutes(draft.body)) : 0;
  }

  return payload;
}

/** A redirect row for a slug change, or `null` when nothing moved. */
export function redirectForSlugChange(input: {
  type: ContentType;
  previousSlug: string;
  nextSlug: string;
  wasPublished: boolean;
}): { source_path: string; target_path: string; status_code: number; enabled: boolean } | null {
  const previous = input.previousSlug.trim();
  const next = input.nextSlug.trim();
  if (!previous || !next || previous === next) return null;
  // A draft never had a public address, so redirecting from it would invent a URL.
  if (!input.wasPublished) return null;
  return {
    source_path: publicPath(input.type, previous),
    target_path: publicPath(input.type, next),
    status_code: 301,
    enabled: true,
  };
}

/** Rough reading time, shown in the sidebar so the field is not a mystery number. */
export function estimateReadingMinutes(html: string): number {
  const words = stripHtml(html).split(/\s+/).filter(Boolean).length;
  return Math.max(0, Math.round(words / 220));
}

/** Google-style preview of the search result this content would produce. */
export function searchPreview(input: {
  kind: ContentKind;
  slug: string;
  title: string;
  seoTitle: string;
  metaDescription: string;
  excerpt: string;
  siteUrl: string;
  noindex: boolean;
}): { title: string; url: string; description: string; warning: string | null } {
  const title = input.seoTitle.trim() || input.title.trim() || "Untitled";
  const description = input.metaDescription.trim() || input.excerpt.trim() || "No description yet — search engines will pick text from the body.";
  const base = input.siteUrl.replace(/\/+$/, "");
  const url = `${base}${publicPath(input.kind, input.slug || "your-slug")}`;

  let warning: string | null = null;
  if (input.noindex) warning = "noindex is on: this will not appear in search results.";
  else if (title.length > 60) warning = "The title will probably be truncated in search results.";
  else if (description.length > 160) warning = "The description will probably be truncated in search results.";

  return { title, url, description, warning };
}

/**
 * Database row → editor draft.
 *
 * Timestamps become `datetime-local` strings in local time: the inputs speak local time and the
 * database stores UTC, and converting in one place keeps the two from drifting on a DST boundary.
 */
export function draftFromRow(type: ContentType, row: Record<string, unknown>, tags: string[] = []): ContentDraft {
  const str = (value: unknown) => (value === null || value === undefined ? "" : String(value));
  return {
    type,
    id: str(row.id) || null,
    tags,
    slug: str(row.slug),
    title: str(row.title),
    excerpt: str(row.excerpt),
    body: str(row.body),
    status: (str(row.status) || "draft") as ContentStatus,
    publishedAt: toLocalDateTime(str(row.published_at) || null),
    scheduledFor: toLocalDateTime(str(row.scheduled_for) || null),
    seoTitle: str(row.seo_title),
    metaDescription: str(row.meta_description),
    canonicalUrl: str(row.canonical_url),
    noindex: Boolean(row.noindex),
    ogImageUrl: str(row.og_image_url),
    categoryId: str(row.category_id),
    coverImageUrl: str(row.cover_image_url),
    coverImageAlt: str(row.cover_image_alt),
    authorName: str(row.author_name),
    readingMinutes: str(row.reading_minutes),
  };
}

/** Editor tags → `post_tags` rows to upsert, de-duplicated by slug. */
export function normalizeTags(tags: string[]): Array<{ name: string; slug: string }> {
  const seen = new Set<string>();
  const rows: Array<{ name: string; slug: string }> = [];
  for (const raw of tags) {
    const name = raw.trim().replace(/\s+/g, " ");
    if (!name) continue;
    const slug = slugify(name);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    rows.push({ name, slug });
  }
  return rows;
}

/** Character-budget classification used by the SEO panel. */
export function budget(value: string, ideal: number, hardMax: number): "empty" | "short" | "good" | "long" | "over" {
  const length = value.trim().length;
  if (length === 0) return "empty";
  if (length > hardMax) return "over";
  if (length > ideal) return "long";
  if (length < Math.round(ideal * 0.6)) return "short";
  return "good";
}
