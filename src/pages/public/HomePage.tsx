import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useHomepage, useFaqs, useTemplates, useMarketplace } from '@/hooks/queries';
import { Seo } from '@/components/shared/Seo';
import { EditorMockup } from '@/components/shared/EditorMockup';
import { TemplateCard, BookCard } from '@/components/shared/BookCard';
import {
  Section,
  SectionHeading,
  FeatureGrid,
  CtaBand,
  TestimonialCard,
  FaqAccordion,
  ComparisonTable,
  StatsRow,
} from '@/components/shared/sections';
import { Button, Badge, Card, CardContent, Skeleton } from '@/components/ui/primitives';
import type { CmsSection } from '@/types/domain';
import { cn } from '@/lib/utils';

function Hero({ section }: { section: CmsSection }) {
  const navigate = useNavigate();
  return (
    <section className="relative overflow-hidden border-b border-border bg-gradient-to-b from-muted/60 to-background py-14 sm:py-20">
      <div className="bg-mesh pointer-events-none absolute inset-0 opacity-50" aria-hidden />
      <div className="container relative grid items-center gap-10 lg:grid-cols-[1.05fr_1fr]">
        <div>
          <Badge variant="secondary" className="mb-4">
            Write · Design · Publish · Sell
          </Badge>
          <h1 className="font-display text-3xl font-bold leading-[1.1] tracking-tight text-foreground sm:text-5xl">{section.title}</h1>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">{section.subtitle}</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Button size="lg" onClick={() => navigate(section.ctaHref ?? '/register')}>
              {section.ctaLabel ?? 'Start writing free'}
            </Button>
            <Button size="lg" variant="outline" onClick={() => navigate('/how-it-works')}>
              See how it works
            </Button>
          </div>
          <dl className="mt-8 grid max-w-lg grid-cols-3 gap-4 border-t border-border pt-6">
            {[
              ['7', 'export formats'],
              ['21', 'template categories'],
              ['9+', 'trim sizes'],
            ].map(([value, label]) => (
              <div key={label}>
                <dt className="text-2xs uppercase tracking-wide text-muted-foreground">{label}</dt>
                <dd className="font-display text-xl font-bold text-foreground">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-5 text-xs text-muted-foreground">No card required · Free plan includes 3 books and full writing mode</p>
        </div>
        <EditorMockup mode="write" />
      </div>
    </section>
  );
}

function TemplateGallery({ section }: { section: CmsSection }) {
  const navigate = useNavigate();
  const { data: templates, isLoading } = useTemplates({ published: true, featuredOnly: true, sort: 'popular' });
  const featured = (templates ?? []).slice(0, 6);
  return (
    <Section tone="muted" id="templates">
      <SectionHeading eyebrow="Templates" title={section.title} description={section.subtitle} />
      <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {isLoading &&
          Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-72 w-full rounded-xl" />)}
        {featured.map((template) => (
          <TemplateCard key={template.id} template={template} onUse={() => navigate(`/templates/${template.slug}`)} onPreview={() => navigate(`/templates/${template.slug}`)} />
        ))}
      </div>
      <div className="mt-8 text-center">
        <Button variant="outline" onClick={() => navigate(section.ctaHref ?? '/templates')}>
          {section.ctaLabel ?? 'Browse all templates'}
        </Button>
      </div>
    </Section>
  );
}

function MarketplacePreview({ section }: { section: CmsSection }) {
  const navigate = useNavigate();
  const { data: books, isLoading } = useMarketplace({ query: '', categoryIds: [], priceFilter: 'all', minRating: 0, sort: 'trending', kind: 'all' });
  return (
    <Section id="marketplace">
      <SectionHeading eyebrow="Marketplace" title={section.title} description={section.subtitle} />
      {section.body && <p className="mx-auto mt-3 max-w-3xl text-center text-sm text-muted-foreground">{section.body}</p>}
      <div className="mt-10 grid grid-cols-2 gap-5 lg:grid-cols-4">
        {isLoading && Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-72 rounded-xl" />)}
        {(books ?? []).slice(0, 4).map((book) => (
          <BookCard key={book.id} book={book} />
        ))}
      </div>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button onClick={() => navigate(section.ctaHref ?? '/marketplace')}>{section.ctaLabel ?? 'Browse the marketplace'}</Button>
        <Button variant="outline" onClick={() => navigate('/dashboard/earnings')}>
          See how authors earn
        </Button>
      </div>
    </Section>
  );
}

export default function HomePage() {
  const navigate = useNavigate();
  const { data, isLoading } = useHomepage();
  const { data: faqs } = useFaqs();

  const sections = React.useMemo(() => {
    const map = new Map<string, CmsSection>();
    (data?.sections ?? []).forEach((section) => map.set(section.key, section));
    return map;
  }, [data]);

  const testimonials = (data?.testimonials ?? []).filter((testimonial) => testimonial.published).slice(0, 6);
  const topFaqs = (faqs ?? []).filter((faq) => faq.published).slice(0, 6);

  if (isLoading) {
    return (
      <div className="container space-y-6 py-16">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  const hero = sections.get('hero');
  const trusted = sections.get('trusted');
  const how = sections.get('how-it-works');
  const editor = sections.get('editor');
  const ai = sections.get('ai-writing');
  const design = sections.get('design-tools');
  const templates = sections.get('templates');
  const publishing = sections.get('publishing');
  const marketplace = sections.get('marketplace');
  const earnings = sections.get('earnings');
  const compare = sections.get('compare');
  const faqSection = sections.get('faq');
  const finalCta = sections.get('final-cta');

  return (
    <>
      <Seo
        title={data?.seo.title ?? 'Scriptora — Write, design, publish and sell your book'}
        description={data?.seo.description}
        keywords={data?.seo.keywords}
        canonical="/"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'SoftwareApplication',
          name: 'Scriptora',
          applicationCategory: 'BusinessApplication',
          offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
          aggregateRating: { '@type': 'AggregateRating', ratingValue: '4.8', ratingCount: '1284' },
        }}
      />

      {hero && <Hero section={hero} />}
      {trusted && (
        <Section className="py-10" tone="paper">
          <p className="text-center text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{trusted.title}</p>
          <div className="mt-6">
            <StatsRow stats={trusted.items.map((entry) => ({ label: entry.body, value: entry.title }))} />
          </div>
          <p className="mt-6 text-center text-sm text-muted-foreground">{trusted.subtitle}</p>
        </Section>
      )}
      {how && (
        <Section id="how-it-works">
          <SectionHeading eyebrow="The pipeline" title={how.title} description={how.subtitle} />
          <FeatureGrid items={how.items.map((entry) => ({ icon: '●', title: `${entry.meta ? `${entry.meta} · ` : ''}${entry.title}`, body: entry.body }))} columns={4} />
          <div className="mt-8 text-center">
            <Button variant="outline" onClick={() => navigate(how.ctaHref ?? '/how-it-works')}>
              {how.ctaLabel}
            </Button>
          </div>
        </Section>
      )}
      {editor && (
        <Section tone="dark">
          <div className="grid items-center gap-10 lg:grid-cols-2">
            <div>
              <SectionHeading eyebrow="Editor" title={editor.title} description={editor.subtitle} align="left" invert />
              <ul className="mt-6 space-y-4">
                {editor.items.map((entry) => (
                  <li key={entry.id} className="flex gap-3">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs text-white" aria-hidden>
                      ✓
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-white">{entry.title}</p>
                      <p className="text-sm text-slate-300">{entry.body}</p>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-6 max-w-xl text-sm text-slate-300">{editor.body}</p>
              <Button variant="secondary" className="mt-6" onClick={() => navigate(editor.ctaHref ?? '/features')}>
                {editor.ctaLabel}
              </Button>
            </div>
            <div className="space-y-4">
              <EditorMockup mode="design" />
              <EditorMockup mode="preview" className="hidden sm:block" />
            </div>
          </div>
        </Section>
      )}
      {ai && (
        <Section id="ai">
          <SectionHeading eyebrow="AI writing" title={ai.title} description={ai.subtitle} />
          <FeatureGrid items={ai.items.map((entry) => ({ icon: '✦', title: entry.title, body: entry.body }))} />
          <Card className="mt-8">
            <CardContent className="flex flex-wrap items-center justify-between gap-4">
              <p className="max-w-2xl text-sm text-muted-foreground">{ai.body}</p>
              <div className="flex gap-2">
                <Button onClick={() => navigate(ai.ctaHref ?? '/ai-writing')}>{ai.ctaLabel}</Button>
                <Button variant="outline" onClick={() => navigate('/pricing')}>
                  Compare AI credits
                </Button>
              </div>
            </CardContent>
          </Card>
        </Section>
      )}
      {design && (
        <Section tone="muted" id="design">
          <SectionHeading eyebrow="Design" title={design.title} description={design.subtitle} />
          <FeatureGrid items={design.items.map((entry) => ({ icon: '◫', title: entry.title, body: entry.body }))} columns={4} />
        </Section>
      )}
      {templates && <TemplateGallery section={templates} />}
      {publishing && (
        <Section id="publishing">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr]">
            <div>
              <SectionHeading eyebrow="Publishing" title={publishing.title} description={publishing.subtitle} align="left" />
              <div className="mt-6 flex flex-wrap gap-2">
                {['PDF', 'Print PDF', 'EPUB 2', 'EPUB 3', 'DOCX', 'HTML', 'TXT'].map((format) => (
                  <Badge key={format} variant="secondary">
                    {format}
                  </Badge>
                ))}
              </div>
              <Button className="mt-6" onClick={() => navigate(publishing.ctaHref ?? '/publishing')}>
                {publishing.ctaLabel}
              </Button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {publishing.items.map((entry) => (
                <Card key={entry.id}>
                  <CardContent>
                    <p className="text-sm font-semibold text-foreground">{entry.title}</p>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{entry.body}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </Section>
      )}
      {marketplace && <MarketplacePreview section={marketplace} />}
      {earnings && (
        <Section tone="muted" id="earnings">
          <SectionHeading eyebrow="Author earnings" title={earnings.title} description={earnings.subtitle} />
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {earnings.items.map((entry) => (
              <Card key={entry.id}>
                <CardContent>
                  <p className="font-display text-2xl font-bold text-foreground">{entry.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{entry.body}</p>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="mt-8 text-center">
            <Button variant="outline" onClick={() => navigate(earnings.ctaHref ?? '/publishing')}>
              {earnings.ctaLabel}
            </Button>
          </div>
        </Section>
      )}
      {compare && (
        <Section id="compare">
          <SectionHeading eyebrow="Comparison" title={compare.title} description={compare.subtitle} />
          <ComparisonTable
            columns={['Scriptora', 'Writing tool', 'Design tool', 'Publishing tool']}
            rows={[
              { label: 'Long-form writing with structure', values: [true, true, false, false] },
              { label: 'Page design with print geometry', values: [true, false, true, false] },
              { label: 'Preflight + print-ready PDF', values: [true, false, false, true] },
              { label: 'EPUB 3 export from same project', values: [true, false, false, true] },
              { label: 'AI with book memory', values: [true, 'Limited', false, false] },
              { label: 'Marketplace with payouts', values: [true, false, false, 'Third-party'] },
              { label: 'One project, no re-import', values: [true, false, false, false] },
            ]}
          />
          <FeatureGrid items={compare.items.map((entry) => ({ icon: '→', title: entry.title, body: entry.body }))} columns={4} />
        </Section>
      )}
      {testimonials.length > 0 && (
        <Section tone="muted">
          <SectionHeading eyebrow="Authors" title="What authors say after publishing with Scriptora" description="Real feedback from writers, illustrators and small presses using the platform today." />
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {testimonials.map((testimonial) => (
              <TestimonialCard
                key={testimonial.id}
                quote={testimonial.quote}
                name={testimonial.name}
                role={`${testimonial.role}${testimonial.bookTitle ? ` · ${testimonial.bookTitle}` : ''}`}
                avatarUrl={testimonial.avatarUrl}
                rating={testimonial.rating}
              />
            ))}
          </div>
        </Section>
      )}
      {faqSection && (
        <Section id="faq">
          <SectionHeading eyebrow="FAQ" title={faqSection.title} description={faqSection.subtitle} />
          <div className="mx-auto mt-10 max-w-3xl">
            <FaqAccordion items={topFaqs.map((faq) => ({ id: faq.id, question: faq.question, answer: faq.answer, category: faq.category }))} />
          </div>
          <div className="mt-6 text-center">
            <Button variant="ghost" onClick={() => navigate(faqSection.ctaHref ?? '/faq')}>
              {faqSection.ctaLabel ?? 'Read all FAQs'} →
            </Button>
          </div>
        </Section>
      )}
      {finalCta && (
        <Section>
          <CtaBand
            title={finalCta.title}
            description={finalCta.subtitle}
            primaryLabel={finalCta.ctaLabel}
            primaryHref={finalCta.ctaHref}
            secondaryLabel="Try the demo account"
            secondaryHref="/login?demo=1"
          />
        </Section>
      )}
    </>
  );
}
