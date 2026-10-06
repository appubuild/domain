import { useNavigate } from 'react-router-dom';
import type { CmsPage } from '@/types/domain';
import { Seo } from '@/components/shared/Seo';
import { Section, SectionHeading, CtaBand, StatsRow } from '@/components/shared/sections';
import { Icon } from '@/components/shared/Icon';
import { Button, Card, CardContent } from '@/components/ui/primitives';
import { BreadcrumbBar } from '@/components/shared/sections';

/** Renders an admin-editable CMS page (About, Contact, custom pages) with live updates. */
export function CmsPageView({ page, breadcrumbLabel }: { page: CmsPage; breadcrumbLabel?: string }) {
  const navigate = useNavigate();
  const sections = [...page.sections].filter((section) => section.visible).sort((a, b) => a.order - b.order);
  const hero = sections.find((section) => section.type === 'hero');
  const rest = sections.filter((section) => section !== hero);

  return (
    <>
      <Seo
        title={page.seo.title || page.title}
        description={page.seo.description}
        keywords={page.seo.keywords}
        canonical={page.seo.canonical || `/${page.slug}`}
        noIndex={page.seo.noIndex}
        jsonLd={{ '@context': 'https://schema.org', '@type': 'WebPage', name: page.title, description: page.seo.description }}
      />
      {hero ? (
        <section className="border-b border-border bg-muted/40 py-14 sm:py-16">
          <div className="container">
            <BreadcrumbBar items={[{ label: 'Home', href: '/' }, { label: breadcrumbLabel ?? page.title }]} />
            <h1 className="max-w-3xl font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">{hero.title}</h1>
            {hero.subtitle && <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground sm:text-base">{hero.subtitle}</p>}
            {hero.ctaLabel && hero.ctaHref && (
              <Button className="mt-6" onClick={() => navigate(hero.ctaHref as string)}>
                {hero.ctaLabel}
              </Button>
            )}
          </div>
        </section>
      ) : (
        <div className="container pt-4">
          <BreadcrumbBar items={[{ label: 'Home', href: '/' }, { label: breadcrumbLabel ?? page.title }]} />
        </div>
      )}

      {rest.map((section, index) => {
        const tone = index % 2 === 1 ? 'muted' : 'default';
        if (section.type === 'text') {
          return (
            <Section key={section.id} tone={tone as 'default' | 'muted'}>
              <div className="mx-auto max-w-3xl">
                <h2 className="font-display text-xl font-bold text-foreground sm:text-2xl">{section.title}</h2>
                {section.subtitle && <p className="mt-2 text-sm text-muted-foreground">{section.subtitle}</p>}
                <div
                  className="prose-scriptora mt-4 space-y-4 text-sm leading-relaxed text-muted-foreground"
                  dangerouslySetInnerHTML={{ __html: section.body }}
                />
              </div>
            </Section>
          );
        }
        if (section.type === 'stats') {
          return (
            <Section key={section.id} tone={tone as 'default' | 'muted'}>
              <SectionHeading title={section.title} description={section.subtitle} align="left" />
              <div className="mt-8">
                <StatsRow stats={section.items.map((entry) => ({ label: entry.body, value: entry.title }))} />
              </div>
            </Section>
          );
        }
        if (section.type === 'cta') {
          return (
            <Section key={section.id} tone={tone as 'default' | 'muted'}>
              <CtaBand
                title={section.title}
                description={section.subtitle}
                primaryLabel={section.ctaLabel ?? 'Get started'}
                primaryHref={section.ctaHref ?? '/register'}
                secondaryLabel="Talk to us"
                secondaryHref="/contact"
              />
            </Section>
          );
        }
        if (section.type === 'faq') {
          return (
            <Section key={section.id} tone={tone as 'default' | 'muted'}>
              <SectionHeading title={section.title} description={section.subtitle} />
            </Section>
          );
        }
        return (
          <Section key={section.id} tone={tone as 'default' | 'muted'}>
            <SectionHeading title={section.title} description={section.subtitle} align={section.type === 'features' ? 'center' : 'left'} />
            {section.body && <p className="mt-3 max-w-3xl text-sm text-muted-foreground">{section.body}</p>}
            {section.items.length > 0 && (
              <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {section.items.map((entry) => (
                  <Card key={entry.id}>
                    <CardContent>
                      {entry.icon && (
                        <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                          <Icon name={entry.icon} />
                        </span>
                      )}
                      <h3 className="text-sm font-semibold text-foreground">{entry.title}</h3>
                      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{entry.body}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
            {section.ctaLabel && section.ctaHref && (
              <Button className="mt-6" variant="outline" onClick={() => navigate(section.ctaHref as string)}>
                {section.ctaLabel}
              </Button>
            )}
          </Section>
        );
      })}
    </>
  );
}
