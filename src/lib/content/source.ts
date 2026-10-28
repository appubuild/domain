/**
 * Content source.
 *
 * Public pages are statically exported, so their content is resolved **at build time**:
 *
 *   1. If Supabase is configured (`NEXT_PUBLIC_SUPABASE_URL` + anon key), the build reads
 *      published content through the anon REST API — RLS guarantees only published rows.
 *   2. Otherwise, or if the request fails, the build uses the offline content pack.
 *
 * `source` on the returned object records which path was taken so the UI (and the build
 * log) can state it honestly. Publishing in the CMS therefore requires a rebuild — the
 * normal workflow for static hosting, documented in docs/deployment.md.
 */

import { PUBLIC_ENV } from "@/lib/config/env";
import { BRAND_DEFAULTS, FOOTER_NAV, PRIMARY_NAV, type SiteBrand } from "@/lib/config/site";
import { buildNavigation, type NavItemRow, type NavMenuRow } from "./navigation";
import { INDUSTRIES } from "@/lib/brain/dictionaries/industries";
import { TLD_DIRECTORY, type TldCheckability } from "@/lib/brain/tlds";
import { DEFAULT_PAGES, type DefaultPage } from "./defaults";
import { DEFAULT_POSTS, type DefaultPost } from "./posts";

export type ContentSource = "supabase" | "defaults";

export type SiteSettings = {
  brand: SiteBrand;
  seo: {
    defaultTitleSuffix: string;
    defaultDescription: string;
    organizationName: string;
    allowIndexing: boolean;
    twitterHandle: string;
  };
  accounts: { enabled: boolean; allowAnonymousFavorites: boolean };
  analytics: { enabled: boolean };
  advertising: { enabled: boolean };
};

export type IndustryView = {
  id: string;
  name: string;
  slug: string;
  description: string;
  intro: string;
  keywords: string[];
  relatedTerms: string[];
  enabled: boolean;
};

export type TldView = {
  tld: string;
  displayName: string;
  description: string;
  category: string;
  enabled: boolean;
  checkability: TldCheckability;
  note?: string | null;
};

export type PostView = DefaultPost & {
  readingMinutes: number;
};

export type PageView = DefaultPage;

export type SiteContent = {
  source: ContentSource;
  /** Populated when the Supabase read failed and defaults were used instead. */
  warning: string | null;
  builtAt: string;
  settings: SiteSettings;
  pages: PageView[];
  posts: PostView[];
  industries: IndustryView[];
  tlds: TldView[];
  navigation: { primary: typeof PRIMARY_NAV; footer: typeof FOOTER_NAV };
};

const FETCH_TIMEOUT_MS = 4000;

/**
 * Short-lived cache for the whole content load.
 *
 * A static build calls `loadSiteContent()` from the root layout, every page and the sitemap.
 * Without a cache that is dozens of identical REST round-trips — and in `next dev`, whose
 * server renders per request, an unreachable database would add the fetch timeout to every
 * single page view. The TTL is short enough that a dev server notices an edit within a
 * minute and long enough that a build does one read.
 */
const CONTENT_TTL_MS = 60_000;
let contentPromise: { at: number; value: Promise<SiteContent> } | null = null;

function wordCount(html: string): number {
  return html.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
}

/**
 * Tag slugs for one post row, read through the `post_tags_map` junction.
 *
 * The embed is one level deeper than the category one (`post_tags_map(post_tags(...))`),
 * and a row with no tags comes back as `[]` — never as `undefined`, so the card can say
 * "No tags" without special-casing the source.
 */
function tagSlugs(row: Record<string, unknown>): string[] {
  const links = row.post_tags_map;
  if (!Array.isArray(links)) return [];
  return links
    .map((link) => {
      const tag = (link as { post_tags?: { slug?: unknown; name?: unknown } | null } | null)?.post_tags ?? null;
      return tag ? str(tag.slug) || str(tag.name) : "";
    })
    .filter((tag) => tag.length > 0);
}

