import * as React from 'react';
import { Copy, LayoutTemplate, Plus, Search, Star } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Select, Switch, Textarea } from '@/components/ui/primitives';
import { Modal, useConfirm } from '@/components/ui/overlays';
import { EmptyState, StatCard } from '@/components/ui/data';
import { PageHeader } from '@/components/layout/AdminLayout';
import { useToast } from '@/components/ui/toast';
import { useTemplateCategories, useTemplates, keys } from '@/hooks/queries';
import { templateService } from '@/services';
import { TRIM_SIZES, BOOK_KINDS } from '@/data/constants';
import { formatNumber } from '@/lib/format';
import { useAdminAction, Toolbar, FilterInput, FilterSelect, StatusPill } from './shared';
import type { Template } from '@/types/domain';

export default function AdminTemplatesPage() {
  const confirm = useConfirm();
  const { success } = useToast();
  const [query, setQuery] = React.useState('');
  const [categoryId, setCategoryId] = React.useState('all');
  const [status, setStatus] = React.useState<'all' | 'published' | 'draft'>('all');
  const [sort, setSort] = React.useState<'popular' | 'newest' | 'rating' | 'name'>('popular');
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Template | null>(null);

  const { data: templates, isLoading, refetch } = useTemplates({ query: query || undefined, categoryIds: categoryId === 'all' ? undefined : [categoryId], sort, published: status === 'all' ? undefined : status === 'published' });
  const { data: categories } = useTemplateCategories();

  const update = useAdminAction(
    ({ id, patch }: { id: string; patch: Partial<Template> }) => { const result = templateService.update(id, patch); refetch(); return result; },
    { success: 'Template updated', invalidate: [keys.templates()] },
  );

  const rows = (templates ?? []) as Template[];

  return (
    <div>
      <PageHeader title="Templates" description="Curate the template library: feature, publish, price and duplicate starting points for authors.">
        <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="h-3.5 w-3.5" /> New template</Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Templates" value={formatNumber(rows.length)} icon={<LayoutTemplate className="h-4 w-4" />} />
        <StatCard label="Published" value={formatNumber(rows.filter((template) => template.published).length)} />
        <StatCard label="Featured" value={formatNumber(rows.filter((template) => template.featured).length)} icon={<Star className="h-4 w-4" />} />
        <StatCard label="Total uses" value={formatNumber(rows.reduce((total, template) => total + template.uses, 0))} />
      </div>

      <Toolbar className="mt-4">
        <FilterInput label="Search templates" value={query} onChange={setQuery} placeholder="Search name, style or tag" />
        <FilterSelect label="Category" value={categoryId} onChange={setCategoryId} options={[{ value: 'all', label: 'All categories' }, ...(categories ?? []).map((entry) => ({ value: entry.category.id, label: `${entry.category.name} (${entry.count})` }))]} />
        <FilterSelect label="Status" value={status} onChange={(value) => setStatus(value as typeof status)} options={[{ value: 'all', label: 'All' }, { value: 'published', label: 'Published' }, { value: 'draft', label: 'Drafts' }]} />
        <FilterSelect label="Sort" value={sort} onChange={(value) => setSort(value as typeof sort)} options={[{ value: 'popular', label: 'Most used' }, { value: 'newest', label: 'Newest' }, { value: 'rating', label: 'Highest rated' }, { value: 'name', label: 'Name' }]} />
      </Toolbar>

      {isLoading && <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-44 animate-pulse rounded-lg bg-muted" />)}</div>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((template) => (
          <Card key={template.id}>
            <CardContent className="space-y-3 pt-4">
              <div className="flex items-start gap-3">
                <div className="h-14 w-10 shrink-0 rounded" style={{ background: `linear-gradient(150deg, ${template.accentColor}, hsl(var(--muted)))` }} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{template.name}</p>
                  <p className="truncate text-2xs text-muted-foreground">{template.style} · {template.pageCount} pages · {template.trimSize.label}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {template.featured && <Badge variant="info" className="text-2xs">featured</Badge>}
                    {template.premium && <Badge variant="accent" className="text-2xs">premium</Badge>}
                    <StatusPill value={template.published ? 'published' : 'draft'} />
                    <Badge variant="outline" className="text-2xs">{formatNumber(template.uses)} uses</Badge>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button size="xs" variant="outline" onClick={() => update.mutate({ id: template.id, patch: { featured: !template.featured } })}>{template.featured ? 'Unfeature' : 'Feature'}</Button>
                <Button size="xs" variant="outline" onClick={() => update.mutate({ id: template.id, patch: { premium: !template.premium } })}>{template.premium ? 'Make free' : 'Make premium'}</Button>
                <Button size="xs" variant="outline" onClick={() => update.mutate({ id: template.id, patch: { published: !template.published } })}>{template.published ? 'Unpublish' : 'Publish'}</Button>
                <Button size="xs" variant="ghost" onClick={() => setEditing(template)}>Edit</Button>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    void templateService.create({
                      name: `${template.name} (copy)`,
                      description: template.description,
                      categoryId: template.categoryId,
                      style: template.style,
                      kind: template.kind,
                      trimSize: template.trimSize,
                      palette: template.palette,
                      headingFont: template.headingFont,
                      bodyFont: template.bodyFont,
                      premium: template.premium,
                    }).then((copy) => { success('Template duplicated', copy.name); void refetch(); });
                  }}
                >
                  <Copy className="h-3 w-3" />
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={async () => {
                    const ok = await confirm({ title: `Delete “${template.name}”?`, description: 'Books already created from this template are unaffected.', destructive: true, confirmLabel: 'Delete template' });
                    if (ok) { templateService.remove(template.id); success('Template deleted'); void refetch(); }
                  }}
                >
                  <Trash2Icon />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {!isLoading && rows.length === 0 && (
        <EmptyState icon={<Search className="h-5 w-5" />} title="No templates match" description="Clear the filters or create a new template." actions={<Button variant="outline" onClick={() => { setQuery(''); setCategoryId('all'); setStatus('all'); }}>Clear filters</Button>} />
      )}

      <Modal
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="New template"
        description="Templates are starting points: structure, palette, typography and trim size."
        footer={<Button variant="outline" onClick={() => setCreateOpen(false)}>Close</Button>}
      >
        <TemplateForm
          onSubmit={(values) => {
            void templateService.create(values).then((created) => {
              success('Template created', `${created.name} is ready for authors.`);
              setCreateOpen(false);
              void refetch();
            });
          }}
        />
      </Modal>

      <Modal
        open={Boolean(editing)}
        onOpenChange={(next) => !next && setEditing(null)}
        title={`Edit ${editing?.name ?? 'template'}`}
        footer={<Button variant="outline" onClick={() => setEditing(null)}>Close</Button>}
      >
        {editing && (
          <TemplateForm
            initial={editing}
            onSubmit={(values) => {
              update.mutate({ id: editing.id, patch: values });
              setEditing(null);
            }}
          />
        )}
      </Modal>

      <Card className="mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Category coverage</CardTitle>
          <CardDescription className="text-xs">Templates without a category fall out of the public library filters.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-1.5">
          {(categories ?? []).map((entry) => {
            const count = rows.filter((template) => template.categoryId === entry.category.id).length;
            return <Badge key={entry.category.id} variant="outline" className="text-2xs">{entry.category.name}: {count}</Badge>;
          })}
        </CardContent>
      </Card>
    </div>
  );
}

