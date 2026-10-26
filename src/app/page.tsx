import { ArrowRight, CircleCheck, Compass, Gauge, Layers } from "lucide-react";
import { ButtonLink, Badge, Card, SectionHeading } from "@/components/ui/primitives";
import { BRAND_DEFAULTS } from "@/lib/config/site";

const principles = [
  {
    icon: <Layers className="size-4.5" aria-hidden="true" />,
    title: "Deterministic first",
    body: "Every candidate comes from documented rules — dictionaries, templates, phonetic blends and length constraints — not from a random string generator.",
  },
  {
    icon: <Gauge className="size-4.5" aria-hidden="true" />,
    title: "Explained scores",
    body: "Quality and brandability are broken into named factors with visible weights, so you can see why a name ranks where it does.",
  },
  {
    icon: <CircleCheck className="size-4.5" aria-hidden="true" />,
    title: "Honest availability",
    body: "A missing record is labelled unknown, never “available”. Every status carries its provider, timestamp and cache state.",
  },
  {
    icon: <Compass className="size-4.5" aria-hidden="true" />,
    title: "Built to be deployed",
    body: "A static frontend you can upload anywhere, with Postgres-backed content, auth and admin managed through Supabase.",
  },
];

export default function HomePage() {
  return (
    <>
      <section className="border-b border-border bg-surface">
        <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1.15fr_0.85fr] lg:py-20">
          <div className="max-w-2xl space-y-5">
            <Badge tone="accent">Phase 1 · Foundation</Badge>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
              {BRAND_DEFAULTS.tagline}
            </h1>
            <p className="text-[15px] leading-relaxed text-fg-muted sm:text-base">
              {BRAND_DEFAULTS.name} builds domain candidates from real naming rules, scores them
              with documented heuristics, and reports availability exactly as the registry said it —
              including when it said nothing at all.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <ButtonLink href="/generator" size="lg">
                Open the generator
                <ArrowRight className="size-4" aria-hidden="true" />
              </ButtonLink>
              <ButtonLink href="/how-it-works" size="lg" variant="secondary">
                How the engine works
              </ButtonLink>
            </div>
          </div>

          <Card className="self-start p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-fg-subtle">
              Design system
            </p>
            <p className="mt-1 text-sm text-fg-muted">
              Tokens, themes and primitives are in place. The generator, brain and admin modules
              build on this foundation in the next phases.
            </p>
            <dl className="mt-4 space-y-2.5 text-sm">
              {[
                ["Themes", "Light · dark · system"],
                ["Tokens", "Single source in globals.css"],
                ["Primitives", "Buttons, fields, dialogs, drawers, toasts, tabs"],
                ["Accessibility", "Focus traps, skip link, reduced motion"],
              ].map(([term, value]) => (
                <div key={term} className="flex items-baseline justify-between gap-4 border-t border-border pt-2.5">
                  <dt className="text-fg-subtle">{term}</dt>
                  <dd className="text-right font-medium text-fg">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6">
        <SectionHeading
          eyebrow="Principles"
          title="What makes this platform different"
          description="The product is judged on correctness and honesty, not on how many buttons it renders."
        />
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {principles.map((item) => (
            <Card key={item.title} className="p-5">
              <span className="inline-flex size-9 items-center justify-center rounded-[var(--radius)] bg-accent-soft text-accent-soft-fg">
                {item.icon}
              </span>
              <h3 className="mt-3 text-sm font-semibold text-fg">{item.title}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-fg-muted">{item.body}</p>
            </Card>
          ))}
        </div>
      </section>
    </>
  );
}
