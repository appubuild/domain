import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { loadSiteContent } from "@/lib/content/source";
import { RESERVED_ROUTES, breadcrumbJsonLd, buildMetadata } from "@/lib/content/seo";
import { sanitizeHtml } from "@/lib/content/sanitize";
import { Breadcrumbs } from "@/components/ui/nav";
import { Badge, ButtonLink, Callout } from "@/components/ui/primitives";
import { JsonLd } from "@/components/seo/json-ld";
import { AdSlot } from "@/components/ads/ad-slot";

/**
 * CMS pages (About, Privacy, Terms, How it works, …).
 *
 * Rendered from the build-time content snapshot — see `docs/deployment.md` for the publish
 * workflow. Body HTML is sanitised before it is inlined, even though the admin sanitises on
 * save: stored content is never trusted at render time.
 */

export const dynamicParams = false;

export async function generateStaticParams() {
  const content = await loadSiteContent();
  return content.pages
    .filter((page) => !RESERVED_ROUTES.has(page.slug))
    .map((page) => ({ slug: page.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const content = await loadSiteContent();
  const page = content.pages.find((item) => item.slug === slug);
  if (!page) return { title: "Page not found", robots: { index: false, follow: false } };
  return buildMetadata({
    title: page.seoTitle || page.title,
    description: page.metaDescription || page.excerpt,
    path: `/${page.slug}/`,
    titleSuffix: "",
    image: null,
  });
}

export default async function CmsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const content = await loadSiteContent();
  const page = content.pages.find((item) => item.slug === slug);
  if (!page) notFound();

  const isHowItWorks = page.slug === "how-it-works";

  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: page.title, path: `/${page.slug}/` },
        ])}
      />
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: page.title }]} className="mb-6" />

      <header className="mb-8 space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{page.title}</h1>
        {page.excerpt ? <p className="text-[15px] leading-relaxed text-fg-muted">{page.excerpt}</p> : null}
        {content.warning ? (
          <Callout tone="warn" title="Build used the offline content pack">
            {content.warning}
          </Callout>
        ) : null}
      </header>

      <div className="prose-cms" dangerouslySetInnerHTML={{ __html: sanitizeHtml(page.body) }} />

      <AdSlot template="page" placement="end-of-content" className="mt-8" />

      {isHowItWorks ? (
        <div className="mt-10 rounded-[var(--radius-lg)] border border-border bg-surface p-5">
          <h2 className="text-base font-semibold">Try it with a real keyword</h2>
          <p className="mt-1 text-sm text-fg-muted">
            Open the generator, add a root keyword and inspect the factor breakdown for any candidate.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <ButtonLink href="/generator">
              Open the generator <ArrowRight className="size-4" aria-hidden="true" />
            </ButtonLink>
            <ButtonLink href="/industries" variant="secondary">
              Browse industries
            </ButtonLink>
          </div>
        </div>
      ) : null}

      <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5 text-xs text-fg-subtle">
        <span>
          Scores are heuristics. Availability is reported only when a provider actually answered.
        </span>
        <Link href="/contact" className="underline hover:text-fg">
          Something wrong on this page?
        </Link>
      </footer>
    </article>
  );
}
