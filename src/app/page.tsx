import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, Compass, Layers, ShieldCheck } from "lucide-react";
import { loadSiteContent } from "@/lib/content/source";
import { buildMetadata, faqJsonLd, websiteJsonLd } from "@/lib/content/seo";
import { FEATURES, HOW_IT_WORKS, LANDING_FAQ } from "@/lib/content/landing";
import { createGenerationRequest, generate } from "@/lib/brain";
import { Badge, ButtonLink, Card, EmptyState, SectionHeading } from "@/components/ui";
import { JsonLd } from "@/components/seo/json-ld";
import { AdSlot } from "@/components/ads/ad-slot";
import { HeroSearch } from "@/components/marketing/hero-search";
import { ResultPreview } from "@/components/marketing/result-preview";
import { formatDate } from "@/lib/utils/format";

/**
 * Landing page.
 *
 * Everything here is served from the static export and every claim maps to behaviour that exists:
 * the hero form is the generator's own entry point, the preview is real engine output rendered by
 * the product's availability chip, the blog strip is the same content the blog index renders (or
 * an explicit empty state), and the FAQ is the same array the structured data is built from.
 */

const PREVIEW_ROOT = "pay";
const PREVIEW_SEED = 20260501;

export async function generateMetadata(): Promise<Metadata> {
  const content = await loadSiteContent();
  return buildMetadata({
    title: `${content.settings.brand.name} — deterministic domain name generator`,
    titleSuffix: content.settings.seo.defaultTitleSuffix,
    description: content.settings.seo.defaultDescription,
    path: "/",
  });
}

