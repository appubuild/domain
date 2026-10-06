import * as React from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, Home, Plus, Save, Sparkles, Trash2 } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Separator, Switch } from '@/components/ui/primitives';
import { Modal, Tabs, useConfirm } from '@/components/ui/overlays';
import { StatCard } from '@/components/ui/data';
import { PageHeader } from '@/components/layout/AdminLayout';
import { useToast } from '@/components/ui/toast';
import { useHomepage, keys } from '@/hooks/queries';
import { cmsService } from '@/services';
import { cn } from '@/lib/utils';
import { useQueryClient } from '@tanstack/react-query';
import { useAdminAction, Toolbar } from './shared';
import type { CmsSection } from '@/types/domain';

const TYPES: CmsSection['type'][] = ['hero', 'stats', 'features', 'logos', 'text', 'image', 'testimonials', 'faq', 'pricing', 'gallery', 'cta', 'custom'];

export default function AdminHomepagePage() {
  const confirm = useConfirm();
  const { success } = useToast();
  const qc = useQueryClient();
  const { data: homepage, refetch } = useHomepage();
  const [editing, setEditing] = React.useState<CmsSection | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<{ key: string; title: string; type: CmsSection['type'] }>({ key: '', title: '', type: 'text' });

  const sections = React.useMemo(() => [...(homepage?.sections ?? [])].sort((a, b) => a.order - b.order), [homepage]);

  const save = useAdminAction(
    (section: CmsSection) => { const result = cmsService.updateSection(section.id, section); qc.invalidateQueries({ queryKey: keys.homepage }); return result; },
    { success: 'Section saved', detail: 'Public homepage updated.', invalidate: [keys.homepage] },
  );

  const toggle = (section: CmsSection) => {
    cmsService.updateSection(section.id, { visible: !section.visible });
    success(section.visible ? `“${section.title}” hidden` : `“${section.title}” is live`);
    void refetch();
  };

  const move = (id: string, direction: -1 | 1) => {
    const ordered = sections.map((section) => section.id);
    const index = ordered.indexOf(id);
    const target = index + direction;
    if (target < 0 || target >= ordered.length) return;
    ordered.splice(target, 0, ordered.splice(index, 1)[0]);
    cmsService.reorderSections('home', ordered);
    success('Homepage reordered');
    void refetch();
  };

  return (
    <div>
      <PageHeader title="Homepage builder" description="The 15-section marketing homepage: reorder, show or hide, and edit copy without a deploy.">
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="h-3.5 w-3.5" /> Add section</Button>
          <Button size="sm" variant="outline" onClick={() => window.open('/', '_blank')}><Eye className="h-3.5 w-3.5" /> Preview homepage</Button>
        </div>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Sections" value={String(sections.length)} icon={<Home className="h-4 w-4" />} />
        <StatCard label="Visible" value={String(sections.filter((section) => section.visible).length)} change={`${sections.filter((section) => !section.visible).length} hidden`} />
        <StatCard label="Editable items" value={String(sections.reduce((total, section) => total + section.items.length, 0))} />
        <StatCard label="Hero headline" value={sections[0]?.title ?? '—'} change={sections[0]?.subtitle} />
      </div>

      <Toolbar className="mt-4">
        <span className="text-2xs text-muted-foreground">Order here is exactly what visitors see. Hidden sections are skipped in the renderer.</span>
      </Toolbar>

      <div className="grid gap-4 lg:grid-cols-[320px,1fr]">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Section order</CardTitle>
            <CardDescription className="text-xs">Drag-free reordering with the arrows.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {sections.map((section, index) => (
              <div key={section.id} className={cn('flex items-center gap-1 rounded border p-2', !section.visible && 'opacity-60')}>
                <span className="w-5 text-2xs text-muted-foreground">{index + 1}</span>
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setEditing(section)}>
                  <span className="block truncate text-xs font-medium">{section.title || section.key}</span>
                  <span className="block truncate text-2xs text-muted-foreground">{section.type}</span>
                </button>
                <Button size="xs" variant="ghost" disabled={index === 0} onClick={() => move(section.id, -1)} aria-label="Move up"><ArrowUp className="h-3 w-3" /></Button>
                <Button size="xs" variant="ghost" disabled={index === sections.length - 1} onClick={() => move(section.id, 1)} aria-label="Move down"><ArrowDown className="h-3 w-3" /></Button>
                <Button size="xs" variant="ghost" onClick={() => toggle(section)} aria-label="Toggle visibility">{section.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}</Button>
              </div>
            ))}
            <Separator />
            <Button size="xs" variant="ghost" className="w-full" onClick={() => { cmsService.reorderSections('home', sections.map((section) => section.id)); success('Order saved'); void refetch(); }}><Save className="h-3 w-3" /> Save order</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Live preview</CardTitle>
            <CardDescription className="text-xs">A compressed view of what visitors will scroll through.</CardDescription>
          </CardHeader>
          <CardContent className="max-h-[560px] space-y-3 overflow-y-auto scrollbar-thin">
            {sections.filter((section) => section.visible).map((section) => (
              <div key={section.id} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{section.title}</p>
                    <p className="truncate text-2xs text-muted-foreground">{section.subtitle}</p>
                  </div>
                  <Badge variant="outline" className="text-2xs">{section.type}</Badge>
                </div>
                <p className="mt-1 line-clamp-2 text-2xs text-muted-foreground">{section.body}</p>
                {section.items.length > 0 && (
                  <div className="mt-2 grid gap-1.5 sm:grid-cols-3">
                    {section.items.slice(0, 3).map((item) => (
                      <div key={item.id} className="rounded bg-muted/50 p-1.5">
                        <p className="truncate text-2xs font-medium">{item.title}</p>
                        <p className="line-clamp-2 text-2xs text-muted-foreground">{item.body}</p>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-2 flex gap-1">
                  <Button size="xs" variant="outline" onClick={() => setEditing(section)}>Edit</Button>
                  <Button size="xs" variant="ghost" onClick={() => toggle(section)}>Hide</Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={async () => {
                      const ok = await confirm({ title: `Delete “${section.title}”?`, description: 'The section is removed from the homepage immediately.', destructive: true, confirmLabel: 'Delete section' });
                      if (ok) { cmsService.removeSection(section.id); success('Section deleted'); void refetch(); }
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
            {sections.filter((section) => section.visible).length === 0 && <p className="text-xs text-muted-foreground">Every section is hidden — the homepage would render empty.</p>}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Section library</CardTitle>
          <CardDescription className="text-xs">Reusable blocks you can drop into the page in any order.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => { setDraft({ key: `${type}-${Date.now().toString(36)}`, title: `${type[0].toUpperCase()}${type.slice(1)} section`, type }); setCreateOpen(true); }}
              className="rounded-lg border p-2 text-left text-xs transition-colors hover:border-primary/50"
            >
              <span className="flex items-center gap-1.5 font-medium capitalize"><Sparkles className="h-3 w-3" /> {type}</span>
              <span className="block text-2xs text-muted-foreground">{sectionHint(type)}</span>
            </button>
          ))}
        </CardContent>
      </Card>

      <Modal
        open={Boolean(editing)}
        onOpenChange={(next) => !next && setEditing(null)}
        title={editing ? `Edit “${editing.title}”` : 'Edit section'}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={() => { if (editing) { save.mutate(editing); setEditing(null); } }}><Save className="h-3.5 w-3.5" /> Save section</Button>
          </>
        }
      >
        {editing && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="h-title" className="text-xs">Title</Label><Input id="h-title" value={editing.title} onChange={(event) => setEditing({ ...editing, title: event.target.value })} /></div>
              <div className="space-y-1.5"><Label htmlFor="h-subtitle" className="text-xs">Subtitle</Label><Input id="h-subtitle" value={editing.subtitle} onChange={(event) => setEditing({ ...editing, subtitle: event.target.value })} /></div>
            </div>
            <div className="space-y-1.5"><Label htmlFor="h-body" className="text-xs">Body</Label><textarea id="h-body" rows={4} value={editing.body} onChange={(event) => setEditing({ ...editing, body: event.target.value })} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /></div>
            <div className="flex items-center justify-between rounded border p-2"><span className="text-xs">Visible</span><Switch checked={editing.visible} onCheckedChange={(checked) => setEditing({ ...editing, visible: checked })} /></div>
            <Separator />
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium">Items ({editing.items.length})</p>
              <Button size="xs" variant="outline" onClick={() => setEditing({ ...editing, items: [...editing.items, { id: `item_${Date.now()}`, title: 'New card', body: 'Card copy' }] })}>Add item</Button>
            </div>
            <div className="space-y-2">
              {editing.items.map((item, index) => (
                <div key={item.id} className="flex gap-2">
                  <Input value={item.title} onChange={(event) => setEditing({ ...editing, items: editing.items.map((entry, position) => (position === index ? { ...entry, title: event.target.value } : entry)) })} aria-label={`Item ${index + 1}`} />
                  <Input value={item.body} onChange={(event) => setEditing({ ...editing, items: editing.items.map((entry, position) => (position === index ? { ...entry, body: event.target.value } : entry)) })} aria-label={`Item ${index + 1} copy`} />
                  <Button size="xs" variant="ghost" onClick={() => setEditing({ ...editing, items: editing.items.filter((_, position) => position !== index) })} aria-label="Remove"><Trash2 className="h-3 w-3" /></Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={createOpen}
        onOpenChange={(next) => !next && setCreateOpen(false)}
        title="Add a homepage section"
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                if (draft.title.length < 3) return;
                cmsService.createSection({
                  key: draft.key || `section-${Date.now()}`,
                  page: 'home',
                  type: draft.type,
                  title: draft.title,
                  subtitle: '',
                  body: '',
                  visible: true,
                  order: sections.length + 1,
                  items: [],
                });
                success('Section added', `${draft.title} is live at position ${sections.length + 1}.`);
                setCreateOpen(false);
                void refetch();
              }}
            >
              Add section
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="space-y-1.5"><Label htmlFor="new-title" className="text-xs">Section title</Label><Input id="new-title" value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} /></div>
          <div className="space-y-1.5">
            <Label htmlFor="new-type" className="text-xs">Section type</Label>
            <select id="new-type" value={draft.type} onChange={(event) => setDraft((current) => ({ ...current, type: event.target.value as CmsSection['type'] }))} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
              {TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </div>
          <div className="space-y-1.5"><Label htmlFor="new-key" className="text-xs">Key (used by the renderer)</Label><Input id="new-key" value={draft.key} onChange={(event) => setDraft((current) => ({ ...current, key: event.target.value }))} /></div>
          <p className="text-2xs text-muted-foreground">{sectionHint(draft.type)}</p>
        </div>
      </Modal>

      <Tabs className="mt-4" value="notes" onValueChange={() => undefined} size="sm" tabs={[{ value: 'notes', label: 'Renderer notes' }]} />
      <Card className="mt-3">
        <CardContent className="space-y-1.5 pt-4 text-2xs text-muted-foreground">
          <p>· Sections render in <strong className="text-foreground">order</strong>; the hero is expected first but not required.</p>
          <p>· Each section can carry up to any number of items — features, logo clouds, testimonials and FAQs all use the same item shape.</p>
          <p>· Hiding a section never deletes its copy, so seasonal blocks can be toggled back on.</p>
          <p>· The public homepage reads this content through <code className="rounded bg-muted px-1">useHomepage()</code>, so a save is visible without reloading the build.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function sectionHint(type: CmsSection['type']) {
  switch (type) {
    case 'hero': return 'Headline, sub-headline and primary call to action.';
    case 'stats': return 'Three to four proof points in a row.';
    case 'features': return 'Feature grid with icons and copy.';
    case 'logos': return 'Trusted-by strip.';
    case 'text': return 'Long-form prose block.';
    case 'image': return 'Full-width image with caption.';
    case 'testimonials': return 'Creator quotes with names and roles.';
    case 'faq': return 'Accordion of common questions.';
    case 'pricing': return 'Plan comparison teaser.';
    case 'gallery': return 'Screenshot or cover gallery.';
    case 'cta': return 'Final conversion band.';
    default: return 'Free-form block you compose yourself.';
  }
}
