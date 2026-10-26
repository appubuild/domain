import type { MetadataRoute } from "next";
import { loadSiteContent } from "@/lib/content/source";
import { absoluteUrl } from "@/lib/content/seo";

export const dynamic = "force-static";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const content = await loadSiteContent();
  const base = absoluteUrl("/");

  if (!content.settings.seo.allowIndexing) {
    // Indexing disabled globally: refuse everything except the sitemap file itself.
    return {
      rules: [{ userAgent: "*", disallow: "/" }],
      sitemap: base ? `${base}/sitemap.xml` : undefined,
    };
  }

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Never index admin surfaces, API endpoints or query-string permutations of the
        // generator (infinite filter space, all low value).
        disallow: ["/admin/", "/admin", "/api/", "/generator/?*"],
      },
    ],
    sitemap: base ? `${base}/sitemap.xml` : undefined,
    host: base ?? undefined,
  };
}
