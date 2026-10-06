import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  BookOpen, Check, Crown, Eye, Heart, Layers, Loader2, Plus, Search, Share2, Sparkles, Star, Wand2,
} from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Separator } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/overlays';
import { EmptyState, Pagination, StatCard } from '@/components/ui/data';
import { useToast } from '@/components/ui/toast';
import { useTemplateCategories, useTemplates } from '@/hooks/queries';
import { templateService } from '@/services';
import { useAuth } from '@/providers/AuthProvider';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { BookKind, Template } from '@/types/domain';

export default function TemplatesDashboardPage() {
  const { user, entitlements } = useAuth();
  const { success, error, warning } = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [query, setQuery] = React.useState('');
  const [categoryId, setCategoryId] = React.useState('all');
  const [kind, setKind] = React.useState<'all' | BookKind>('all');
  const [premium, setPremium] = React.useState<'all' | 'free' | 'premium'>('all');
  const [sort, setSort] = React.useState<'popular' | 'newest' | 'rating' | 'pages'>('popular');
  const [favOnly, setFavOnly] = React.useState(false);
  const [preview, setPreview] = React.useState<Template | null>(null);
  const [creating, setCreating] = React.useState<string | null>(null);
  const [page, setPage] = React.useState(1);
  const perPage = 12;

  const { data: categories } = useTemplateCategories();
  const { data: templates, isLoading } = useTemplates({
    query: query || undefined,
    categoryIds: categoryId === 'all' ? undefined : [categoryId],
    kind: kind === 'all' ? undefined : kind,
    premium: premium === 'all' ? undefined : premium === 'premium',
    sort,
    published: true,
  });
  const { data: allTemplates } = useTemplates({ published: true });

  const rows = React.useMemo(() => {
    const list = (templates ?? []).filter((template) => !favOnly || template.featured);
    return list;
  }, [templates, favOnly]);

  const pageCount = Math.max(1, Math.ceil(rows.length / perPage));
  const visible = rows.slice((page - 1) * perPage, page * perPage);
  const previewPages = preview ? templateService.preview(preview.id) : [];

  const useTemplate = async (template: Template) => {
    if (!user) return;
    if (template.premium && !entitlements.canUsePremiumTemplates()) {
      warning('Premium template', 'Upgrade to Pro to start from premium designs.');
      return;
    }
    if (!entitlements.canCreateBook()) {
      warning('Book limit reached', entitlements.upgradeReason('book'));
      return;
    }
    setCreating(template.id);
    try {
      const { book, createdPages } = await templateService.use(template.id, user.id, user.name);
      qc.invalidateQueries();
      success(`${book.title} created`, `${createdPages} pages set up from ${template.name}.`);
      navigate(`/dashboard/books/${book.id}/editor`);
    } catch (e) {
      error('Could not use template', (e as Error).message);
    } finally {
      setCreating(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-semibold tracking-tight">Templates</h1>
          <p className="text-sm text-muted-foreground">Professionally structured starting points — every layout is fully editable.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate('/templates')}>
            <Eye className="h-4 w-4" /> Public gallery
          </Button>
          <Button size="sm" onClick={() => navigate('/dashboard/books/new')}>
            <Plus className="h-4 w-4" /> New book
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Templates" value={formatNumber(allTemplates?.length ?? 0)} hint={`${categories?.length ?? 0} categories`} icon={<Layers className="h-4 w-4" />} />
        <StatCard label="Free to use" value={formatNumber((allTemplates ?? []).filter((template) => !template.premium).length)} hint="Included on every plan" icon={<BookOpen className="h-4 w-4" />} />
        <StatCard label="Premium" value={formatNumber((allTemplates ?? []).filter((template) => template.premium).length)} hint={entitlements.canUsePremiumTemplates() ? 'Unlocked on your plan' : 'Requires Pro'} icon={<Crown className="h-4 w-4" />} tone={entitlements.canUsePremiumTemplates() ? 'success' : 'warning'} />
        <StatCard label="Most used" value={(allTemplates ?? []).slice().sort((a, b) => b.uses - a.uses)[0]?.name ?? '—'} hint={`${formatNumber((allTemplates ?? []).slice().sort((a, b) => b.uses - a.uses)[0]?.uses ?? 0)} projects started`} icon={<Star className="h-4 w-4" />} />
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base">Browse</CardTitle>
            <CardDescription>{rows.length} templates match your filters</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search templates" className="h-9 w-[200px] pl-8" aria-label="Search templates" />
            </div>
            <select value={kind} onChange={(event) => { setKind(event.target.value as 'all' | BookKind); setPage(1); }} className="h-9 rounded-md border border-input bg-background px-3 text-sm" aria-label="Filter by book type">
              <option value="all">All types</option>
              {['fiction', 'nonfiction', 'workbook', 'journal', 'planner', 'cookbook', 'textbook', 'biography', 'poetry', 'children'].map((entry) => (
                <option key={entry} value={entry}>{entry[0].toUpperCase() + entry.slice(1)}</option>
              ))}
            </select>
            <select value={premium} onChange={(event) => { setPremium(event.target.value as typeof premium); setPage(1); }} className="h-9 rounded-md border border-input bg-background px-3 text-sm" aria-label="Filter by plan">
              <option value="all">Free & premium</option>
              <option value="free">Free only</option>
              <option value="premium">Premium only</option>
            </select>
            <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} className="h-9 rounded-md border border-input bg-background px-3 text-sm" aria-label="Sort templates">
              <option value="popular">Most used</option>
              <option value="newest">Newest</option>
              <option value="rating">Highest rated</option>
              <option value="pages">Most pages</option>
            </select>
            <Button variant={favOnly ? 'secondary' : 'outline'} size="sm" onClick={() => setFavOnly((value) => !value)}>
              <Sparkles className="h-4 w-4" /> Featured
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant={categoryId === 'all' ? 'secondary' : 'ghost'} size="xs" onClick={() => { setCategoryId('all'); setPage(1); }}>All categories</Button>
            {(categories ?? []).map((entry) => (
              <Button key={entry.category.id} variant={categoryId === entry.category.id ? 'secondary' : 'ghost'} size="xs" onClick={() => { setCategoryId(entry.category.id); setPage(1); }}>
                {entry.category.name} <span className="ml-1 text-muted-foreground">{entry.count}</span>
              </Button>
            ))}
          </div>

          {isLoading && <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{Array.from({ length: 8 }).map((_, index) => <div key={index} className="h-72 animate-pulse rounded-xl bg-muted" />)}</div>}

          {!isLoading && rows.length === 0 && (
            <EmptyState
              icon={<Search className="h-5 w-5" />}
              title="No templates match"
              description="Try widening your filters, or start from a blank book instead."
              actions={<Button variant="outline" size="sm" onClick={() => { setQuery(''); setCategoryId('all'); setKind('all'); setPremium('all'); }}>Clear filters</Button>}
            />
          )}

          {!isLoading && rows.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {visible.map((template) => {
                const locked = template.premium && !entitlements.canUsePremiumTemplates();
                return (
                  <div key={template.id} className="group flex flex-col overflow-hidden rounded-xl border">
                    <button type="button" onClick={() => setPreview(template)} className="relative block h-[196px] overflow-hidden bg-muted/50 p-4 text-left">
                      <div className="mx-auto flex h-full max-w-[280px] gap-2">
                        {[0, 1, 2].map((offset) => (
                          <div key={offset} className="flex-1 overflow-hidden rounded-sm bg-card shadow-page transition-transform group-hover:-translate-y-1" style={{ transitionDelay: `${offset * 40}ms` }}>
                            <div className="h-full p-2" style={{ background: template.accentColor }}>
                              <div className="h-1.5 w-8 rounded-full bg-white/60" />
                              <div className="mt-2 space-y-1">
                                {Array.from({ length: 8 }).map((_, line) => <div key={line} className="h-1 rounded-full bg-white/30" style={{ width: `${60 + ((line * 13 + offset * 7) % 40)}%` }} />)}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                      {template.premium && <Badge variant="accent" className="absolute left-3 top-3 text-2xs"><Crown className="h-2.5 w-2.5" /> Premium</Badge>}
                      {template.featured && <Badge variant="info" className="absolute right-3 top-3 text-2xs">Featured</Badge>}
                    </button>
                    <div className="flex flex-1 flex-col gap-2 p-3">
                      <div>
                        <p className="truncate text-sm font-medium">{template.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{template.style} · {template.trimSize.label}</p>
                      </div>
                      <p className="line-clamp-2 text-xs text-muted-foreground">{template.description}</p>
                      <div className="flex items-center gap-2 text-2xs text-muted-foreground">
                        <span>{template.pageCount} pages</span>·<span>{template.structure.length} sections</span>·
                        <span className="inline-flex items-center gap-0.5"><Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" />{template.rating.toFixed(1)}</span>
                      </div>
                      <div className="mt-auto flex items-center gap-1.5">
                        <Button size="xs" className="flex-1" disabled={creating === template.id} onClick={() => useTemplate(template)}>
                          {creating === template.id ? <Loader2 className="h-3 w-3 animate-spin" /> : locked ? <Crown className="h-3 w-3" /> : <Wand2 className="h-3 w-3" />}
                          {locked ? 'Upgrade' : 'Use template'}
                        </Button>
                        <Button variant="outline" size="xs" onClick={() => setPreview(template)} aria-label={`Preview ${template.name}`}><Eye className="h-3 w-3" /></Button>
                        <Button
                          variant="ghost"
                          size="xs"
                          aria-label={`Share ${template.name}`}
                          onClick={() => { void navigator.clipboard?.writeText(`${window.location.origin}/templates?template=${template.id}`); success('Share link copied'); }}
                        >
                          <Share2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {rows.length > perPage && <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />}
        </CardContent>
      </Card>

      <Modal
        open={Boolean(preview)}
        onOpenChange={(open) => !open && setPreview(null)}
        title={preview?.name ?? 'Template preview'}
        description={preview ? `${preview.style} · ${preview.pageCount} pages · ${preview.trimSize.label} · ${preview.headingFont} / ${preview.bodyFont}` : undefined}
        size="xl"
        footer={
          <>
            <Button variant="outline" onClick={() => setPreview(null)}>Close</Button>
            <Button
              variant="outline"
              onClick={() => { if (preview) success('Added to favourites', preview.name); }}
            >
              <Heart className="h-4 w-4" /> Favourite
            </Button>
            <Button onClick={() => preview && useTemplate(preview)} disabled={creating === preview?.id}>
              {creating === preview?.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />} Use this template
            </Button>
          </>
        }
      >
        {preview && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="secondary">{preview.kind}</Badge>
              <Badge variant="outline">{preview.trimSize.label}</Badge>
              <Badge variant="outline">{preview.pageCount} pages</Badge>
              {preview.tags.map((tag) => <Badge key={tag} variant="outline" className="text-2xs">{tag}</Badge>)}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {previewPages.slice(0, 8).map((entry) => (
                <div key={entry.id} className="overflow-hidden rounded-lg border bg-card">
                  <div className="flex h-[160px] flex-col gap-1 p-3" style={{ borderTop: `3px solid ${preview.accentColor}` }}>
                    <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{entry.kind}</p>
                    <p className="truncate text-xs font-medium">{entry.label}</p>
                    <div className="mt-1 space-y-1">
                      {Array.from({ length: 7 }).map((_, line) => <div key={line} className="h-1 rounded-full bg-muted" style={{ width: `${65 + ((line * 11) % 30)}%` }} />)}
                    </div>
                  </div>
                  <div className="border-t px-2 py-1.5">
                    <p className="truncate text-2xs text-muted-foreground">{entry.label}</p>
                  </div>
                </div>
              ))}
            </div>
            <Separator />
            <div className="grid gap-3 sm:grid-cols-3 text-xs">
              <div><p className="text-muted-foreground">Structure</p><p>{preview.structure.map((row) => `${row.pages}p ${row.title}`).join(' · ')}</p></div>
              <div><p className="text-muted-foreground">Typography</p><p>{preview.headingFont} headings, {preview.bodyFont} body</p></div>
              <div><p className="text-muted-foreground">Used by</p><p>{formatNumber(preview.uses)} authors · rated {preview.rating.toFixed(1)}</p></div>
            </div>
            {preview.premium && !entitlements.canUsePremiumTemplates() && (
              <div className="flex items-center gap-2 rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                <Crown className="h-4 w-4" /> Premium template — upgrade to Pro to start from this design.
                <Button variant="outline" size="xs" onClick={() => navigate('/dashboard/subscription')}>See plans</Button>
              </div>
            )}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Check className="h-3.5 w-3.5 text-emerald-500" /> Every page is editable — replace text, images and layouts freely.
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
