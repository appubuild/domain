import * as React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useFaqs } from '@/hooks/queries';
import { Seo } from '@/components/shared/Seo';
import { Section, SectionHeading, BreadcrumbBar, FaqAccordion, CtaBand } from '@/components/shared/sections';
import { Button, Card, CardContent, Input, Skeleton } from '@/components/ui/primitives';
import { EmptyState, ErrorState } from '@/components/ui/data';
import { cn } from '@/lib/utils';

export default function FaqPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { data: faqs, isLoading, isError, refetch } = useFaqs();
  const [query, setQuery] = React.useState('');

  const published = React.useMemo(() => (faqs ?? []).filter((faq) => faq.published), [faqs]);
  const categories = React.useMemo(() => Array.from(new Set(published.map((faq) => faq.category))), [published]);
  const activeCategory = params.get('category') ?? 'all';

  const filtered = React.useMemo(() => {
    let list = published;
    if (activeCategory !== 'all') list = list.filter((faq) => faq.category === activeCategory);
    if (query.trim()) {
      const lower = query.toLowerCase();
      list = list.filter((faq) => faq.question.toLowerCase().includes(lower) || faq.answer.toLowerCase().includes(lower));
    }
    return list.sort((a, b) => a.order - b.order);
  }, [published, activeCategory, query]);

  const popular = published.filter((faq) => /price|pric|export|epub|print|own|rights|refund/i.test(faq.question)).slice(0, 4);

  return (
    <>
      <Seo
        title="FAQ — publishing, exporting, pricing and rights"
        description="Answers to the questions authors actually ask: file formats, print requirements, royalties, refunds, rights and how AI is used."
        canonical="/faq"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: published.slice(0, 12).map((faq) => ({
            '@type': 'Question',
            name: faq.question,
            acceptedAnswer: { '@type': 'Answer', text: faq.answer },
          })),
        }}
      />
      <section className="border-b border-border bg-muted/40 py-10">
        <div className="container">
          <BreadcrumbBar items={[{ label: 'Home', href: '/' }, { label: 'FAQ' }]} />
          <SectionHeading
            eyebrow="Support"
            title="Questions authors actually ask"
            description="Including the honest limitations of what ships today, and what is coming in the next phase."
            align="left"
          />
          <div className="mt-6 flex flex-wrap gap-3">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search the knowledge base…"
              aria-label="Search FAQs"
              className="max-w-sm"
            />
            <Button variant="outline" onClick={() => navigate('/contact')}>
              Ask a different question
            </Button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setParams({})}
              className={cn(
                'rounded-full border px-3 py-1.5 text-xs font-medium',
                activeCategory === 'all' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground',
              )}
            >
              All topics ({published.length})
            </button>
            {categories.map((category) => (
              <button
                key={category}
                type="button"
                onClick={() => setParams({ category })}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-xs font-medium',
                  activeCategory === category ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground',
                )}
              >
                {category} ({published.filter((faq) => faq.category === category).length})
              </button>
            ))}
          </div>
        </div>
      </section>

      <Section>
        {isError ? (
          <ErrorState title="The knowledge base could not load" onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        ) : !filtered.length ? (
          <EmptyState
            icon="?"
            title="Nothing matches that search"
            description="Try a different phrase, or ask us directly and we will add it to the knowledge base."
            actions={
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => { setQuery(''); setParams({}); }}>
                  Clear filters
                </Button>
                <Button onClick={() => navigate('/contact')}>Contact support</Button>
              </div>
            }
          />
        ) : (
          <div className="grid gap-8 lg:grid-cols-[1fr_280px]">
            <div>
              <FaqAccordion items={filtered.map((faq) => ({ id: faq.id, question: faq.question, answer: faq.answer, category: faq.category }))} />
            </div>
            <aside className="space-y-4">
              <Card>
                <CardContent>
                  <p className="text-sm font-semibold text-foreground">Most read</p>
                  <ul className="mt-2 space-y-2">
                    {popular.map((faq) => (
                      <li key={faq.id}>
                        <button type="button" onClick={() => setQuery(faq.question.split(' ').slice(0, 4).join(' '))} className="text-left text-sm text-primary hover:underline">
                          {faq.question}
                        </button>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
              <Card>
                <CardContent>
                  <p className="text-sm font-semibold text-foreground">Still stuck?</p>
                  <p className="mt-1 text-xs text-muted-foreground">Support answers within one business day. Business plans within four hours.</p>
                  <Button size="sm" className="mt-3 w-full" onClick={() => navigate('/contact')}>
                    Contact support
                  </Button>
                  <Button size="sm" variant="outline" className="mt-2 w-full" onClick={() => navigate('/how-it-works')}>
                    Read how it works
                  </Button>
                </CardContent>
              </Card>
              <Card>
                <CardContent>
                  <p className="text-sm font-semibold text-foreground">Legal</p>
                  <ul className="mt-2 space-y-1.5 text-sm">
                    {[
                      ['Terms of service', '/terms'],
                      ['Privacy policy', '/privacy'],
                      ['Refund policy', '/refund-policy'],
                      ['Copyright & DMCA', '/copyright'],
                      ['Community guidelines', '/community-guidelines'],
                    ].map(([label, href]) => (
                      <li key={href}>
                        <button type="button" onClick={() => navigate(href)} className="text-primary hover:underline">
                          {label}
                        </button>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </aside>
          </div>
        )}
      </Section>

      <Section>
        <CtaBand
          title="Try it instead of reading about it"
          description="The demo account is fully populated: books in every state, sales, reviews and a publishing submission mid-flow."
          primaryLabel="Open the demo workspace"
          primaryHref="/login?demo=1"
          secondaryLabel="Browse templates"
          secondaryHref="/templates"
        />
      </Section>
    </>
  );
}
