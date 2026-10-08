import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlans, useFaqs } from '@/hooks/queries';
import { useAuth } from '@/providers/AuthProvider';
import { subscriptionService } from '@/services';
import { Seo } from '@/components/shared/Seo';
import { Section, SectionHeading, CtaBand, BreadcrumbBar, ComparisonTable, FaqAccordion } from '@/components/shared/sections';
import { Badge, Button, Card, CardContent, Skeleton, Switch } from '@/components/ui/primitives';
import { formatCurrency } from '@/lib/format';
import { cn } from '@/lib/utils';

export default function PricingPage() {
  const navigate = useNavigate();
  const { data: plans, isLoading } = usePlans();
  const { data: faqs } = useFaqs();
  const { isAuthenticated, entitlements } = useAuth();
  const [yearly, setYearly] = React.useState(false);
  const comparison = React.useMemo(() => subscriptionService.comparison(), []);

  const pricingFaqs = (faqs ?? []).filter((faq) => ['Billing', 'Plans'].includes(faq.category)).slice(0, 8);

  const choose = (slug: string) => {
    if (!isAuthenticated) {
      navigate(`/register?plan=${slug}`);
      return;
    }
    navigate(`/dashboard/subscription?plan=${slug}`);
  };

  return (
    <>
      <Seo
        title="Pricing — Free, Pro and Business"
        description="Start free with three books and full writing mode. Upgrade for print profiles, EPUB 3, premium templates, AI credits and marketplace selling."
        canonical="/pricing"
        keywords={['book software pricing', 'self publishing pricing', 'author subscription']}
      />
      <section className="border-b border-border bg-muted/40 py-12">
        <div className="container">
          <BreadcrumbBar items={[{ label: 'Home', href: '/' }, { label: 'Pricing' }]} />
          <SectionHeading
            eyebrow="Pricing"
            title="Pay when you publish, not while you write"
            description="Writing mode, three book projects and PDF export are free forever. Everything else unlocks when your book needs to leave the building."
          />
          <div className="mt-7 flex items-center justify-center gap-3">
            <span className={cn('text-sm', !yearly ? 'font-semibold text-foreground' : 'text-muted-foreground')}>Monthly</span>
            <Switch checked={yearly} onCheckedChange={setYearly} aria-label="Toggle yearly billing" />
            <span className={cn('text-sm', yearly ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
              Yearly <Badge variant="success" className="ml-1">2 months free</Badge>
            </span>
          </div>
        </div>
      </section>

      <Section>
        {isAuthenticated && (
          <div className="mb-6 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-foreground">
            You are on the <strong>{entitlements.plan.name}</strong> plan. Usage this month: {entitlements.usage.aiCredits.used} AI credits,{' '}
            {entitlements.usage.books.used} books.
          </div>
        )}
        {isLoading ? (
          <div className="grid gap-5 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-[520px] rounded-2xl" />
            ))}
          </div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-3">
            {(plans ?? []).map((plan) => {
              const price = yearly ? plan.priceYearly : plan.priceMonthly;
              const isCurrent = isAuthenticated && entitlements.plan.id === plan.id;
              return (
                <Card
                  key={plan.id}
                  className={cn(
                    'relative flex flex-col',
                    plan.highlight && 'border-primary shadow-card ring-1 ring-primary/30',
                  )}
                >
                  {plan.badge && <Badge variant="accent" className="absolute -top-3 left-5">{plan.badge}</Badge>}
                  <CardContent className="flex flex-1 flex-col">
                    <h3 className="font-display text-xl font-bold text-foreground">{plan.name}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{plan.tagline}</p>
                    <p className="mt-5">
                      <span className="font-display text-4xl font-bold text-foreground">
                        {price === 0 ? 'Free' : formatCurrency(price)}
                      </span>
                      {price > 0 && <span className="text-sm text-muted-foreground">{yearly ? ' / year' : ' / month'}</span>}
                    </p>
                    {price > 0 && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {yearly ? `${formatCurrency(Math.round(price / 12))} per month, billed yearly` : 'Billed monthly, cancel anytime'}
                      </p>
                    )}
                    <ul className="mt-6 flex-1 space-y-2.5">
                      {plan.marketingFeatures.map((feature) => (
                        <li key={feature} className="flex gap-2.5 text-sm text-muted-foreground">
                          <span className="mt-0.5 text-xs text-primary" aria-hidden>
                            ✓
                          </span>
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                    <dl className="mt-5 grid grid-cols-2 gap-2 border-t border-border pt-4 text-2xs">
                      <div>
                        <dt className="uppercase tracking-wide text-muted-foreground">Marketplace</dt>
                        <dd className="font-medium text-foreground">
                          {plan.features.marketplaceSelling ? `${Math.round((1 - plan.commissionRate) * 100)}% kept` : 'Not included'}
                        </dd>
                      </div>
                      <div>
                        <dt className="uppercase tracking-wide text-muted-foreground">Support</dt>
                        <dd className="font-medium capitalize text-foreground">{plan.features.support}</dd>
                      </div>
                    </dl>
                    <Button
                      className="mt-5 w-full"
                      variant={plan.highlight ? 'default' : 'outline'}
                      disabled={isCurrent}
                      onClick={() => choose(plan.slug)}
                    >
                      {isCurrent ? 'Your current plan' : price === 0 ? 'Start free' : `Choose ${plan.name}`}
                    </Button>
                    {plan.purchasable === false && <p className="mt-2 text-center text-2xs text-muted-foreground">Invite-only plan</p>}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Prices in USD, excluding local tax. This build models subscriptions locally — no card is ever charged.
        </p>
      </Section>

      <Section tone="muted">
        <SectionHeading eyebrow="Compare" title="Every limit, side by side" description="These are the same numbers the entitlement layer enforces in the product." />
        <div className="mt-8">
          <ComparisonTable columns={(plans ?? []).map((plan) => plan.name)} rows={comparison.rows} />
        </div>
      </Section>

      <Section>
        <SectionHeading eyebrow="Entitlements" title="How limits behave in the product" description="Friendly prompts instead of dead ends — you always keep what you have made." />
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {([
            ['Soft limits, clear prompts', 'Hitting a book or export limit opens a comparison panel with the exact feature that unlocks it. Nothing you created is removed.'],
            ['Downgrade safety', 'If you drop to a lower plan, existing books stay in your workspace. You simply cannot create more or use premium-only outputs.'],
            ['Server-enforced later', 'Entitlements are computed in a service layer today. When the backend arrives the same keys are checked on the API — no UI changes.'],
          ] as const).map(([title, body]) => (
            <Card key={title}>
              <CardContent>
                <p className="text-sm font-semibold text-foreground">{title}</p>
                <p className="mt-1.5 text-sm text-muted-foreground">{body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </Section>

      {pricingFaqs.length > 0 && (
        <Section tone="paper">
          <SectionHeading eyebrow="Billing FAQ" title="Subscriptions, refunds and cancellations" />
          <div className="mx-auto mt-8 max-w-3xl">
            <FaqAccordion items={pricingFaqs.map((faq) => ({ id: faq.id, question: faq.question, answer: faq.answer, category: faq.category }))} />
          </div>
          <div className="mt-6 text-center">
            <Button variant="ghost" onClick={() => navigate('/faq')}>
              All questions →
            </Button>
          </div>
        </Section>
      )}

      <Section>
        <CtaBand
          title="Start free, upgrade when you publish"
          description="The free plan is not a trial. Write three books, export PDFs, and decide later whether you need the print pipeline."
          primaryLabel="Create your account"
          secondaryLabel="Compare with other tools"
          secondaryHref="/features"
        />
      </Section>
    </>
  );
}
