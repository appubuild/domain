import type { Metadata } from "next";
import Link from "next/link";
import { loadSiteContent } from "@/lib/content/source";
import { breadcrumbJsonLd, buildMetadata } from "@/lib/content/seo";
import { Breadcrumbs } from "@/components/ui/nav";
import { Badge, Callout, EmptyState, SectionHeading } from "@/components/ui/primitives";
import { JsonLd } from "@/components/seo/json-ld";
import { formatDate } from "@/lib/utils/format";

export async function generateMetadata(): Promise<Metadata> {
  const content = await loadSiteContent();
  return buildMetadata({
    title: "Naming research and guides",
    description:
      "Practical writing on domain naming: how to judge a name, what the scores mean, and where heuristics stop being useful.",
    path: "/blog/",
    titleSuffix: content.settings.seo.defaultTitleSuffix,
  });
}

export default async function BlogIndexPage() {
  const content = await loadSiteContent();
  const posts = [...content.posts].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
      <JsonLd data={breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Blog", path: "/blog/" }])} />
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Blog" }]} className="mb-5" />

      <SectionHeading
        eyebrow="Writing"
        headingLevel={1}
        title="Naming research and guides"
        description="Long-form, practical notes on judging names, reading scores honestly and using availability data without over-trusting it."
      />

      {content.warning ? (
        <Callout tone="warn" className="mt-5" title="Offline content pack">
          {content.warning}
        </Callout>
      ) : null}

      <div className="mt-8 space-y-3">
        {posts.length === 0 ? (
          <EmptyState
            title="No published articles yet"
            description="Posts published in the admin CMS appear here after the next build. Only published, non-future-dated posts are listed or included in the sitemap."
          />
        ) : (
          posts.map((post) => (
            <article key={post.slug} className="rounded-[var(--radius-lg)] border border-border bg-surface p-5">
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-fg-subtle">
                <Badge tone="accent">{post.category}</Badge>
                <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
                <span aria-hidden="true">·</span>
                <span>{post.readingMinutes} min read</span>
                <span aria-hidden="true">·</span>
                <span>{post.authorName}</span>
              </div>
              <h2 className="mt-2 text-lg font-semibold tracking-tight">
                <Link href={`/blog/${post.slug}/`} className="hover:text-accent">
                  {post.title}
                </Link>
              </h2>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-fg-muted">{post.excerpt}</p>
              <div className="mt-3 flex items-center justify-between border-t border-border pt-2.5 text-[11px] text-fg-subtle">
                <span>{post.tags.length > 0 ? post.tags.map((tag) => `#${tag}`).join(" ") : "No tags"}</span>
                <Link href={`/blog/${post.slug}/`} className="font-medium text-accent hover:underline">
                  Read article
                </Link>
              </div>
            </article>
          ))
        )}
      </div>
    </div>
  );
}
