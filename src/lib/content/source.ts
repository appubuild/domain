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

function wordCount(html: string): number {
  return html.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
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
  const fallback = defaultContent();
  if (!PUBLIC_ENV.supabaseUrl || !PUBLIC_ENV.supabaseAnonKey) {
    return fallback;
  }

  try {
    const [pageRows, postRows, industryRows, tldRows, settingRows] = await Promise.all([
      restGet("pages", "select=slug,title,excerpt,body,seo_title,meta_description,canonical_url,noindex,published_at,updated_at&status=eq.published&order=slug.asc"),
      restGet("posts", "select=slug,title,excerpt,body,author_name,published_at,seo_title,meta_description,cover_image_url,cover_image_alt,faq,category_id&status=eq.published&order=published_at.desc&limit=100"),
      restGet("industries", "select=id,name,slug,description,intro,enabled&enabled=eq.true&order=display_order.asc"),
      restGet("tlds", "select=tld,display_name,description,category,enabled,checkability,note&order=display_order.asc"),
      restGet("site_settings", "select=key,value&is_public=eq.true"),
    ]);

    const rows: SupabaseRows = {
      pages: pageRows,
      posts: postRows,
      industries: industryRows,
      tlds: tldRows,
      settings: settingRows,
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

    const posts: PostView[] =
      (rows.posts?.length ?? 0) > 0
        ? (rows.posts ?? [])
            .filter((row) => str(row.slug) && str(row.title))
            .map((row) =>
              withReadingTime({
                slug: str(row.slug),
                title: str(row.title),
                excerpt: str(row.excerpt),
                body: str(row.body),
                category: "Post",
                tags: [],
                authorName: str(row.author_name, settings.brand.name),
                publishedAt: str(row.published_at, new Date().toISOString()),
                seoTitle: str(row.seo_title, str(row.title)),
                metaDescription: str(row.meta_description, str(row.excerpt)),
                faq: Array.isArray(row.faq)
                  ? (row.faq as Array<{ question?: string; answer?: string }>)
                      .map((item) => ({ question: str(item.question), answer: str(item.answer) }))
                      .filter((item) => item.question && item.answer)
                  : [],
              }),
            )
        : fallback.posts;

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

    return {
      source: "supabase",
      warning: null,
      builtAt: new Date().toISOString(),
      settings,
      pages,
      posts,
      industries,
      tlds,
      navigation: fallback.navigation,
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
