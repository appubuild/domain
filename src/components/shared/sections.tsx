import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Button, Card, CardContent, Rating, Avatar } from '@/components/ui/primitives';
import { Accordion } from '@/components/ui/data';

export function Section({
  children,
  className,
  id,
  tone = 'default',
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
  tone?: 'default' | 'muted' | 'dark' | 'paper';
}) {
  return (
    <section
      id={id}
      className={cn(
        'py-14 sm:py-20',
        tone === 'muted' && 'bg-muted/50',
        tone === 'dark' && 'bg-slate-950 text-slate-100',
        tone === 'paper' && 'bg-paper',
        className,
      )}
    >
      <div className="container">{children}</div>
    </section>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = 'center',
  invert,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  align?: 'center' | 'left';
  invert?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('max-w-3xl', align === 'center' ? 'mx-auto text-center' : '', className)}>
      {eyebrow && (
        <p className={cn('mb-2 text-xs font-semibold uppercase tracking-[0.18em]', invert ? 'text-primary-foreground/70' : 'text-primary')}>{eyebrow}</p>
      )}
      <h2 className={cn('font-display text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl', invert ? 'text-white' : 'text-foreground')}>{title}</h2>
      {description && <p className={cn('mt-3 text-sm leading-relaxed sm:text-base', invert ? 'text-slate-300' : 'text-muted-foreground')}>{description}</p>}
    </div>
  );
}

export function FeatureGrid({
  items,
  columns = 3,
}: {
  items: { icon?: string; title: string; body: string }[];
  columns?: 2 | 3 | 4;
}) {
  return (
    <div className={cn('mt-10 grid gap-5', columns === 2 && 'sm:grid-cols-2', columns === 3 && 'sm:grid-cols-2 lg:grid-cols-3', columns === 4 && 'sm:grid-cols-2 lg:grid-cols-4')}>
      {items.map((item) => (
        <Card key={item.title} className="h-full">
          <CardContent>
            {item.icon && (
              <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-lg text-primary" aria-hidden>
                {item.icon}
              </span>
            )}
            <h3 className="text-sm font-semibold text-foreground">{item.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function CtaBand({
  title,
  description,
  primaryLabel = 'Start writing free',
  primaryHref = '/register',
  secondaryLabel = 'Explore templates',
  secondaryHref = '/templates',
}: {
  title: string;
  description: string;
  primaryLabel?: string;
  primaryHref?: string;
  secondaryLabel?: string;
  secondaryHref?: string;
}) {
  const navigate = useNavigate();
  return (
    <div className="relative overflow-hidden rounded-2xl bg-brand-gradient px-6 py-12 text-center shadow-lift sm:px-12">
      <div className="bg-mesh pointer-events-none absolute inset-0 opacity-40" aria-hidden />
      <div className="relative">
        <h2 className="font-display text-2xl font-bold text-white sm:text-3xl">{title}</h2>
        <p className="mx-auto mt-3 max-w-2xl text-sm text-white/80 sm:text-base">{description}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button variant="secondary" size="lg" onClick={() => navigate(primaryHref)}>
            {primaryLabel}
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="border-white/40 bg-transparent text-white hover:bg-white/10 hover:text-white"
            onClick={() => navigate(secondaryHref)}
          >
            {secondaryLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function StatsRow({ stats }: { stats: { label: string; value: string }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-6 sm:grid-cols-4">
      {stats.map((stat) => (
        <div key={stat.label}>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">{stat.label}</dt>
          <dd className="mt-1 font-display text-2xl font-bold text-foreground sm:text-3xl">{stat.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function TestimonialCard({
  quote,
  name,
  role,
  avatarUrl,
  rating = 5,
}: {
  quote: string;
  name: string;
  role: string;
  avatarUrl?: string;
  rating?: number;
}) {
  return (
    <Card className="h-full">
      <CardContent className="flex h-full flex-col">
        <Rating value={rating} />
        <blockquote className="mt-3 flex-1 text-sm leading-relaxed text-foreground">“{quote}”</blockquote>
        <div className="mt-4 flex items-center gap-3 border-t border-border pt-4">
          <Avatar name={name} src={avatarUrl} size={36} />
          <div>
            <p className="text-sm font-medium text-foreground">{name}</p>
            <p className="text-xs text-muted-foreground">{role}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function FaqAccordion({ items }: { items: { id: string; question: string; answer: string; category?: string }[] }) {
  const groups = React.useMemo(() => {
    const map = new Map<string, typeof items>();
    items.forEach((item) => {
      const key = item.category ?? 'General';
      map.set(key, map.get(key) ? [...(map.get(key) as typeof items), item] : [item]);
    });
    return Array.from(map.entries());
  }, [items]);

  return (
    <div className="space-y-8">
      {groups.map(([category, groupItems]) => (
        <div key={category}>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{category}</h3>
          <Accordion
            items={groupItems.map((item) => ({
              id: item.id,
              title: item.question,
              content: <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{item.answer}</p>,
            }))}
          />
        </div>
      ))}
    </div>
  );
}

export function ComparisonTable({
  columns,
  rows,
}: {
  columns: string[];
  rows: { label: string; values: (string | boolean)[] }[];
}) {
  return (
    <div className="mt-8 overflow-x-auto">
      <table className="w-full min-w-[560px] border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 bg-background px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Capability</th>
            {columns.map((column) => (
              <th key={column} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.label} className={index % 2 ? 'bg-muted/40' : ''}>
              <th scope="row" className="sticky left-0 bg-inherit px-4 py-3 text-left font-medium text-foreground">
                {row.label}
              </th>
              {row.values.map((value, valueIndex) => (
                <td key={`${row.label}-${valueIndex}`} className="px-4 py-3 text-muted-foreground">
                  {typeof value === 'boolean' ? (
                    <span className={value ? 'text-success' : 'text-muted-foreground/60'} aria-label={value ? 'Included' : 'Not included'}>
                      {value ? '✓' : '—'}
                    </span>
                  ) : (
                    value
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LogoCloud({ items }: { items: { name: string; meta: string }[] }) {
  return (
    <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
      {items.map((item) => (
        <div key={item.name} className="rounded-xl border border-border bg-card px-4 py-3 text-center">
          <p className="text-sm font-semibold text-foreground">{item.name}</p>
          <p className="text-2xs text-muted-foreground">{item.meta}</p>
        </div>
      ))}
    </div>
  );
}

export function BreadcrumbBar({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="container flex items-center gap-1.5 py-4 text-xs text-muted-foreground">
      {items.map((item, index) => (
        <React.Fragment key={item.label}>
          {index > 0 && <span className="opacity-50">/</span>}
          {item.href ? (
            <Link to={item.href} className="transition-colors hover:text-foreground">
              {item.label}
            </Link>
          ) : (
            <span className="text-foreground">{item.label}</span>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
}
