import * as React from 'react';
import { Link } from 'react-router-dom';
import { Eye, FileText, Home, LayoutPanelTop, Save, Search, Trash2 } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Separator, Switch, Textarea } from '@/components/ui/primitives';
import { Modal, Tabs, useConfirm } from '@/components/ui/overlays';
import { EmptyState, StatCard } from '@/components/ui/data';
import { PageHeader } from '@/components/layout/AdminLayout';
import { useToast } from '@/components/ui/toast';
import { useBlogPosts, useCmsPages, useFaqs, useHomepage, usePromos, keys } from '@/hooks/queries';
import { cmsService } from '@/services';
import { formatDateTime, timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useAdminAction, Toolbar, FilterInput } from './shared';
import type { CmsPage, CmsSection } from '@/types/domain';
import { useQueryClient } from '@tanstack/react-query';

export default function AdminCmsPage() {
  const confirm = useConfirm();
  const { success } = useToast();
  const qc = useQueryClient();
  const { data: pages, isLoading, refetch } = useCmsPages();
  const { data: homepage } = useHomepage();
  const { data: posts } = useBlogPosts(true);
  const { data: faqs } = useFaqs();
  const { data: promos } = usePromos(true);
  const [query, setQuery] = React.useState('');
  const [editing, setEditing] = React.useState<CmsSection | null>(null);
  const [pageOpen, setPageOpen] = React.useState(false);
  const [newPage, setNewPage] = React.useState({ title: '', slug: '', showInNav: false });

  const saved = useAdminAction(
    ({ id, patch }: { id: string; patch: Partial<CmsSection> }) => { const result = cmsService.updateSection(id, patch); qc.invalidateQueries({ queryKey: keys.homepage }); return result; },
    { success: 'Section saved', detail: 'The public page updates immediately.', invalidate: [keys.homepage] },
  );

  const rows = ((pages ?? []) as CmsPage[]).filter((page) => !query || `${page.title} ${page.slug}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <div>
      <PageHeader title="CMS" description="Public site content: homepage sections, marketing pages, blog, FAQs and promotions — all editable live.">
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" onClick={() => { setPageOpen(true); setNewPage({ title: '', slug: '', showInNav: false }); }}><FileText className="h-3.5 w-3.5" /> New page</Button>
          <Button size="sm" variant="ghost" onClick={() => void refetch()}>Refresh</Button>
        </div>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="CMS pages" value={String((pages ?? []).length)} icon={<FileText className="h-4 w-4" />} />
        <StatCard label="Homepage sections" value={String(homepage?.sections.length ?? 0)} icon={<Home className="h-4 w-4" />} />
        <StatCard label="Blog posts" value={String((posts ?? []).length)} icon={<LayoutPanelTop className="h-4 w-4" />} />
        <StatCard label="Active promos" value={String((promos ?? []).length)} />
      </div>

      <Tabs
        className="mt-4"
        value="pages"
        onValueChange={() => undefined}
        size="sm"
        tabs={[
          { value: 'pages', label: 'Pages', count: (pages ?? []).length },
          { value: 'homepage', label: 'Homepage', count: homepage?.sections.length ?? 0 },
          { value: 'faqs', label: 'FAQs', count: (faqs ?? []).length },
        ]}
      />

      <Toolbar className="mt-3">
        <FilterInput label="Search pages" value={query} onChange={setQuery} placeholder="Search pages by title or slug" />
        <span className="text-2xs text-muted-foreground">Slugs drive the public URLs — publishing a page makes it reachable instantly.</span>
      </Toolbar>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Marketing pages</CardTitle>
            <CardDescription className="text-xs">{rows.length} pages · edit copy, SEO and navigation.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {isLoading && Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-16 animate-pulse rounded bg-muted" />)}
            {rows.map((page) => (
              <div key={page.id} className="rounded-lg border p-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 truncate text-xs font-medium">{page.title} <Badge variant={page.status === 'published' ? 'success' : 'warning'} className="text-2xs">{page.status}</Badge></p>
                    <p className="truncate text-2xs text-muted-foreground">/{page.slug} · {page.sections.length} sections · updated {timeAgo(page.updatedAt)}</p>
                  </div>
                  <div className="flex gap-1">
                    <Link to={`/${page.slug}`} className="rounded border px-2 py-0.5 text-2xs hover:bg-muted">View</Link>
                    <Button size="xs" variant="outline" onClick={() => { void cmsService.publishPage(page.id, page.status === 'published' ? 'draft' : 'published'); success(page.status === 'published' ? 'Page unpublished' : 'Page published'); void refetch(); }}>{page.status === 'published' ? 'Unpublish' : 'Publish'}</Button>
                    <Button size="xs" variant="ghost" onClick={() => { cmsService.updatePage(page.id, { showInNav: !page.showInNav }); success(page.showInNav ? 'Removed from navigation' : 'Added to navigation'); void refetch(); }}>{page.showInNav ? 'Unpin' : 'Pin'}</Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={async () => {
                        const ok = await confirm({ title: `Delete “${page.title}”?`, description: 'The public URL stops resolving immediately.', destructive: true, confirmLabel: 'Delete page' });
                        if (ok) { cmsService.removePage(page.id); success('Page deleted'); void refetch(); }
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                {page.sections.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {page.sections.map((section) => (
                      <button key={section.id} type="button" onClick={() => setEditing(section)} className="rounded border px-2 py-0.5 text-2xs hover:border-primary/50">{section.title || section.type}</button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {rows.length === 0 && <EmptyState icon={<Search className="h-5 w-5" />} title="No pages match" description="Try a different search." />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Homepage sections</CardTitle>
            <CardDescription className="text-xs">Click a section to edit its copy. Order and visibility are managed in <Link to="/admin/cms/homepage" className="underline">Homepage</Link>.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {(homepage?.sections ?? []).map((section) => (
              <button key={section.id} type="button" onClick={() => setEditing(section)} className={cn('w-full rounded-lg border p-2 text-left transition-colors hover:border-primary/50', !section.visible && 'opacity-60')}>
                <p className="flex items-center gap-1.5 text-xs font-medium">{section.title || section.key} <Badge variant="outline" className="text-2xs">{section.type}</Badge> {!section.visible && <Badge variant="warning" className="text-2xs">hidden</Badge>}</p>
                <p className="line-clamp-2 text-2xs text-muted-foreground">{section.subtitle || section.body}</p>
              </button>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Recent blog posts</CardTitle></CardHeader>
          <CardContent className="space-y-1.5">
            {(posts ?? []).slice(0, 5).map((post) => (
              <div key={post.id} className="flex items-center justify-between gap-2 border-b py-1 text-xs last:border-0">
                <span className="min-w-0 truncate">{post.title}</span>
                <Badge variant={post.status === 'published' ? 'success' : 'warning'} className="text-2xs">{post.status}</Badge>
              </div>
            ))}
            <Link to="/admin/blog" className="mt-2 block text-2xs underline">Manage the blog</Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">FAQs</CardTitle></CardHeader>
          <CardContent className="space-y-1.5">
            {(faqs ?? []).slice(0, 5).map((faq) => (
              <p key={faq.id} className="truncate border-b py-1 text-xs last:border-0">{faq.question}</p>
            ))}
            <Link to="/admin/cms" className="mt-2 block text-2xs underline">Edit FAQ copy</Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Promotions</CardTitle></CardHeader>
          <CardContent className="space-y-1.5">
            {(promos ?? []).slice(0, 5).map((promo) => (
              <p key={promo.id} className="flex items-center justify-between gap-2 border-b py-1 text-xs last:border-0">
                <span className="min-w-0 truncate">{promo.name}</span>
                <span className="text-2xs text-muted-foreground">{promo.discountPercent > 0 ? `${promo.discountPercent}% off` : promo.placement}</span>
              </p>
            ))}
            <Link to="/admin/promotions" className="mt-2 block text-2xs underline">Manage promotions</Link>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Site footer &amp; navigation</CardTitle>
          <CardDescription className="text-xs">Footer links and nav labels are content, not code.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {(['header', 'footer-product', 'footer-resources', 'footer-company', 'footer-legal'] as const).map((location) => (
            <div key={location} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-xs">
              <span className="font-medium capitalize">{location.replace('-', ' ')}</span>
              <span className="text-2xs text-muted-foreground">{cmsService.nav(location).map((item) => item.label).join(' · ') || 'no links'}</span>
              <Button size="xs" variant="ghost" onClick={() => success('Navigation ready', 'Reorder links from the navigation editor in Homepage builder.')}>Edit links</Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Modal
        open={Boolean(editing)}
        onOpenChange={(next) => !next && setEditing(null)}
        title={editing ? `Edit “${editing.title || editing.key}”` : 'Edit section'}
        description={editing ? `Section type: ${editing.type} · page: ${editing.page}` : undefined}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={() => { if (editing) { saved.mutate({ id: editing.id, patch: editing }); setEditing(null); } }}><Save className="h-3.5 w-3.5" /> Save section</Button>
          </>
        }
      >
        {editing && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="s-title" className="text-xs">Title</Label><Input id="s-title" value={editing.title} onChange={(event) => setEditing({ ...editing, title: event.target.value })} /></div>
              <div className="space-y-1.5"><Label htmlFor="s-subtitle" className="text-xs">Subtitle</Label><Input id="s-subtitle" value={editing.subtitle} onChange={(event) => setEditing({ ...editing, subtitle: event.target.value })} /></div>
            </div>
            <div className="space-y-1.5"><Label htmlFor="s-body" className="text-xs">Body</Label><Textarea id="s-body" rows={4} value={editing.body} onChange={(event) => setEditing({ ...editing, body: event.target.value })} /></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="s-cta-label" className="text-xs">CTA label</Label><Input id="s-cta-label" value={editing.ctaLabel ?? ''} onChange={(event) => setEditing({ ...editing, ctaLabel: event.target.value })} /></div>
              <div className="space-y-1.5"><Label htmlFor="s-cta-href" className="text-xs">CTA link</Label><Input id="s-cta-href" value={editing.ctaHref ?? ''} onChange={(event) => setEditing({ ...editing, ctaHref: event.target.value })} /></div>
            </div>
            <div className="flex items-center justify-between rounded border p-2"><span className="text-xs">Visible on the public site</span><Switch checked={editing.visible} onCheckedChange={(checked) => setEditing({ ...editing, visible: checked })} /></div>
            <Separator />
            <div>
              <p className="mb-2 flex items-center justify-between text-xs font-medium">Items ({editing.items.length})
                <Button size="xs" variant="outline" onClick={() => setEditing({ ...editing, items: [...editing.items, { id: `item_${Date.now()}`, title: 'New item', body: 'Describe this item', meta: '' }] })}>Add item</Button>
              </p>
              <div className="space-y-2">
                {editing.items.map((item, index) => (
                  <div key={item.id} className="grid gap-2 rounded border p-2 sm:grid-cols-[1fr,1fr,auto]">
                    <Input value={item.title} onChange={(event) => setEditing({ ...editing, items: editing.items.map((entry, position) => (position === index ? { ...entry, title: event.target.value } : entry)) })} aria-label={`Item ${index + 1} title`} />
                    <Input value={item.body} onChange={(event) => setEditing({ ...editing, items: editing.items.map((entry, position) => (position === index ? { ...entry, body: event.target.value } : entry)) })} aria-label={`Item ${index + 1} body`} />
                    <Button size="xs" variant="ghost" onClick={() => setEditing({ ...editing, items: editing.items.filter((_, position) => position !== index) })} aria-label="Remove item"><Trash2 className="h-3 w-3" /></Button>
                  </div>
                ))}
                {editing.items.length === 0 && <p className="text-2xs text-muted-foreground">This section has no items yet.</p>}
              </div>
            </div>
            <p className="flex items-center gap-1.5 text-2xs text-muted-foreground"><Eye className="h-3 w-3" /> Saving updates the marketing site immediately — open the public page in another tab to confirm.</p>
          </div>
        )}
      </Modal>

      <Modal
        open={pageOpen}
        onOpenChange={setPageOpen}
        title="New CMS page"
        description="Creates a draft page with its own URL, SEO block and section list."
        footer={
          <>
            <Button variant="outline" onClick={() => setPageOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                if (newPage.title.length < 3) return;
                const created = cmsService.createPage({ title: newPage.title, slug: newPage.slug || newPage.title, showInNav: newPage.showInNav, sections: [] });
                success('Page created', `/${created.slug} is ready to fill in.`);
                setPageOpen(false);
                void refetch();
              }}
            >
              Create page
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="space-y-1.5"><Label htmlFor="p-title" className="text-xs">Title</Label><Input id="p-title" value={newPage.title} onChange={(event) => setNewPage((current) => ({ ...current, title: event.target.value }))} /></div>
          <div className="space-y-1.5"><Label htmlFor="p-slug" className="text-xs">Slug</Label><Input id="p-slug" value={newPage.slug} onChange={(event) => setNewPage((current) => ({ ...current, slug: event.target.value }))} placeholder="auto-generated from the title" /></div>
          <div className="flex items-center justify-between rounded border p-2"><span className="text-xs">Show in the public navigation</span><Switch checked={newPage.showInNav} onCheckedChange={(checked) => setNewPage((current) => ({ ...current, showInNav: checked }))} /></div>
          <p className="text-2xs text-muted-foreground">Created {formatDateTime(new Date().toISOString())} — new pages start as drafts until you publish them.</p>
        </div>
      </Modal>
    </div>
  );
}
