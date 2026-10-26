import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadSiteContent } from "@/lib/content/source";
import { articleJsonLd, breadcrumbJsonLd, buildMetadata, faqJsonLd } from "@/lib/content/seo";
import { readingMinutes, sanitizeHtml } from "@/lib/content/sanitize";
import { Breadcrumbs } from "@/components/ui/nav";
import { Badge, Callout } from "@/components/ui/primitives";
import { JsonLd } from "@/components/seo/json-ld";
import { formatDate } from "@/lib/utils/format";

export const dynamicParams = false;

export async function generateStaticParams() {
  const content = await loadSiteContent();
  return content.posts.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const content = await loadSiteContent();
  const post = content.posts.find((item) => item.slug === slug);
  if (!post) return { title: "Article not found", robots: { index: false, follow: false } };
  return buildMetadata({
    title: post.seoTitle || post.title,
    description: post.metaDescription || post.excerpt,
    path: `/blog/${post.slug}/`,
    titleSuffix: content.settings.seo.defaultTitleSuffix,
    type: "article",
    publishedTime: post.publishedAt,
  });
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const content = await loadSiteContent();
  const post = content.posts.find((item) => item.slug === slug);
  if (!post) notFound();

  const related = content.posts.filter((item) => item.slug !== post.slug).slice(0, 2);
  const faq = post.faq ?? [];
  const minutes = readingMinutes(post.body);

  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <JsonLd data={articleJsonLd(post, content)} />
      <JsonLd data={breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Blog", path: "/blog/" }, { name: post.title, path: `/blog/${post.slug}/` }])} />
      {faq.length > 0 ? <JsonLd data={faqJsonLd(faq)} /> : null}

      <Breadcrumbs
        items={[{ label: "Home", href: "/" }, { label: "Blog", href: "/blog/" }, { label: post.title }]}
        className="mb-6"
      />

      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-fg-subtle">
          <Badge tone="accent">{post.category}</Badge>
          <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
          <span aria-hidden="true">·</span>
          <span>{minutes} min read</span>
          <span aria-hidden="true">·</span>
          <span>{post.authorName}</span>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{post.title}</h1>
        <p className="text-[15px] leading-relaxed text-fg-muted">{post.excerpt}</p>
      </header>

      <div className="prose-cms mt-8" dangerouslySetInnerHTML={{ __html: sanitizeHtml(post.body) }} />

      {faq.length > 0 ? (
        <section className="mt-10 space-y-3">
          <h2 className="text-lg font-semibold">Frequently asked</h2>
          {faq.map((item) => (
            <details key={item.question} className="rounded-[var(--radius)] border border-border bg-surface p-3.5">
              <summary className="cursor-pointer text-[13px] font-semibold text-fg">{item.question}</summary>
              <p className="mt-1.5 text-[13px] leading-relaxed text-fg-muted">{item.answer}</p>
            </details>
          ))}
        </section>
      ) : null}

      <Callout tone="info" className="mt-8" title="Scores are heuristics">
        Nothing in this article is investment, legal or trademark advice. Our tool reports what a naming
        rule produced; it cannot tell you whether a name is registrable, protectable or commercially
        valuable.
      </Callout>

      {related.length > 0 ? (
        <section className="mt-10 border-t border-border pt-6">
          <h2 className="text-sm font-semibold text-fg">More reading</h2>
          <ul className="mt-2 space-y-1.5">
            {related.map((item) => (
              <li key={item.slug}>
                <Link href={`/blog/${item.slug}/`} className="text-[13px] text-fg-muted hover:text-accent hover:underline">
                  {item.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <footer className="mt-8 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4 text-[11px] text-fg-subtle">
        <span>Published {formatDate(post.publishedAt)}</span>
        <span>
          {post.tags.length > 0 ? post.tags.map((tag) => `#${tag}`).join(" ") : ""}
        </span>
      </footer>
    </article>
  );
}
