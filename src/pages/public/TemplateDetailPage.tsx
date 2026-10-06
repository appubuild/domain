import * as React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTemplates } from '@/hooks/queries';
import { useAuth } from '@/providers/AuthProvider';
import { templateService } from '@/services';
import { useToast } from '@/components/ui/toast';
import { Seo } from '@/components/shared/Seo';
import { TemplateCard } from '@/components/shared/BookCard';
import { Section, SectionHeading, BreadcrumbBar } from '@/components/shared/sections';
import { Badge, Button, Card, CardContent, Rating, Skeleton } from '@/components/ui/primitives';
import { ErrorState } from '@/components/ui/data';
import { Modal } from '@/components/ui/overlays';
import { cn } from '@/lib/utils';

export default function TemplateDetailPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { user, entitlements } = useAuth();
  const { success, error: errorToast } = useToast();
  const { data: templates, isLoading } = useTemplates({ published: true });
  const template = (templates ?? []).find((entry) => entry.slug === slug);
  const [creating, setCreating] = React.useState(false);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [pageIndex, setPageIndex] = React.useState(0);

  const previewPages = React.useMemo(() => (template ? templateService.preview(template.id) : []), [template]);
  const related = (templates ?? []).filter((entry) => entry.id !== template?.id && entry.categoryId === template?.categoryId).slice(0, 3);

  if (isLoading) {
    return (
      <div className="container grid gap-8 py-10 lg:grid-cols-2">
        <Skeleton className="h-[520px] rounded-xl" />
        <div className="space-y-4">
          <Skeleton className="h-9 w-1/2" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (!template) {
    return (
      <div className="container py-16">
        <ErrorState title="Template not found" description="That template may have been retired. Browse the current library instead." />
        <div className="mt-4 flex justify-center">
          <Button onClick={() => navigate('/templates')}>Browse templates</Button>
        </div>
      </div>
    );
  }

  const use = async () => {
    if (!user) {
      navigate('/login?next=/templates/' + template.slug);
      return;
    }
    if (!entitlements.canCreateBook()) {
      errorToast('Book limit reached', entitlements.upgradeReason('book'));
      navigate('/dashboard/subscription');
      return;
    }
    if (template.premium && !entitlements.canUsePremiumTemplates) {
      errorToast('Premium template', 'Upgrade to Pro to use premium interiors.');
      navigate('/dashboard/subscription');
      return;
    }
    setCreating(true);
    try {
      const { book } = await templateService.use(template.id, user.id, user.name, `${template.name} book`);
      success('Book created', `“${book.title}” is open in your workspace.`);
      navigate(`/dashboard/books/${book.id}/editor`);
    } catch (caught) {
      errorToast('Could not create the book', caught instanceof Error ? caught.message : undefined);
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <Seo
        title={`${template.name} book template`}
        description={template.description}
        canonical={`/templates/${template.slug}`}
        keywords={[...template.tags, template.style, template.kind]}
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'Product',
          name: `${template.name} book template`,
          description: template.description,
          brand: { '@type': 'Brand', name: 'Scriptora' },
        }}
      />
      <div className="container">
        <BreadcrumbBar
          items={[{ label: 'Home', href: '/' }, { label: 'Templates', href: '/templates' }, { label: template.name }]}
        />
      </div>

      <div className="container grid gap-8 pb-8 lg:grid-cols-[1.1fr_1fr]">
        <div className="rounded-2xl border border-border bg-muted/40 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Layout preview</p>
              <p className="text-sm text-foreground">
                {previewPages[pageIndex]?.label} · {previewPages[pageIndex]?.kind}
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={pageIndex === 0} onClick={() => setPageIndex((index) => index - 1)}>
                Previous
              </Button>
              <Button size="sm" variant="outline" disabled={pageIndex >= previewPages.length - 1} onClick={() => setPageIndex((index) => index + 1)}>
                Next
              </Button>
            </div>
          </div>
          <div className="mt-4 flex justify-center">
            <div className="w-full max-w-[420px] rounded-lg bg-white p-8 shadow-page ring-1 ring-border">
              <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">{previewPages[pageIndex]?.kind}</p>
              <h3 className="mt-2 font-serif text-lg font-semibold text-slate-800">{previewPages[pageIndex]?.label}</h3>
              <div className="mt-4 space-y-2">
                {(previewPages[pageIndex]?.lines ?? []).map((line, index) => (
                  <p key={index} className={index === 0 ? 'text-xs text-slate-500' : 'text-[10px] leading-relaxed text-slate-400'}>
                    {index === 1 ? '· · ·' : line}
                  </p>
                ))}
              </div>
              <p className="mt-6 text-center text-[10px] text-slate-400">{pageIndex + 1}</p>
            </div>
          </div>
          <div className="mt-4 flex justify-center gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
            {previewPages.map((page, index) => (
              <button
                key={page.id}
                type="button"
                onClick={() => setPageIndex(index)}
                aria-label={`Preview ${page.label}`}
                className={cn(
                  'flex h-16 w-11 shrink-0 items-center justify-center rounded border text-[8px] transition-colors',
                  index === pageIndex ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-white text-slate-400',
                )}
              >
                {index + 1}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{template.kind.replace('-', ' ')}</Badge>
            <Badge variant="outline">{template.style}</Badge>
            {template.premium ? <Badge variant="accent">Premium</Badge> : <Badge variant="success">Free</Badge>}
            {template.featured && <Badge variant="info">Featured</Badge>}
          </div>
          <h1 className="mt-3 font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{template.name}</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{template.description}</p>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <Rating value={template.rating} count={Math.round(template.uses / 12)} />
            <span className="text-sm text-muted-foreground">{template.uses.toLocaleString()} authors used this</span>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button size="lg" loading={creating} onClick={use}>
              Use this template
            </Button>
            <Button size="lg" variant="outline" onClick={() => setPreviewOpen(true)}>
              Full preview
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={async () => {
                if (!user) return navigate('/login?next=/templates/' + template.slug);
                await templateService.toggleFavorite(template.id);
                success('Favourites updated', template.name);
              }}
            >
              ♡ Favourite
            </Button>
            <Button
              size="lg"
              variant="ghost"
              onClick={() => {
                void navigator.clipboard?.writeText(`${window.location.origin}/templates/${template.slug}`);
                success('Link copied');
              }}
            >
              Share
            </Button>
          </div>

          <dl className="mt-6 grid grid-cols-2 gap-3">
            {[
              ['Trim size', `${template.trimSize.label} (${template.trimSize.widthIn}×${template.trimSize.heightIn}in)`],
              ['Page count', `${template.pageCount} pages`],
              ['Language', template.language],
              ['Palette', template.palette],
              ['Heading font', template.headingFont],
              ['Body font', template.bodyFont],
              ['Category', (template.tags[0] ?? 'General').replace(/-/g, ' ')],
              ['Tags', template.tagsLine],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-border bg-card px-3.5 py-2.5">
                <dt className="text-2xs uppercase tracking-wide text-muted-foreground">{label}</dt>
                <dd className="text-sm capitalize text-foreground">{value}</dd>
              </div>
            ))}
          </dl>

          <Card className="mt-5">
            <CardContent>
              <p className="text-sm font-semibold text-foreground">Included structure</p>
              <ol className="mt-3 space-y-1.5">
                {template.structure.map((row, index) => (
                  <li key={`${row.title}-${index}`} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                    <span className="text-foreground">
                      {index + 1}. {row.title}
                    </span>
                    <span className="text-xs capitalize text-muted-foreground">
                      {row.kind.replace('-', ' ')} · {row.pages}p
                    </span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>

      {related.length > 0 && (
        <Section tone="muted">
          <SectionHeading title="More templates in this category" align="left" />
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((entry) => (
              <TemplateCard
                key={entry.id}
                template={entry}
                onUse={() => navigate(`/templates/${entry.slug}`)}
                onPreview={() => navigate(`/templates/${entry.slug}`)}
              />
            ))}
          </div>
        </Section>
      )}

      <Modal
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        title={`${template.name} — full preview`}
        description={`${template.pageCount} pages · ${template.trimSize.label} · ${template.style}`}
        size="xl"
        footer={
          <Button loading={creating} onClick={use}>
            Use this template
          </Button>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {previewPages.map((page, index) => (
            <button
              key={page.id}
              type="button"
              onClick={() => {
                setPageIndex(index);
                setPreviewOpen(false);
              }}
              className="rounded-lg bg-white p-5 text-left shadow-soft ring-1 ring-border transition-shadow hover:shadow-card"
            >
              <p className="text-[9px] uppercase tracking-[0.25em] text-slate-400">{page.kind}</p>
              <p className="mt-1.5 font-serif text-sm font-semibold text-slate-800">{page.label}</p>
              <div className="mt-3 space-y-1.5">
                {page.lines.map((line, lineIndex) => (
                  <p key={lineIndex} className={lineIndex === 0 ? 'text-[9px] text-slate-500' : 'text-[8px] leading-relaxed text-slate-400'}>
                    {line}
                  </p>
                ))}
              </div>
            </button>
          ))}
        </div>
      </Modal>
    </>
  );
}
