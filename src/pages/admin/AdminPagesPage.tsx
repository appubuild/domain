import * as React from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, FileText, Plus, Search, Save, Trash2 } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Separator, Switch, Textarea } from '@/components/ui/primitives';
import { Modal, useConfirm } from '@/components/ui/overlays';
import { EmptyState, StatCard } from '@/components/ui/data';
import { PageHeader } from '@/components/layout/AdminLayout';
import { useToast } from '@/components/ui/toast';
import { useCmsPages, keys } from '@/hooks/queries';
import { cmsService } from '@/services';
import { formatDateTime, timeAgo } from '@/lib/format';
import { useQueryClient } from '@tanstack/react-query';
import { useAdminAction, Toolbar, FilterInput, StatusPill } from './shared';
import type { CmsPage } from '@/types/domain';

export default function AdminPagesPage() {
  const confirm = useConfirm();
  const { success } = useToast();
  const qc = useQueryClient();
  const { data: pages, isLoading, refetch } = useCmsPages();
  const [query, setQuery] = React.useState('');
  const [status, setStatus] = React.useState('all');
  const [editing, setEditing] = React.useState<CmsPage | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [draft, setDraft] = React.useState({ title: '', slug: '' });

  const save = useAdminAction(
    (page: CmsPage) => { const result = cmsService.updatePage(page.id, page); qc.invalidateQueries({ queryKey: keys.cmsPages }); return result; },
    { success: 'Page saved', detail: 'Copy and SEO updated in the CMS.', invalidate: [keys.cmsPages] },
  );

  const rows = ((pages ?? []) as CmsPage[]).filter((page) => (status === 'all' || page.status === status) && (!query || `${page.title} ${page.slug}`.toLowerCase().includes(query.toLowerCase())));

  return (
    <div>
      <PageHeader title="Pages" description="Static and legal pages rendered from CMS content: terms, privacy, refunds, about and anything else you add.">
        <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="h-3.5 w-3.5" /> New page</Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Pages" value={String((pages ?? []).length)} icon={<FileText className="h-4 w-4" />} />
        <StatCard label="Published" value={String((pages ?? []).filter((page) => page.status === 'published').length)} />
        <StatCard label="Drafts" value={String((pages ?? []).filter((page) => page.status === 'draft').length)} />
        <StatCard label="In navigation" value={String((pages ?? []).filter((page) => page.showInNav).length)} />
      </div>

      <Toolbar className="mt-4">
        <FilterInput label="Search pages" value={query} onChange={setQuery} placeholder="Search by title or slug" />
        <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Status" className="h-9 rounded-md border border-input bg-background px-2 text-xs">
          <option value="all">All statuses</option>
          <option value="published">Published</option>
          <option value="draft">Draft</option>
        </select>
      </Toolbar>

      <div className="grid gap-4 lg:grid-cols-2">
        {isLoading && Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-28 animate-pulse rounded-lg bg-muted" />)}
        {rows.map((page) => (
          <Card key={page.id}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <CardTitle className="truncate text-sm">{page.title}</CardTitle>
                  <CardDescription className="truncate text-2xs">/{page.slug} · {page.sections.length} sections · updated {timeAgo(page.updatedAt)}</CardDescription>
                </div>
                <StatusPill value={page.status} />
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="line-clamp-2 text-2xs text-muted-foreground">{page.seo.description || 'No meta description yet.'}</p>
              <div className="flex flex-wrap items-center gap-1.5">
                {page.showInNav && <Badge variant="outline" className="text-2xs">in nav #{page.navOrder}</Badge>}
                {page.seo.noIndex && <Badge variant="warning" className="text-2xs">noindex</Badge>}
                <Badge variant="outline" className="text-2xs">{page.seo.keywords.length} keywords</Badge>
              </div>
              <div className="flex flex-wrap gap-1">
                <Button size="xs" variant="outline" onClick={() => setEditing(page)}><Save className="h-3 w-3" /> Edit</Button>
                <Button size="xs" variant="outline" onClick={() => { void cmsService.publishPage(page.id, page.status === 'published' ? 'draft' : 'published'); success(page.status === 'published' ? 'Page unpublished' : 'Page published'); void refetch(); }}>{page.status === 'published' ? 'Unpublish' : 'Publish'}</Button>
                <Link to={`/${page.slug}`} className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-2xs hover:bg-muted"><ExternalLink className="h-3 w-3" /> Open</Link>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={async () => {
                    const ok = await confirm({ title: `Delete “${page.title}”?`, description: 'The URL stops resolving and any menu link is removed.', destructive: true, confirmLabel: 'Delete page' });
                    if (ok) { cmsService.removePage(page.id); success('Page deleted'); void refetch(); }
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {!isLoading && rows.length === 0 && <EmptyState icon={<Search className="h-5 w-5" />} title="No pages match" description="Try another search or status." />}

      <Card className="mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Bulk actions</CardTitle>
          <CardDescription className="text-xs">Useful after a policy update across the legal pages.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-1.5">
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              (pages ?? []).filter((page) => page.slug.startsWith('legal') || ['terms', 'privacy', 'refund-policy', 'copyright', 'community-guidelines'].includes(page.slug)).forEach((page) => cmsService.updatePage(page.id, { status: 'published' }));
              success('Legal pages published');
              void refetch();
            }}
          >
            Publish legal pages
          </Button>
          <Button size="xs" variant="ghost" onClick={() => { (pages ?? []).forEach((page) => cmsService.updatePage(page.id, { seo: { ...page.seo, noIndex: false } })); success('Search indexing enabled for every page'); void refetch(); }}>
            Allow search indexing
          </Button>
          <Button size="xs" variant="ghost" onClick={() => void refetch()}>Refresh</Button>
        </CardContent>
      </Card>

      <Modal
        open={Boolean(editing)}
        onOpenChange={(next) => !next && setEditing(null)}
        title={editing ? `Edit ${editing.title}` : 'Edit page'}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={() => { if (editing) { save.mutate(editing); setEditing(null); } }}><Save className="h-3.5 w-3.5" /> Save page</Button>
          </>
        }
      >
        {editing && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="pg-title" className="text-xs">Title</Label><Input id="pg-title" value={editing.title} onChange={(event) => setEditing({ ...editing, title: event.target.value })} /></div>
              <div className="space-y-1.5"><Label htmlFor="pg-slug" className="text-xs">Slug</Label><Input id="pg-slug" value={editing.slug} onChange={(event) => setEditing({ ...editing, slug: event.target.value })} /></div>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-xs">Show in navigation <Switch checked={editing.showInNav} onCheckedChange={(checked) => setEditing({ ...editing, showInNav: checked })} /></label>
              <div className="space-y-1.5"><Label htmlFor="pg-order" className="text-xs">Nav order</Label><Input id="pg-order" type="number" value={editing.navOrder} onChange={(event) => setEditing({ ...editing, navOrder: Number(event.target.value) })} className="h-8 w-20" /></div>
              <label className="flex items-center gap-2 text-xs">noindex <Switch checked={editing.seo.noIndex} onCheckedChange={(checked) => setEditing({ ...editing, seo: { ...editing.seo, noIndex: checked } })} /></label>
            </div>
            <Separator />
            <p className="text-xs font-medium">SEO</p>
            <div className="space-y-1.5"><Label htmlFor="seo-title" className="text-xs">Meta title</Label><Input id="seo-title" value={editing.seo.title} onChange={(event) => setEditing({ ...editing, seo: { ...editing.seo, title: event.target.value } })} /></div>
            <div className="space-y-1.5"><Label htmlFor="seo-desc" className="text-xs">Meta description</Label><Textarea id="seo-desc" rows={3} value={editing.seo.description} onChange={(event) => setEditing({ ...editing, seo: { ...editing.seo, description: event.target.value } })} /></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="seo-canonical" className="text-xs">Canonical URL</Label><Input id="seo-canonical" value={editing.seo.canonical} onChange={(event) => setEditing({ ...editing, seo: { ...editing.seo, canonical: event.target.value } })} /></div>
              <div className="space-y-1.5"><Label htmlFor="seo-keywords" className="text-xs">Keywords (comma separated)</Label><Input id="seo-keywords" value={editing.seo.keywords.join(', ')} onChange={(event) => setEditing({ ...editing, seo: { ...editing.seo, keywords: event.target.value.split(',').map((entry) => entry.trim()).filter(Boolean) } })} /></div>
            </div>
            <Separator />
            <p className="text-xs font-medium">Sections ({editing.sections.length})</p>
            <div className="space-y-1.5">
              {editing.sections.map((section) => (
                <div key={section.id} className="flex items-center justify-between rounded border p-2 text-2xs">
                  <span className="min-w-0 truncate">{section.title || section.key} <Badge variant="outline" className="ml-1 text-2xs">{section.type}</Badge></span>
                  <Button size="xs" variant="ghost" onClick={() => setEditing({ ...editing, sections: editing.sections.filter((entry) => entry.id !== section.id) })} aria-label="Remove section">✕</Button>
                </div>
              ))}
              <Button
                size="xs"
                variant="outline"
                onClick={() => setEditing({
                  ...editing,
                  sections: [...editing.sections, { id: `sec_${Date.now()}`, key: `section-${editing.sections.length + 1}`, page: editing.slug, type: 'text', title: 'New section', subtitle: '', body: '', visible: true, order: editing.sections.length + 1, items: [] }],
                })}
              >
                <Plus className="h-3 w-3" /> Add section
              </Button>
              <p className="text-2xs text-muted-foreground">Section copy is edited from the CMS screen; this list controls which sections a page renders and in what order.</p>
            </div>
            <p className="text-2xs text-muted-foreground">Last updated {formatDateTime(editing.updatedAt)}</p>
          </div>
        )}
      </Modal>

      <Modal
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="New page"
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                if (draft.title.length < 3) return;
                const created = cmsService.createPage({ title: draft.title, slug: draft.slug || draft.title, status: 'draft' });
                success('Page created', `/${created.slug} is ready to edit.`);
                setCreateOpen(false);
                void refetch();
              }}
            >
              Create page
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="space-y-1.5"><Label htmlFor="np-title" className="text-xs">Title</Label><Input id="np-title" value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} /></div>
          <div className="space-y-1.5"><Label htmlFor="np-slug" className="text-xs">Slug</Label><Input id="np-slug" value={draft.slug} onChange={(event) => setDraft((current) => ({ ...current, slug: event.target.value }))} placeholder="auto from title" /></div>
        </div>
      </Modal>
    </div>
  );
}
