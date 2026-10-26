/**
 * SEO helpers: metadata construction, canonical URLs and structured data.
 *
 * Rules enforced here:
 *  - canonical URLs are only emitted when an application URL is configured, so a
 *    half-configured deployment cannot publish wrong canonicals;
 *  - FAQ structured data is only added when the page actually shows those FAQs (Google's
 *    eligibility requirement);
 *  - no aggregate ratings, review counts or other fabricated properties appear anywhere.
 */

import type { Metadata } from "next";
import { PUBLIC_ENV } from "@/lib/config/env";
import type { PostView, SiteContent } from "./source";

export type PageMetaInput = {
  title: string;
  description: string;
  path: string;
  noindex?: boolean;
  image?: string | null;
  type?: "website" | "article";
  publishedTime?: string;
  modifiedTime?: string;
  titleSuffix?: string;
};

export function absoluteUrl(path: string): string | null {
  if (!PUBLIC_ENV.appUrl) return null;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${PUBLIC_ENV.appUrl}${normalized === "/" ? "" : normalized}`;
}

export function buildMetadata(
  input: PageMetaInput,
  suffix = ` · ${PUBLIC_ENV.siteName}`,
): Metadata {
  const canonical = absoluteUrl(input.path);
  const fullTitle = input.titleSuffix === "" ? input.title : `${input.title}${input.titleSuffix ?? suffix}`;

  return {
    title: fullTitle,
    description: input.description,
    alternates: canonical ? { canonical } : undefined,
    robots: input.noindex
      ? { index: false, follow: false }
      : { index: true, follow: true },
    openGraph: {
      title: fullTitle,
      description: input.description,
      url: canonical ?? undefined,
      siteName: PUBLIC_ENV.siteName,
      type: input.type ?? "website",
      images: input.image ? [{ url: input.image }] : undefined,
      publishedTime: input.publishedTime,
      modifiedTime: input.modifiedTime,
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description: input.description,
      images: input.image ? [input.image] : undefined,
    },
  };
}

/* ------------------------------ structured data ----------------------------- */

type JsonLd = Record<string, unknown>;

export function organizationJsonLd(content: SiteContent): JsonLd {
  const url = absoluteUrl("/");
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: content.settings.seo.organizationName,
    ...(url ? { url } : {}),
    description: content.settings.seo.defaultDescription,
  };
}

export function websiteJsonLd(content: SiteContent): JsonLd {
  const url = absoluteUrl("/");
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: content.settings.brand.name,
    ...(url ? { url } : {}),
    description: content.settings.seo.defaultDescription,
    potentialAction: {
      "@type": "SearchAction",
      target: `${url ?? ""}/blog/?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };
}

export function breadcrumbJsonLd(items: Array<{ name: string; path: string }>): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      ...(absoluteUrl(item.path) ? { item: absoluteUrl(item.path) } : {}),
    })),
  };
}

export function articleJsonLd(post: PostView, content: SiteContent): JsonLd {
  const url = absoluteUrl(`/blog/${post.slug}`);
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.metaDescription || post.excerpt,
    ...(url ? { url, mainEntityOfPage: url } : {}),
    datePublished: post.publishedAt,
    author: { "@type": "Organization", name: post.authorName },
    publisher: { "@type": "Organization", name: content.settings.seo.organizationName },
    wordCount: post.body.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length,
    articleSection: post.category,
  };
}

/** FAQPage markup — only emitted when the visible page renders the same questions. */
export function faqJsonLd(items: Array<{ question: string; answer: string }>): JsonLd | null {
  if (items.length === 0) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer.replace(/<[^>]+>/g, "") },
    })),
  };
}

export function softwareApplicationJsonLd(content: SiteContent): JsonLd {
  const url = absoluteUrl("/generator");
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: `${content.settings.brand.name} domain generator`,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Any",
    ...(url ? { url } : {}),
    description:
      "Generates brandable domain candidates with documented, explainable quality and brandability scores.",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };
}

/* --------------------------------- sitemap --------------------------------- */

export type SitemapEntry = {
  url: string;
  lastModified: string;
  changeFrequency: "daily" | "weekly" | "monthly" | "yearly";
  priority: number;
};

/**
 * Sitemap entries are relative paths; `app/sitemap.ts` converts them to absolute URLs.
 * Only indexable public content is included — never admin routes, drafts, filter
 * permutations or preview URLs.
 */
export function sitemapEntries(content: SiteContent): Array<Omit<SitemapEntry, "url"> & { path: string }> {
  const now = new Date().toISOString();
  const entries: Array<Omit<SitemapEntry, "url"> & { path: string }> = [
    { path: "/", lastModified: now, changeFrequency: "weekly", priority: 1 },
    { path: "/generator/", lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { path: "/industries/", lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { path: "/extensions/", lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { path: "/blog/", lastModified: now, changeFrequency: "weekly", priority: 0.7 },
  ];

  for (const page of content.pages) {
    entries.push({
      path: `/${page.slug}/`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.6,
    });
  }

  for (const industry of content.industries) {
    entries.push({
      path: `/industries/${industry.slug}/`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.6,
    });
  }

  for (const post of content.posts) {
    entries.push({
      path: `/blog/${post.slug}/`,
      lastModified: post.publishedAt,
      changeFrequency: "monthly",
      priority: 0.6,
    });
  }

  return entries;
}

/** Slugs that must never be treated as CMS pages (they belong to real routes). */
export const RESERVED_ROUTES = new Set([
  "generator", "industries", "extensions", "blog", "admin", "api",
  "sitemap.xml", "robots.txt",
]);
