import * as React from 'react';
import { ArrowDown, ArrowUp, Hash, Plus, Tags } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Switch, Textarea } from '@/components/ui/primitives';
import { Modal, Tabs, useConfirm } from '@/components/ui/overlays';
import { EmptyState, StatCard } from '@/components/ui/data';
import { PageHeader } from '@/components/layout/AdminLayout';
import { useToast } from '@/components/ui/toast';
import { useCategories, useTemplateCategories } from '@/hooks/queries';
import { templateService } from '@/services';
import { slugify } from '@/lib/utils';
import { formatNumber } from '@/lib/format';
import { Toolbar, FilterInput, StatusPill } from './shared';
import type { Category } from '@/types/domain';

export default function AdminCategoriesPage() {
  const confirm = useConfirm();
  const { success } = useToast();
  const [tab, setTab] = React.useState<'book' | 'template' | 'blog'>('book');
  const [query, setQuery] = React.useState('');
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Category | null>(null);
  const [draft, setDraft] = React.useState<Partial<Category>>({ name: '', description: '', color: '#6366f1', featured: false, kind: 'book' });

  const { data: bookCategories, refetch: refetchBook } = useCategories('book');
  const { data: templateCategories, refetch: refetchTemplates } = useTemplateCategories();
  const { data: blogCategories, refetch: refetchBlog } = useCategories('blog');
  const { data: tags } = useTemplateCategories();

  const [allCategories, setAllCategories] = React.useState<Category[]>([]);

  const reload = React.useCallback(() => {
    setAllCategories(templateService.categoriesAll());
    void refetchBook();
    void refetchTemplates();
    void refetchBlog();
  }, [refetchBlog, refetchBook, refetchTemplates]);

  React.useEffect(() => { reload(); }, [reload]);

  const rows = allCategories.filter((category) => category.kind === tab).filter((category) => !query || category.name.toLowerCase().includes(query.toLowerCase())).sort((a, b) => a.order - b.order);

  const move = (id: string, direction: -1 | 1) => {
    const ordered = rows.map((category) => category.id);
    const index = ordered.indexOf(id);
    const target = index + direction;
    if (target < 0 || target >= ordered.length) return;
    ordered.splice(target, 0, ordered.splice(index, 1)[0]);
    templateService.reorderCategories(ordered);
    reload();
    success('Order updated');
  };

  return (
    <div>
      <PageHeader title="Categories & tags" description="Book, template and blog taxonomy. Order and featured flags drive the public browse pages.">
        <Button size="sm" onClick={() => { setDraft({ name: '', description: '', color: '#6366f1', featured: false, kind: tab }); setCreateOpen(true); }}><Plus className="h-3.5 w-3.5" /> New category</Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Book categories" value={formatNumber((bookCategories ?? []).length)} icon={<Tags className="h-4 w-4" />} />
        <StatCard label="Template categories" value={formatNumber((templateCategories ?? []).length)} />
        <StatCard label="Blog categories" value={formatNumber((blogCategories ?? []).length)} />
        <StatCard label="Tags indexed" value={formatNumber(templateService.tags().length)} icon={<Hash className="h-4 w-4" />} />
      </div>

      <Toolbar className="mt-4">
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as typeof tab)}
          size="sm"
          tabs={[
            { value: 'book', label: 'Book' },
            { value: 'template', label: 'Template' },
            { value: 'blog', label: 'Blog' },
          ]}
        />
        <FilterInput label="Search categories" value={query} onChange={setQuery} placeholder="Search categories" />
        <span className="text-2xs text-muted-foreground">{rows.length} categories · drag-free reordering with the arrows</span>
      </Toolbar>

      <Card>
        <CardContent className="pt-4">
          <div className="space-y-2">
            {rows.map((category, index) => (
              <div key={category.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
                <span className="h-6 w-6 shrink-0 rounded" style={{ background: category.color }} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-xs font-medium">
                    {category.name}
                    {category.featured && <Badge variant="info" className="text-2xs">featured</Badge>}
                    <StatusPill value={category.active ? 'active' : 'hidden'} />
                  </p>
                  <p className="truncate text-2xs text-muted-foreground">/{category.slug} · {category.description || 'No description'} · {formatNumber(category.bookCount ?? 0)} books</p>
                </div>
                <div className="flex items-center gap-1">
                  <Button size="xs" variant="ghost" disabled={index === 0} onClick={() => move(category.id, -1)} aria-label="Move up"><ArrowUp className="h-3 w-3" /></Button>
                  <Button size="xs" variant="ghost" disabled={index === rows.length - 1} onClick={() => move(category.id, 1)} aria-label="Move down"><ArrowDown className="h-3 w-3" /></Button>
                  <Button size="xs" variant="outline" onClick={() => { setEditing(category); setDraft(category); }}>Edit</Button>
                  <Button size="xs" variant="outline" onClick={() => { templateService.updateCategory(category.id, { featured: !category.featured }); reload(); success(category.featured ? 'Removed from featured' : 'Featured on browse pages'); }}>{category.featured ? 'Unfeature' : 'Feature'}</Button>
                  <Button size="xs" variant="ghost" onClick={() => { templateService.updateCategory(category.id, { active: !category.active }); reload(); success(category.active ? 'Category hidden' : 'Category visible'); }}>{category.active ? 'Hide' : 'Show'}</Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={async () => {
                      const ok = await confirm({ title: `Delete “${category.name}”?`, description: 'Books in this category keep their tags but lose the category link.', destructive: true, confirmLabel: 'Delete category' });
                      if (ok) { templateService.removeCategory(category.id); reload(); success('Category deleted'); }
                    }}
                  >
                    ✕
                  </Button>
                </div>
              </div>
            ))}
            {rows.length === 0 && <EmptyState icon={<Tags className="h-5 w-5" />} title="No categories here" description="Create one to start organising this taxonomy." actions={<Button onClick={() => setCreateOpen(true)}>New category</Button>} />}
          </div>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Tags</CardTitle>
          <CardDescription className="text-xs">Tag usage is recomputed from books and templates.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-1.5">
          {templateService.tags().slice(0, 24).map((tag) => (
            <span key={tag.id} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs">
              #{tag.slug} <span className="text-muted-foreground">{tag.usageCount}</span>
              <button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => { templateService.removeTag(tag.id); reload(); success('Tag removed'); }} aria-label={`Remove ${tag.name}`}>✕</button>
            </span>
          ))}
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-2xs hover:border-primary"
            onClick={() => {
              const name = window.prompt('New tag name');
              if (!name) return;
              templateService.createTag({ name, slug: slugify(name), type: tab === 'blog' ? 'general' : tab });
              reload();
              success('Tag created', `#${slugify(name)}`);
            }}
          >
            <Plus className="h-3 w-3" /> Add tag
          </button>
        </CardContent>
      </Card>

      <Modal
        open={createOpen || Boolean(editing)}
        onOpenChange={(next) => { if (!next) { setCreateOpen(false); setEditing(null); } }}
        title={editing ? `Edit ${editing.name}` : 'New category'}
        footer={
          <>
            <Button variant="outline" onClick={() => { setCreateOpen(false); setEditing(null); }}>Cancel</Button>
            <Button
              onClick={() => {
                if (!draft.name || draft.name.length < 2) return;
                if (editing) {
                  templateService.updateCategory(editing.id, { ...draft, slug: draft.slug ?? slugify(draft.name) });
                  success('Category updated');
                } else {
                  templateService.createCategory({
                    name: draft.name,
                    slug: slugify(draft.name),
                    kind: (draft.kind ?? tab) as Category['kind'],
                    description: draft.description ?? '',
                    color: draft.color ?? '#6366f1',
                    featured: draft.featured,
                  });
                  success('Category created', `${draft.name} is live in the taxonomy.`);
                }
                setCreateOpen(false);
                setEditing(null);
                reload();
              }}
            >
              {editing ? 'Save category' : 'Create category'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="space-y-1.5"><Label htmlFor="c-name" className="text-xs">Name</Label><Input id="c-name" value={draft.name ?? ''} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value, slug: slugify(event.target.value) }))} /></div>
          <div className="space-y-1.5"><Label htmlFor="c-slug" className="text-xs">Slug</Label><Input id="c-slug" value={draft.slug ?? ''} onChange={(event) => setDraft((current) => ({ ...current, slug: event.target.value }))} /></div>
          <div className="space-y-1.5"><Label htmlFor="c-desc" className="text-xs">Description</Label><Textarea id="c-desc" rows={3} value={draft.description ?? ''} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} /></div>
          <div className="flex items-center gap-3">
            <div className="space-y-1.5"><Label htmlFor="c-colour" className="text-xs">Colour</Label><input id="c-colour" type="color" value={draft.color ?? '#6366f1'} onChange={(event) => setDraft((current) => ({ ...current, color: event.target.value }))} className="h-9 w-16 rounded border" /></div>
            <div className="space-y-1.5 flex-1">
              <Label htmlFor="c-kind" className="text-xs">Applies to</Label>
              <select id="c-kind" value={draft.kind ?? tab} onChange={(event) => setDraft((current) => ({ ...current, kind: event.target.value as Category['kind'] }))} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
                {['book', 'template', 'blog'].map((kind) => <option key={kind} value={kind}>{kind}</option>)}
              </select>
            </div>
          </div>
          <div className="flex items-center justify-between"><span className="text-xs">Feature on browse pages</span><Switch checked={Boolean(draft.featured)} onCheckedChange={(checked) => setDraft((current) => ({ ...current, featured: checked }))} /></div>
        </div>
      </Modal>
    </div>
  );
}