function withReadingTime(post: DefaultPost): PostView {
  return { ...post, readingMinutes: Math.max(1, Math.round(wordCount(post.body) / 220)) };
}

function defaultContent(warning: string | null = null): SiteContent {
  return {
    source: "defaults",
    warning,
    builtAt: new Date().toISOString(),
    settings: {
      brand: BRAND_DEFAULTS,
      seo: {
        defaultTitleSuffix: ` · ${BRAND_DEFAULTS.name}`,
        defaultDescription: BRAND_DEFAULTS.description,
        organizationName: BRAND_DEFAULTS.name,
        allowIndexing: true,
        twitterHandle: "",
      },
      accounts: { enabled: true, allowAnonymousFavorites: true },
      analytics: { enabled: true },
      advertising: { enabled: false },
    },
    pages: DEFAULT_PAGES,
    posts: DEFAULT_POSTS.map(withReadingTime),
    industries: INDUSTRIES.map((industry) => ({
      id: industry.id,
      name: industry.name,
      slug: industry.slug,
      description: industry.description,
      intro: `${industry.name} names work best when the vocabulary of the domain is recognisable at a glance. The engine draws on ${industry.relatedTerms.slice(0, 6).join(", ")} and similar terms for this industry.`,
      keywords: industry.keywords,
      relatedTerms: industry.relatedTerms,
      enabled: true,
    })),
    tlds: TLD_DIRECTORY.map((record) => ({
      tld: record.tld,
      displayName: record.displayName,
      description: record.description,
      category: record.category,
      enabled: record.enabled,
      checkability: record.checkability,
      note: record.note ?? null,
    })),
    navigation: { primary: PRIMARY_NAV, footer: FOOTER_NAV },
  };
}

type SupabaseRows = {
  pages?: Array<Record<string, unknown>>;
  posts?: Array<Record<string, unknown>>;
  industries?: Array<Record<string, unknown>>;
  tlds?: Array<Record<string, unknown>>;
  settings?: Array<Record<string, unknown>>;
  navMenus?: Array<Record<string, unknown>>;
  navItems?: Array<Record<string, unknown>>;
};

async function restGet(table: string, query: string): Promise<Array<Record<string, unknown>>> {
  const url = `${PUBLIC_ENV.supabaseUrl}/rest/v1/${table}?${query}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        apikey: PUBLIC_ENV.supabaseAnonKey ?? "",
        Authorization: `Bearer ${PUBLIC_ENV.supabaseAnonKey ?? ""}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`${table}: HTTP ${response.status}`);
    }
    const data = (await response.json()) as unknown;
    return Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
  } finally {
    clearTimeout(timeout);
  }
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/**
 * Loads published content for a build. Never throws: a failure downgrades to the offline
 * pack and is reported in `warning` so it cannot silently look like live data.
 */
export async function loadSiteContent(): Promise<SiteContent> {
  const now = Date.now();
  if (!contentPromise || now - contentPromise.at > CONTENT_TTL_MS) {
    contentPromise = { at: now, value: loadSiteContentUncached() };
  }
  return contentPromise.value;
}

/** Clears the memoised content. Used by tests, which stub `fetch` per case. */
export function resetContentCache(): void {
  contentPromise = null;
}

/**
 * Wraps the loader so a production build writes one line naming the source it actually used.
 *
 * The docstring above promises this, and it matters: a build that quietly fell back to the
 * offline pack renders copy that is not in the database, and the only place that is visible
 * before a visitor sees it is the build log. `posts` is counted separately because an empty
 * blog is now a legitimate result rather than a symptom.
 */
async function loadSiteContentUncached(): Promise<SiteContent> {
  const content = await loadSourceContent();
  if (process.env.NODE_ENV === "production") {
    console.info(
      `[content] source=${content.source} pages=${content.pages.length} posts=${content.posts.length} ` +
        `industries=${content.industries.length} tlds=${content.tlds.length}` +
        (content.warning ? ` warning="${content.warning}"` : ""),
    );
  }
  return content;
}

