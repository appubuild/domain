import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { loadSiteContent } from "@/lib/content/source";
import { breadcrumbJsonLd, buildMetadata, faqJsonLd } from "@/lib/content/seo";
import { sanitizeHtml } from "@/lib/content/sanitize";
import { Breadcrumbs } from "@/components/ui/nav";
import { Badge, ButtonLink, Card } from "@/components/ui/primitives";
import { JsonLd } from "@/components/seo/json-ld";

/**
 * Industry landing pages.
 *
 * Content is curated per industry from the industry dictionary (intro, vocabulary, patterns).
 * Pages are only generated for enabled industries, and they are substantive rather than
 * thin permutations — there is no page per keyword.
 */

export const dynamicParams = false;

export async function generateStaticParams() {
  const content = await loadSiteContent();
  return content.industries.filter((industry) => industry.enabled).map((industry) => ({ slug: industry.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const content = await loadSiteContent();
  const industry = content.industries.find((item) => item.slug === slug);
  if (!industry) return { title: "Industry not found", robots: { index: false, follow: false } };
  return buildMetadata({
    title: `${industry.name} domain names — naming ideas and vocabulary`,
    description: industry.description,
    path: `/industries/${industry.slug}/`,
    titleSuffix: content.settings.seo.defaultTitleSuffix,
  });
}

export default async function IndustryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const content = await loadSiteContent();
  const industry = content.industries.find((item) => item.slug === slug);
  if (!industry) notFound();

  const others = content.industries.filter((item) => item.id !== industry.id && item.enabled).slice(0, 4);

  const faq = [
    {
      question: `How does the generator use ${industry.name} vocabulary?`,
      answer: `When you select ${industry.name}, semantic expansion is limited to this industry's related terms and preferred prefixes and suffixes. You can switch expansion off entirely and use only your own words.`,
    },
    {
      question: "Do these names come with availability checks?",
      answer:
        "Not automatically. Availability is a separate check performed by a provider adapter, and every result states its provider and timestamp. Until a check runs, a name is shown as not checked.",
    },
    {
      question: "Can I use my own keywords instead?",
      answer:
        "Yes. Root keywords and custom prefixes and suffixes are always available, and you can add a niche that is not in this directory.",
    },
  ];

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Industries", path: "/industries/" },
          { name: industry.name, path: `/industries/${industry.slug}/` },
        ])}
      />
      <JsonLd data={faqJsonLd(faq)} />
      <Breadcrumbs
        items={[{ label: "Home", href: "/" }, { label: "Industries", href: "/industries/" }, { label: industry.name }]}
        className="mb-5"
      />

      <div className="grid gap-8 lg:grid-cols-[1.4fr_0.6fr]">
        <div>
          <Badge tone="accent">Industry</Badge>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{industry.name} domain names</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-fg-muted">{industry.description}</p>

          <div className="prose-cms mt-6" dangerouslySetInnerHTML={{ __html: sanitizeHtml(`<p>${industry.intro}</p>`) }} />

          {industry.relatedTerms.length > 0 ? (
            <section className="mt-7 space-y-2">
              <h2 className="text-base font-semibold">Vocabulary the engine draws on</h2>
              <div className="flex flex-wrap gap-1.5">
                {industry.relatedTerms.slice(0, 24).map((term) => (
                  <span
                    key={term}
                    className="rounded-full border border-border bg-surface px-2 py-0.5 text-[12px] text-fg-muted"
                  >
                    {term}
                  </span>
                ))}
              </div>
              <p className="text-[11px] text-fg-subtle">
                These are naming components, not claims about your product. Every combination is still
                validated against your constraints before it is shown.
              </p>
            </section>
          ) : null}

          <section className="mt-7 space-y-2">
            <h2 className="text-base font-semibold">Naming guidance</h2>
            <ul className="list-disc space-y-1.5 pl-5 text-[14px] leading-relaxed text-fg-muted">
              <li>
                Keep one recognisable {industry.name.toLowerCase()} component and one distinctive
                component; two descriptive words are hard to own.
              </li>
              <li>Check the name aloud: every extra syllable costs recall in spoken channels.</li>
              <li>
                Avoid <em>{industry.keywords.slice(0, 3).join(", ")}</em>-only names if you plan to expand
                beyond your first product.
              </li>
              <li>
                Availability is independent of quality — a strong name is often already registered.
              </li>
            </ul>
          </section>

          <section className="mt-7 space-y-3">
            <h2 className="text-base font-semibold">Frequently asked</h2>
            {faq.map((item) => (
              <div key={item.question} className="rounded-[var(--radius)] border border-border bg-surface p-3.5">
                <h3 className="text-[13px] font-semibold text-fg">{item.question}</h3>
                <p className="mt-1 text-[13px] leading-relaxed text-fg-muted">{item.answer}</p>
              </div>
            ))}
          </section>
        </div>

        <aside className="space-y-4">
          <Card className="p-4">
            <h2 className="text-sm font-semibold">Generate {industry.name.toLowerCase()} names</h2>
            <p className="mt-1 text-[13px] text-fg-muted">
              Opens the generator with this industry preselected.
            </p>
            <ButtonLink href={`/generator/?ind=${industry.id}`} className="mt-3 w-full">
              Open generator <ArrowRight className="size-4" aria-hidden="true" />
            </ButtonLink>
            <p className="mt-2 text-[11px] text-fg-subtle">
              No account required. Results are scored on your device.
            </p>
          </Card>

          {others.length > 0 ? (
            <Card className="p-4">
              <h2 className="text-sm font-semibold">Related industries</h2>
              <ul className="mt-2 space-y-1.5">
                {others.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={`/industries/${item.slug}/`}
                      className="text-[13px] text-fg-muted hover:text-accent hover:underline"
                    >
                      {item.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card className="p-4">
            <h2 className="text-sm font-semibold">Extension directory</h2>
            <p className="mt-1 text-[13px] text-fg-muted">
              See which extensions can actually be verified before you rely on a result.
            </p>
            <Link href="/extensions/" className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline">
              Check capability <ArrowRight className="size-3" aria-hidden="true" />
            </Link>
          </Card>
        </aside>
      </div>
    </div>
  );
}
