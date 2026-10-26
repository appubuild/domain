import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { loadSiteContent } from "@/lib/content/source";
import { breadcrumbJsonLd, buildMetadata } from "@/lib/content/seo";
import { Breadcrumbs } from "@/components/ui/nav";
import { Card, SectionHeading } from "@/components/ui/primitives";
import { JsonLd } from "@/components/seo/json-ld";

export async function generateMetadata(): Promise<Metadata> {
  const content = await loadSiteContent();
  return buildMetadata({
    title: "Industry naming directory",
    description:
      "Browse naming vocabulary by industry: payments, AI, cloud, e-commerce, health and more — with the prefixes, suffixes and related terms the engine uses.",
    path: "/industries/",
    titleSuffix: content.settings.seo.defaultTitleSuffix,
  });
}

export default async function IndustriesPage() {
  const content = await loadSiteContent();

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      <JsonLd data={breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Industries", path: "/industries/" }])} />
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Industries" }]} className="mb-5" />

      <SectionHeading
        eyebrow="Directory"
        title="Industry naming vocabulary"
        description="Each industry carries its own keywords, related terms and preferred prefixes and suffixes. Selecting an industry in the generator restricts semantic expansion to that vocabulary."
        headingLevel={1}
      />

      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {content.industries
          .filter((industry) => industry.enabled)
          .map((industry) => (
            <Card key={industry.id} as="article" className="flex flex-col p-4 transition-colors hover:border-border-strong">
              <h2 className="text-sm font-semibold text-fg">
                <Link href={`/industries/${industry.slug}/`} className="hover:text-accent">
                  {industry.name}
                </Link>
              </h2>
              <p className="mt-1 flex-1 text-[13px] leading-relaxed text-fg-muted">{industry.description}</p>
              {industry.relatedTerms.length > 0 ? (
                <p className="mt-2 truncate text-[11px] text-fg-subtle">
                  Terms: {industry.relatedTerms.slice(0, 5).join(", ")}
                </p>
              ) : null}
              <div className="mt-3 flex items-center justify-between border-t border-border pt-2.5">
                <Link
                  href={`/generator/?ind=${industry.id}`}
                  className="inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline"
                >
                  Generate names <ArrowRight className="size-3" aria-hidden="true" />
                </Link>
                <Link href={`/industries/${industry.slug}/`} className="text-[12px] text-fg-subtle hover:text-fg">
                  Naming guide
                </Link>
              </div>
            </Card>
          ))}
      </div>

      <p className="mt-6 max-w-3xl text-[11px] leading-relaxed text-fg-subtle">
        Industry vocabulary is configuration, not a claim about your business. If your niche is missing,
        enter your own keywords in the generator — custom terms are supported without adding a category.
      </p>
    </div>
  );
}
