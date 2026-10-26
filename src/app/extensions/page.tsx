import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, CircleHelp } from "lucide-react";
import { loadSiteContent } from "@/lib/content/source";
import { breadcrumbJsonLd, buildMetadata } from "@/lib/content/seo";
import { Breadcrumbs } from "@/components/ui/nav";
import { Badge, Callout, Card, SectionHeading } from "@/components/ui/primitives";
import { JsonLd } from "@/components/seo/json-ld";

export async function generateMetadata(): Promise<Metadata> {
  const content = await loadSiteContent();
  return buildMetadata({
    title: "Domain extension directory",
    description:
      "Every extension in the directory with an explicit statement of whether availability can be verified, and which provider family handles it.",
    path: "/extensions/",
    titleSuffix: content.settings.seo.defaultTitleSuffix,
  });
}

const CATEGORY_LABELS: Record<string, string> = {
  generic: "Generic",
  technology: "Technology",
  business: "Business",
  country: "Country",
  media: "Media",
  social: "Social",
};

export default async function ExtensionsPage() {
  const content = await loadSiteContent();
  const grouped = content.tlds.reduce<Record<string, typeof content.tlds>>((accumulator, tld) => {
    const key = tld.category;
    accumulator[key] = [...(accumulator[key] ?? []), tld];
    return accumulator;
  }, {});

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
      <JsonLd
        data={breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Extensions", path: "/extensions/" }])}
      />
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Extensions" }]} className="mb-5" />

      <SectionHeading
        eyebrow="Directory"
        headingLevel={1}
        title="Extensions and what we can verify"
        description="An extension appearing in this list does not mean its availability can be checked. Each entry states the provider family that would answer, or says plainly that it cannot be verified."
      />

      <Callout tone="info" className="mt-6" title="How availability works">
        Checks go to registry data through RDAP using a documented provider adapter. When a provider
        returns no usable answer, the result is <strong>unknown</strong> or <strong>check_failed</strong> —
        never <strong>available</strong>. Always confirm with a registrar before paying for anything.
      </Callout>

      <div className="mt-8 space-y-8">
        {Object.entries(grouped).map(([category, tlds]) => (
          <section key={category}>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-subtle">
              {CATEGORY_LABELS[category] ?? category}
            </h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {tlds.map((tld) => {
                const verifiable = tld.checkability === "rdap" || tld.checkability === "registrar-api";
                const unknown = tld.checkability === "unknown";
                return (
                  <Card key={tld.tld} as="article" className="p-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="font-mono text-sm font-semibold text-fg">{tld.displayName}</h3>
                        <p className="mt-0.5 text-[12.5px] leading-relaxed text-fg-muted">{tld.description}</p>
                      </div>
                      <Badge tone={verifiable ? "success" : unknown ? "warn" : "neutral"}>
                        {verifiable ? (
                          <span className="inline-flex items-center gap-1">
                            <CheckCircle2 className="size-3" aria-hidden="true" />
                            {tld.checkability === "rdap" ? "RDAP" : "Registrar API"}
                          </span>
                        ) : unknown ? (
                          <span className="inline-flex items-center gap-1">
                            <CircleHelp className="size-3" aria-hidden="true" /> Unverified
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            <AlertTriangle className="size-3" aria-hidden="true" /> Not checkable
                          </span>
                        )}
                      </Badge>
                    </div>
                    {tld.note ? <p className="mt-2 text-[11px] leading-relaxed text-warn">{tld.note}</p> : null}
                    <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-[11px] text-fg-subtle">
                      <span>{tld.enabled ? "Offered in the generator" : "Not offered by default"}</span>
                      <Link href={`/generator/?tlds=${tld.tld}`} className="text-accent hover:underline">
                        Generate with .{tld.tld}
                      </Link>
                    </div>
                  </Card>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <p className="mt-8 max-w-3xl text-[11px] leading-relaxed text-fg-subtle">
        The directory is database-managed: administrators can enable extensions, change display order
        and record which provider family answers for each one. Nothing here is a statement of
        registration cost, trademark availability or resale value.
      </p>
    </div>
  );
}