export default async function HomePage() {
  const content = await loadSiteContent();

  // Real engine output, computed during the static build with a fixed seed, so the page shows the
  // product instead of a screenshot of it. If the engine changes, the preview changes with it.
  const preview = generate(
    createGenerationRequest({
      roots: [PREVIEW_ROOT],
      tlds: [".com"],
      targetCount: 3,
      seed: PREVIEW_SEED,
      // The landing preview pins nothing but the root, the seed and the count: the word order is
      // the engine's decision now, so a change to the placement scorer shows up here too.
      partnerLengths: [3, 4, 5],
    }),
    {},
  );

  const posts = [...content.posts]
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, 3);

  const faq = faqJsonLd(LANDING_FAQ);

  return (
    <>
      <JsonLd data={websiteJsonLd(content)} />
      {faq ? <JsonLd data={faq} /> : null}

      {/* ------------------------------------------------------------------ hero */}
      <section className="border-b border-border bg-surface">
        <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:py-16">
          <div className="space-y-5">
            <Badge tone="accent">Deterministic naming · real availability checks</Badge>
            <h1 className="text-3xl font-semibold tracking-tight text-fg sm:text-4xl lg:text-5xl">
              {content.settings.brand.tagline}
            </h1>
            <p className="max-w-xl text-[15px] leading-relaxed text-fg-muted sm:text-base">
              Give the generator one root word. It analyses what that word is and means, builds
              names from rules you can read, scores them from named factors, and checks availability
              only when a registry actually answers.
            </p>

            <HeroSearch />

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1 text-xs text-fg-subtle">
              <span className="inline-flex items-center gap-1.5">
                <Check className="size-3.5 text-success" aria-hidden="true" />
                No account needed
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Check className="size-3.5 text-success" aria-hidden="true" />
                100 · 500 · 1,000 names per run
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Check className="size-3.5 text-success" aria-hidden="true" />
                CSV, TXT and JSON export
              </span>
            </div>
          </div>

          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3.5 py-2.5">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-subtle">
                  Engine output, not a mock-up
                </p>
                <p className="text-[13px] text-fg-muted">
                  {preview.candidates.length} of {preview.diagnostics.requested} names for “{PREVIEW_ROOT}”
                </p>
              </div>
              <Badge tone="neutral" className="font-mono">
                seed {PREVIEW_SEED}
              </Badge>
            </div>
            <ResultPreview candidates={preview.candidates.slice(0, 3)} query={PREVIEW_ROOT} />
            <p className="border-t border-border bg-surface-2/40 px-3.5 py-2 text-[11px] leading-relaxed text-fg-subtle">
              Availability is shown as <strong className="text-fg-muted">not checked</strong> until a
              registry lookup runs. That is the whole rule: no answer is never displayed as a
              positive one.
            </p>
          </Card>
        </div>
      </section>

      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
        {/* Home template placement. Renders nothing unless advertising is fully configured. */}
        <AdSlot template="home" placement="after-intro" className="mt-8" />
      </div>

      {/* ----------------------------------------------------------- how it works */}
      <section className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6" aria-labelledby="how-it-works">
        <SectionHeading
          id="how-it-works"
          eyebrow="How it works"
          title="Six stages, each one inspectable"
          description="The pipeline is fixed and documented. Nothing is generated by sampling a language model in the background."
          action={
            <ButtonLink href="/how-it-works/" variant="secondary" size="sm">
              Read the full walkthrough
            </ButtonLink>
          }
        />
        <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {HOW_IT_WORKS.map((step, index) => (
            <li key={step.title}>
              <Card as="div" className="h-full p-4">
                <span className="inline-flex size-7 items-center justify-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent-soft-fg">
                  {index + 1}
                </span>
                <h3 className="mt-2.5 text-sm font-semibold text-fg">{step.title}</h3>
                <p className="mt-1 text-[13px] leading-relaxed text-fg-muted">{step.body}</p>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      {/* ------------------------------------------------------------- features */}
      <section className="border-y border-border bg-surface" aria-labelledby="features">
        <div className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6">
          <SectionHeading
            id="features"
            eyebrow="What is actually in the product"
            title="Controls that change the output"
            description="Every item below is wired to the engine. There are no
            placeholder buttons on this site — a control that does nothing would be reported as a bug."
          />
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((feature) => (
              <Card key={feature.title} className="h-full p-4">
                <h3 className="flex items-start gap-2 text-sm font-semibold text-fg">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
                  {feature.title}
                </h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-fg-muted">{feature.body}</p>
              </Card>
            ))}
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <ButtonLink href="/generator/" size="lg">
              Open the generator
              <ArrowRight className="size-4" aria-hidden="true" />
            </ButtonLink>
            <ButtonLink href="/extensions/" variant="secondary" size="lg">
              Browse extensions
            </ButtonLink>
            <span className="inline-flex items-center gap-1.5 text-xs text-fg-subtle">
              <Compass className="size-3.5" aria-hidden="true" />
              Start from an industry or an extension if you have no root yet.
            </span>
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------------- blog */}
      <section className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6" aria-labelledby="recent-posts">
        <SectionHeading
          id="recent-posts"
          eyebrow="From the blog"
          title="Recent writing"
          description="Published articles from the CMS. Only published, non-future-dated posts appear here."
          action={
            <ButtonLink href="/blog/" variant="secondary" size="sm">
              All articles
            </ButtonLink>
          }
        />
        {posts.length === 0 ? (
          <EmptyState
            className="mt-8"
            title="No published articles yet"
            description="Nothing has been published from the CMS yet. When a post is published and the site is rebuilt, it appears here."
          />
        ) : (
          <ul className="mt-8 grid gap-4 md:grid-cols-3">
            {posts.map((post) => (
              <li key={post.slug}>
                <Card as="article" className="flex h-full flex-col overflow-hidden">
                  {post.coverImageUrl ? (
                    // Fixed aspect ratio so the card does not shift when the image loads.
                    <img
                      src={post.coverImageUrl}
                      alt={post.coverImageAlt ?? ""}
                      loading="lazy"
                      decoding="async"
                      className="aspect-[16/9] w-full object-cover"
                    />
                  ) : (
                    <div
                      aria-hidden="true"
                      className="flex aspect-[16/9] w-full items-center justify-center bg-surface-2 text-fg-subtle"
                    >
                      <Layers className="size-6" />
                    </div>
                  )}
                  <div className="flex flex-1 flex-col gap-2 p-4">
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-fg-subtle">
                      <Badge tone="neutral">{post.category || "Post"}</Badge>
                      <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
                      <span aria-hidden="true">·</span>
                      <span>{post.readingMinutes} min read</span>
                    </div>
                    <h3 className="text-sm font-semibold leading-snug text-fg">
                      <Link href={`/blog/${post.slug}/`} className="hover:text-accent">
                        {post.title}
                      </Link>
                    </h3>
                    <p className="line-clamp-3 text-[13px] leading-relaxed text-fg-muted">{post.excerpt}</p>
                    <Link
                      href={`/blog/${post.slug}/`}
                      className="mt-auto inline-flex items-center gap-1 pt-1 text-xs font-medium text-accent hover:underline"
                    >
                      Read the article
                      <ArrowRight className="size-3" aria-hidden="true" />
                    </Link>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ------------------------------------------------------------------ faq */}
      <section className="border-t border-border bg-surface" aria-labelledby="faq">
        <div className="mx-auto w-full max-w-3xl px-4 py-14 sm:px-6">
          <SectionHeading
            id="faq"
            eyebrow="Questions"
            title="Short, direct answers"
            description="If an answer here stops being true, it is removed — the FAQ is part of the product, not marketing copy."
          />
          <div className="mt-6 divide-y divide-border rounded-[var(--radius-lg)] border border-border bg-bg">
            {LANDING_FAQ.map((item) => (
              <details key={item.question} className="group px-4 py-3">
                <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm font-medium text-fg marker:content-['']">
                  {item.question}
                  <span
                    aria-hidden="true"
                    className="shrink-0 text-fg-subtle transition-transform group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="mt-2 text-[13px] leading-relaxed text-fg-muted">{item.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ final CTA */}
      <section className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6">
        <Card className="flex flex-wrap items-center justify-between gap-4 p-6">
          <div className="max-w-xl">
            <h2 className="text-xl font-semibold tracking-tight text-fg">Start with one word</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-fg-muted">
              You can see the whole pipeline working before you decide anything: scores, factors,
              constraints and availability are all on the same screen.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ButtonLink href="/generator/" size="lg">
              Generate names
              <ArrowRight className="size-4" aria-hidden="true" />
            </ButtonLink>
            <ButtonLink href="/how-it-works/" variant="secondary" size="lg">
              How it works
            </ButtonLink>
          </div>
        </Card>
      </section>
    </>
  );
}