async function loadSourceContent(): Promise<SiteContent> {
  const fallback = defaultContent();
  if (!PUBLIC_ENV.supabaseUrl || !PUBLIC_ENV.supabaseAnonKey) {
    return fallback;
  }

  try {
    const [pageRows, postRows, industryRows, tldRows, settingRows, menuRows, itemRows] = await Promise.all([
      restGet("pages", "select=slug,title,excerpt,body,seo_title,meta_description,canonical_url,noindex,published_at,updated_at&status=eq.published&order=slug.asc"),
      restGet(
        "posts",
        "select=slug,title,excerpt,body,author_name,published_at,seo_title,meta_description,cover_image_url,cover_image_alt,faq,category_id,post_categories(name,slug),post_tags_map(post_tags(slug,name))&status=eq.published&order=published_at.desc&limit=100",
      ),
      restGet("industries", "select=id,name,slug,description,intro,enabled&enabled=eq.true&order=display_order.asc"),
      restGet("tlds", "select=tld,display_name,description,category,enabled,checkability,note&order=display_order.asc"),
      restGet("site_settings", "select=key,value&is_public=eq.true"),
      restGet("nav_menus", "select=id,name,location,position,enabled&order=position.asc,id.asc"),
      restGet("nav_items", "select=menu_id,label,href,description,position,enabled,parent_id&enabled=eq.true&order=position.asc"),
    ]);

    const rows: SupabaseRows = {
      pages: pageRows,
      posts: postRows,
      industries: industryRows,
      tlds: tldRows,
      settings: settingRows,
      navMenus: menuRows,
      navItems: itemRows,
    };

    const settings = { ...fallback.settings };
    for (const row of rows.settings ?? []) {
      const key = str(row.key);
      const value = (row.value ?? {}) as Record<string, unknown>;
      if (key === "brand") {
        settings.brand = {
          ...settings.brand,
          name: str(value.name, settings.brand.name),
          shortName: str(value.shortName, settings.brand.shortName),
          tagline: str(value.tagline, settings.brand.tagline),
          description: str(value.description, settings.brand.description),
          logoMark: str(value.logoMark, settings.brand.logoMark),
          contactEmail: str(value.contactEmail, settings.brand.contactEmail),
        };
      }
      if (key === "seo") {
        settings.seo = {
          defaultTitleSuffix: str(value.defaultTitleSuffix, settings.seo.defaultTitleSuffix),
          defaultDescription: str(value.defaultDescription, settings.seo.defaultDescription),
          organizationName: str(value.organizationName, settings.seo.organizationName),
          allowIndexing: bool(value.allowIndexing, settings.seo.allowIndexing),
          twitterHandle: str(value.twitterHandle, settings.seo.twitterHandle),
        };
      }
      if (key === "accounts") {
        settings.accounts = {
          enabled: bool(value.enabled, settings.accounts.enabled),
          allowAnonymousFavorites: bool(value.allowAnonymousFavorites, true),
        };
      }
      if (key === "analytics") settings.analytics = { enabled: bool(value.enabled, true) };
    }

    const pages: PageView[] =
      (rows.pages?.length ?? 0) > 0
        ? (rows.pages ?? []).map((row) => ({
            slug: str(row.slug),
            title: str(row.title),
            excerpt: str(row.excerpt),
            body: str(row.body),
            seoTitle: str(row.seo_title, str(row.title)),
            metaDescription: str(row.meta_description, str(row.excerpt)),
          }))
        : fallback.pages;

    /**
     * Posts deliberately have **no** offline fallback once the CMS has answered.
     *
     * Every other collection falls back when its table is empty, because a missing page,
     * industry or TLD would leave a structural hole in the site. Posts are different: an empty
     * `posts` table is a real answer — "nothing is published" — and the offline pack's sample
     * article is not in the database, so an editor could neither edit nor delete it while the
     * blog, the landing page and the sitemap all claimed it existed. The pack remains in use
     * only when Supabase is unconfigured (`defaultContent`), where the site genuinely has no
     * backend. RLS already restricts the anon read to `status = 'published' and published_at
     * <= now()`, so "non-future-dated" here is enforced by the database, not by this filter.
     */
    const posts: PostView[] = (rows.posts ?? [])
      .filter((row) => str(row.slug) && str(row.title))
      .map((row) =>
        withReadingTime({
          slug: str(row.slug),
          title: str(row.title),
          excerpt: str(row.excerpt),
          body: str(row.body),
          // The category name comes from the embedded join, so the blog card shows the real
          // grouping rather than the literal word "Post".
          category: str((row.post_categories as { name?: string } | null)?.name, "Post"),
          // Tags arrive through the junction table so a card shows what an editor actually
          // attached; the slug is what the pack stores and what the card renders.
          tags: tagSlugs(row),
          authorName: str(row.author_name, settings.brand.name),
          publishedAt: str(row.published_at, new Date().toISOString()),
          coverImageUrl: str((row as Record<string, unknown>).cover_image_url) || undefined,
          coverImageAlt: str((row as Record<string, unknown>).cover_image_alt) || undefined,
          seoTitle: str(row.seo_title, str(row.title)),
          metaDescription: str(row.meta_description, str(row.excerpt)),
          faq: Array.isArray(row.faq)
            ? (row.faq as Array<{ question?: string; answer?: string }>)
                .map((item) => ({ question: str(item.question), answer: str(item.answer) }))
                .filter((item) => item.question && item.answer)
            : [],
        }),
      );

    const industries: IndustryView[] =
      (rows.industries?.length ?? 0) > 0
        ? (rows.industries ?? []).map((row) => ({
            id: str(row.id),
            name: str(row.name),
            slug: str(row.slug),
            description: str(row.description),
            intro: str(row.intro),
            keywords: [],
            relatedTerms: [],
            enabled: bool(row.enabled, true),
          }))
        : fallback.industries;

    const tlds: TldView[] =
      (rows.tlds?.length ?? 0) > 0
        ? (rows.tlds ?? []).map((row) => ({
            tld: str(row.tld),
            displayName: str(row.display_name, `.${str(row.tld)}`),
            description: str(row.description),
            category: str(row.category, "generic"),
            enabled: bool(row.enabled, true),
            checkability: (str(row.checkability, "unknown") as TldCheckability) ?? "unknown",
            note: (row.note as string | null) ?? null,
          }))
        : fallback.tlds;

    // Navigation comes from the database when it has usable rows; otherwise from the code
    // defaults. `source` is reported so a build log can say which one was used.
    const navigation = buildNavigation(
      (rows.navMenus ?? []).map((row) => ({
        id: str(row.id),
        name: str(row.name),
        location: str(row.location, "primary"),
        position: typeof row.position === "number" ? row.position : null,
        enabled: bool(row.enabled, true),
      })) satisfies NavMenuRow[],
      (rows.navItems ?? []).map((row) => ({
        menu_id: str(row.menu_id),
        label: str(row.label),
        href: str(row.href),
        description: str(row.description),
        position: typeof row.position === "number" ? row.position : null,
        enabled: bool(row.enabled, true),
        parent_id: (row.parent_id as string | null) ?? null,
      })) satisfies NavItemRow[],
    );

    const navWarning =
      navigation.source === "defaults"
        ? `Navigation fell back to the code defaults (${navigation.reason}). Seed nav_menus/nav_items or edit them in the admin panel.`
        : null;

    return {
      source: "supabase",
      warning: navWarning,
      builtAt: new Date().toISOString(),
      settings,
      pages,
      posts,
      industries,
      tlds,
      navigation: { primary: navigation.primary, footer: navigation.footer },
    };
  } catch (error) {
    return defaultContent(
      `Live content could not be loaded at build time (${(error as Error).message}). The offline content pack was used instead; rebuild after fixing the connection.`,
    );
  }
}

/** Industry view lookup used by landing pages. */
export function findIndustry(content: SiteContent, slug: string): IndustryView | undefined {
  return content.industries.find((industry) => industry.slug === slug);
}
