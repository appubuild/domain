import * as React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTemplates, useTemplateCategories } from '@/hooks/queries';
import { useAuth } from '@/providers/AuthProvider';
import { templateService } from '@/services';
import { useToast } from '@/components/ui/toast';
import { Seo } from '@/components/shared/Seo';
import { TemplateCard } from '@/components/shared/BookCard';
import { Section, SectionHeading, CtaBand, BreadcrumbBar } from '@/components/shared/sections';
import { Badge, Button, Input, Select, Skeleton } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/overlays';
import { EmptyState, ErrorState } from '@/components/ui/data';
import { cn } from '@/lib/utils';
import type { Template } from '@/types/domain';

const SORTS = [
  { value: 'popular', label: 'Most used' },
  { value: 'newest', label: 'Newest' },
  { value: 'rating', label: 'Highest rated' },
  { value: 'pages', label: 'Most pages' },
  { value: 'name', label: 'A–Z' },
] as const;

export default function TemplatesPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, entitlements, isAuthenticated } = useAuth();
  const { success, error: errorToast } = useToast();

  const [query, setQuery] = React.useState('');
  const [categoryId, setCategoryId] = React.useState(params.get('category') ?? 'all');
  const [sort, setSort] = React.useState<(typeof SORTS)[number]['value']>('popular');
  const [premium, setPremium] = React.useState<'all' | 'free' | 'premium'>('all');
  const [previewTemplate, setPreviewTemplate] = React.useState<Template | null>(null);
  const [creating, setCreating] = React.useState(false);

  const { data: categories } = useTemplateCategories();
  const { data: templates, isLoading, isError, refetch } = useTemplates({
    query: query || undefined,
    categoryIds: categoryId === 'all' ? undefined : [categoryId],
    premium: premium === 'all' ? 'all' : premium === 'premium',
    sort,
    published: true,
  });

  const previewPages = React.useMemo(() => (previewTemplate ? templateService.preview(previewTemplate.id) : []), [previewTemplate]);

  const handleUse = async (template: Template) => {
    if (!user) {
      navigate(`/login?next=/templates`);
      return;
    }
    if (!entitlements.canCreateBook()) {
      errorToast('Book limit reached', entitlements.upgradeReason('book') ?? 'Upgrade your plan to create more books.');
      navigate('/dashboard/subscription');
      return;
    }
    if (template.premium && !entitlements.canUsePremiumTemplates) {
      errorToast('Premium template', 'This template needs the Pro plan or above.');
      navigate('/dashboard/subscription');
      return;
    }
    setCreating(true);
    try {
      const { book } = await templateService.use(template.id, user.id, user.name, `${template.name} project`);
      success('Book created from template', `“${book.title}” is ready in your workspace.`);
      navigate(`/dashboard/books/${book.id}/editor`);
    } catch (caught) {
      errorToast('Could not use that template', caught instanceof Error ? caught.message : undefined);
    } finally {
      setCreating(false);
    }
  };

  const handleFavorite = async (template: Template) => {
    if (!user) {
      navigate('/login?next=/templates');
      return;
    }
    await templateService.toggleFavorite(template.id);
    success('Favourites updated', `${template.name} was ${template.featured ? 'added to' : 'removed from'} your favourites.`);
  };

  return (
    <>
      <Seo
        title="Book templates — 22 professional interiors and covers"
        description="Browse book templates by category, style, trim size and page count. Preview the layout, mark favourites, and start a book from any template in one click."
        canonical="/templates"
        keywords={['book templates', 'interior layout template', 'kdp template', 'ebook template']}
      />
      <section className="border-b border-border bg-muted/40 py-10">
        <div className="container">
          <BreadcrumbBar items={[{ label: 'Home', href: '/' }, { label: 'Templates' }]} />
          <SectionHeading
            eyebrow="Templates"
            title="Start from a layout that already fits your genre"
            description="Every template carries a trim size, typography pairing, structure and palette — so the first page you write is already correctly designed."
            align="left"
          />
        </div>
      </section>

      <Section>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[220px] flex-1">
              <label htmlFor="template-search" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Search templates
              </label>
              <Input
                id="template-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by name, style, tag or genre…"
              />
            </div>
            <div className="w-[180px]">
              <label htmlFor="template-sort" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Sort
              </label>
              <Select id="template-sort" value={sort} onChange={(event) => setSort(event.target.value as (typeof SORTS)[number]['value'])}>
                {SORTS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="w-[160px]">
              <label htmlFor="template-price" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Access
              </label>
              <Select id="template-price" value={premium} onChange={(event) => setPremium(event.target.value as 'all' | 'free' | 'premium')}>
                <option value="all">All templates</option>
                <option value="free">Free only</option>
                <option value="premium">Premium only</option>
              </Select>
            </div>
            {(query || categoryId !== 'all' || premium !== 'all') && (
              <Button
                variant="ghost"
                onClick={() => {
                  setQuery('');
                  setCategoryId('all');
                  setPremium('all');
                  setParams({});
                }}
              >
                Clear filters
              </Button>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setCategoryId('all');
                setParams({});
              }}
              className={cn(
                'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                categoryId === 'all' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/40',
              )}
            >
              All categories
            </button>
            {(categories ?? []).map(({ category, count }) => (
              <button
                key={category.id}
                type="button"
                onClick={() => {
                  setCategoryId(category.id);
                  setParams({ category: category.id });
                }}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                  categoryId === category.id ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/40',
                )}
              >
                {category.name}
                <span className="ml-1.5 text-2xs opacity-70">{count}</span>
              </button>
            ))}
          </div>

          <p className="text-xs text-muted-foreground">
            {isLoading ? 'Loading templates…' : `${templates?.length ?? 0} templates${categoryId !== 'all' ? ' in this category' : ''}`}
            {!isAuthenticated && ' · sign in to save favourites and start a book'}
          </p>

          {isError ? (
            <ErrorState title="Templates could not load" description="The template library did not respond." onRetry={() => refetch()} />
          ) : isLoading ? (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, index) => (
                <Skeleton key={index} className="h-80 rounded-xl" />
              ))}
            </div>
          ) : !templates?.length ? (
            <EmptyState
              icon="▦"
              title="No templates match those filters"
              description="Try clearing the category or turning off the premium filter."
              actions={
                <Button
                  variant="outline"
                  onClick={() => {
                    setQuery('');
                    setCategoryId('all');
                    setPremium('all');
                  }}
                >
                  Reset filters
                </Button>
              }
            />
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {templates.map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  onUse={() => handleUse(template)}
                  onPreview={() => setPreviewTemplate(template)}
                  onFavorite={() => handleFavorite(template)}
                  favorite={template.featured}
                />
              ))}
            </div>
          )}
        </div>
      </Section>

      <Section tone="muted">
        <SectionHeading eyebrow="Categories" title="Twenty-one genres, all with correct geometry" description="Cookbooks need bleed and colour; novels need cream paper and a quiet typeface. Templates encode both." />
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {(categories ?? []).map(({ category, count }) => (
            <button
              key={category.id}
              type="button"
              onClick={() => setCategoryId(category.id)}
              className="rounded-xl border border-border bg-card px-3.5 py-3 text-left transition-colors hover:border-primary/40"
            >
              <p className="text-sm font-medium text-foreground">{category.name}</p>
              <p className="text-2xs text-muted-foreground">{count} templates</p>
            </button>
          ))}
        </div>
      </Section>

      <Section>
        <CtaBand
          title="Or start completely blank"
          description="Set your own trim size, margins and type. Every template is a starting point, never a cage."
          primaryLabel="Create a blank book"
          primaryHref="/dashboard/books/new"
          secondaryLabel="See pricing"
          secondaryHref="/pricing"
        />
      </Section>

      <Modal
        open={Boolean(previewTemplate)}
        onOpenChange={(open) => !open && setPreviewTemplate(null)}
        title={previewTemplate?.name}
        description={previewTemplate ? `${previewTemplate.style} · ${previewTemplate.trimSize.label} · ${previewTemplate.pageCount} pages` : undefined}
        size="lg"
        footer={
          previewTemplate && (
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => setPreviewTemplate(null)}>
                Close
              </Button>
              <Button loading={creating} onClick={() => handleUse(previewTemplate)}>
                Use this template
              </Button>
            </div>
          )
        }
      >
        {previewTemplate && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{previewTemplate.kind.replace('-', ' ')}</Badge>
              <Badge variant="outline">{previewTemplate.language}</Badge>
              {previewTemplate.premium ? <Badge variant="accent">Premium</Badge> : <Badge variant="success">Free</Badge>}
              {previewTemplate.tags.map((tag) => (
                <Badge key={tag} variant="secondary">
                  #{tag}
                </Badge>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">{previewTemplate.description}</p>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ['Trim size', previewTemplate.trimSize.label],
                ['Pages', String(previewTemplate.pageCount)],
                ['Heading font', previewTemplate.headingFont],
                ['Body font', previewTemplate.bodyFont],
                ['Palette', previewTemplate.palette],
                ['Rating', `${previewTemplate.rating.toFixed(1)} / 5`],
                ['Uses', previewTemplate.uses.toLocaleString()],
                ['Language', previewTemplate.language],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-border bg-muted/40 px-3 py-2">
                  <dt className="text-2xs uppercase tracking-wide text-muted-foreground">{label}</dt>
                  <dd className="text-sm font-medium text-foreground">{value}</dd>
                </div>
              ))}
            </dl>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Layout preview</p>
              <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin">
                {previewPages.map((page) => (
                  <div key={page.id} className="w-[150px] shrink-0 rounded-lg border border-border bg-white p-3 shadow-soft">
                    <p className="text-[9px] uppercase tracking-widest text-slate-400">{page.kind}</p>
                    <p className="mt-1 text-[11px] font-semibold text-slate-800">{page.label}</p>
                    <div className="mt-2 space-y-1">
                      {page.lines.slice(1).map((line, index) => (
                        <p key={index} className={index === 0 ? 'text-[8px] text-slate-400' : 'text-[7px] leading-relaxed text-slate-400'}>
                          {line}
                        </p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Structure</p>
              <ol className="space-y-1.5">
                {previewTemplate.structure.map((row, index) => (
                  <li key={`${row.title}-${index}`} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                    <span className="text-foreground">
                      {index + 1}. {row.title}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {row.kind.replace('-', ' ')} · {row.pages}p
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
