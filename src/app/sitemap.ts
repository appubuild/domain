import type { MetadataRoute } from "next";
import { loadSiteContent } from "@/lib/content/source";
import { absoluteUrl, sitemapEntries } from "@/lib/content/seo";

/**
 * Static sitemap.
 *
 * Only indexable public routes are listed. Admin routes, drafts, private collections and
 * filter permutations are excluded by construction: the candidates come from the content
 * snapshot, not from a route scan.
 *
 * Next requires absolute URLs, so nothing is emitted when no application URL is configured
 * — rather than inventing a host that would poison canonical signals.
 */
export const dynamic = "force-static";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const content = await loadSiteContent();
  if (!content.settings.seo.allowIndexing) return [];

  const base = absoluteUrl("/");
  if (!base) {
    // A build without a canonical host would ship a sitemap full of invented URLs, so it
    // ships none — but never silently: the operator sees this in the build log.
    console.warn(
      "[seo] NEXT_PUBLIC_APP_URL is not set: sitemap.xml, canonical links and Open Graph URLs are omitted. " +
        "Set it to the production origin and rebuild before deploying.",
    );
    return [];
  }

  const result: MetadataRoute.Sitemap = [];
  for (const entry of sitemapEntries(content)) {
    result.push({
      url: `${base}${entry.path === "/" ? "" : entry.path}`,
      lastModified: entry.lastModified,
      changeFrequency: entry.changeFrequency,
      priority: entry.priority,
    });
  }
  return result;
}