function Trash2Icon() {
  return <span aria-hidden className="text-xs">✕</span>;
}

function TemplateForm({ initial, onSubmit }: { initial?: Template; onSubmit: (values: Partial<Template>) => void }) {
  const [values, setValues] = React.useState<Partial<Template>>({
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    style: initial?.style ?? 'Editorial',
    kind: initial?.kind ?? 'fiction',
    categoryId: initial?.categoryId ?? 'cat_fiction',
    trimSize: initial?.trimSize ?? TRIM_SIZES[3],
    palette: initial?.palette ?? 'ink',
    headingFont: initial?.headingFont ?? 'Playfair Display',
    bodyFont: initial?.bodyFont ?? 'Inter',
    premium: initial?.premium ?? false,
    featured: initial?.featured ?? false,
  });
  const { data: categories } = useTemplateCategories();

  return (
    <div className="space-y-3">
      <div className="space-y-1.5"><Label htmlFor="t-name" className="text-xs">Name</Label><Input id="t-name" value={values.name ?? ''} onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))} /></div>
      <div className="space-y-1.5"><Label htmlFor="t-desc" className="text-xs">Description</Label><Textarea id="t-desc" rows={3} value={values.description ?? ''} onChange={(event) => setValues((current) => ({ ...current, description: event.target.value }))} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="t-cat" className="text-xs">Category</Label>
          <Select id="t-cat" value={values.categoryId} onChange={(event) => setValues((current) => ({ ...current, categoryId: event.target.value }))}>
            {(categories ?? []).map((entry) => <option key={entry.category.id} value={entry.category.id}>{entry.category.name}</option>)}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="t-kind" className="text-xs">Kind</Label>
          <Select id="t-kind" value={values.kind} onChange={(event) => setValues((current) => ({ ...current, kind: event.target.value as Template['kind'] }))}>
            {BOOK_KINDS.map((kind) => <option key={kind} value={kind}>{kind.replace('-', ' ')}</option>)}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="t-trim" className="text-xs">Trim size</Label>
          <Select id="t-trim" value={values.trimSize?.id} onChange={(event) => setValues((current) => ({ ...current, trimSize: TRIM_SIZES.find((trim) => trim.id === event.target.value) ?? TRIM_SIZES[3] }))}>
            {TRIM_SIZES.map((trim) => <option key={trim.id} value={trim.id}>{trim.label}</option>)}
          </Select>
        </div>
        <div className="space-y-1.5"><Label htmlFor="t-style" className="text-xs">Style</Label><Input id="t-style" value={values.style ?? ''} onChange={(event) => setValues((current) => ({ ...current, style: event.target.value }))} /></div>
        <div className="space-y-1.5"><Label htmlFor="t-heading" className="text-xs">Heading font</Label><Input id="t-heading" value={values.headingFont ?? ''} onChange={(event) => setValues((current) => ({ ...current, headingFont: event.target.value }))} /></div>
        <div className="space-y-1.5"><Label htmlFor="t-body" className="text-xs">Body font</Label><Input id="t-body" value={values.bodyFont ?? ''} onChange={(event) => setValues((current) => ({ ...current, bodyFont: event.target.value }))} /></div>
      </div>
      <div className="flex items-center justify-between"><span className="text-xs">Premium (Pro and above)</span><Switch checked={Boolean(values.premium)} onCheckedChange={(checked) => setValues((current) => ({ ...current, premium: checked }))} /></div>
      <div className="flex items-center justify-between"><span className="text-xs">Featured in the library</span><Switch checked={Boolean(values.featured)} onCheckedChange={(checked) => setValues((current) => ({ ...current, featured: checked }))} /></div>
      <Button size="sm" className="w-full" onClick={() => onSubmit(values)} disabled={!values.name || values.name.length < 3}>{initial ? 'Save template' : 'Create template'}</Button>
    </div>
  );
}
