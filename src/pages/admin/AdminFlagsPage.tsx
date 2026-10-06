import * as React from 'react';
import { Flag, Plus, Search, Trash2, Users } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Separator, Slider, Switch, Textarea } from '@/components/ui/primitives';
import { Modal, Tabs, useConfirm } from '@/components/ui/overlays';
import { EmptyState, StatCard } from '@/components/ui/data';
import { PageHeader } from '@/components/layout/AdminLayout';
import { useToast } from '@/components/ui/toast';
import { useFlags, keys } from '@/hooks/queries';
import { adminService } from '@/services';
import { formatNumber, timeAgo } from '@/lib/format';
import { useAdminAction, useAdminActor, FilterInput, FilterSelect, Toolbar } from './shared';
import type { FeatureFlag } from '@/types/domain';

const CATEGORIES: FeatureFlag['category'][] = ['editor', 'ai', 'marketplace', 'export', 'platform', 'collaboration'];

export default function AdminFlagsPage() {
  const actor = useAdminActor();
  const confirm = useConfirm();
  const { success, info } = useToast();
  const { data: flags, isLoading, refetch } = useFlags();
  const [query, setQuery] = React.useState('');
  const [category, setCategory] = React.useState('all');
  const [tab, setTab] = React.useState<'all' | 'on' | 'off'>('all');
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<FeatureFlag | null>(null);
  const [draft, setDraft] = React.useState<Partial<FeatureFlag>>({ key: '', name: '', description: '', scope: 'global', rollout: 100, category: 'platform', enabled: false });

  const toggle = useAdminAction(
    ({ id, enabled }: { id: string; enabled: boolean }) => { const result = adminService.toggleFlag(id, enabled, actor); refetch(); return result; },
    { success: 'Feature flag updated', detail: 'The frontend reacts on the next render.', invalidate: [keys.flags] },
  );

  const rows = ((flags ?? []) as FeatureFlag[])
    .filter((flag) => (category === 'all' || flag.category === category))
    .filter((flag) => (tab === 'all' ? true : tab === 'on' ? flag.enabled : !flag.enabled))
    .filter((flag) => !query || `${flag.key} ${flag.name} ${flag.description}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <div>
      <PageHeader title="Feature flags" description="Ship features progressively. Any screen can read a flag through the admin service before rendering.">
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" onClick={() => { setDraft({ key: '', name: '', description: '', scope: 'global', rollout: 100, category: 'platform', enabled: false }); setCreateOpen(true); }}><Plus className="h-3.5 w-3.5" /> New flag</Button>
          <Button size="sm" variant="ghost" onClick={() => void refetch()}>Refresh</Button>
        </div>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Flags" value={formatNumber((flags ?? []).length)} icon={<Flag className="h-4 w-4" />} />
        <StatCard label="Enabled" value={formatNumber((flags ?? []).filter((flag) => flag.enabled).length)} />
        <StatCard label="Beta scoped" value={formatNumber((flags ?? []).filter((flag) => flag.scope === 'beta').length)} icon={<Users className="h-4 w-4" />} />
        <StatCard label="Partial rollouts" value={formatNumber((flags ?? []).filter((flag) => flag.rollout < 100).length)} />
      </div>

      <Toolbar className="mt-4">
        <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)} size="sm" tabs={[{ value: 'all', label: 'All' }, { value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} />
        <FilterInput label="Search flags" value={query} onChange={setQuery} placeholder="Search key, name or description" />
        <FilterSelect label="Category" value={category} onChange={setCategory} options={[{ value: 'all', label: 'All categories' }, ...CATEGORIES.map((entry) => ({ value: entry, label: entry }))]} />
      </Toolbar>

      <div className="grid gap-4 lg:grid-cols-2">
        {isLoading && Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-32 animate-pulse rounded-lg bg-muted" />)}
        {rows.map((flag) => (
          <Card key={flag.id} className={flag.enabled ? 'border-primary/40' : undefined}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <CardTitle className="flex flex-wrap items-center gap-1.5 text-sm">{flag.name} <Badge variant="outline" className="text-2xs">{flag.category}</Badge> <Badge variant={flag.scope === 'beta' ? 'info' : 'secondary'} className="text-2xs">{flag.scope}</Badge></CardTitle>
                  <CardDescription className="truncate text-2xs">{flag.key}</CardDescription>
                </div>
                <Switch checked={flag.enabled} onCheckedChange={(checked) => toggle.mutate({ id: flag.id, enabled: checked })} />
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-2xs text-muted-foreground">{flag.description}</p>
              <div className="flex items-center gap-2">
                <span className="text-2xs text-muted-foreground">Rollout</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${flag.rollout}%` }} />
                </div>
                <span className="text-2xs">{flag.rollout}%</span>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <Button size="xs" variant="outline" onClick={() => setEditing(flag)}>Edit</Button>
                <Button size="xs" variant="ghost" onClick={() => { toggle.mutate({ id: flag.id, enabled: !flag.enabled }); success(flag.enabled ? `${flag.name} disabled` : `${flag.name} enabled app-wide`); }}>{flag.enabled ? 'Turn off' : 'Turn on'}</Button>
                <Button size="xs" variant="ghost" onClick={() => info('Consumers', `${flag.key} is read via adminService.isFlagEnabled('${flag.key}') — components degrade gracefully when it is off.`)}>Where is it used?</Button>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={async () => {
                    const ok = await confirm({ title: `Delete “${flag.name}”?`, description: 'Code reading this flag treats it as disabled.', destructive: true, confirmLabel: 'Delete flag' });
                    if (ok) { adminService.removeFlag(flag.id); success('Flag deleted'); void refetch(); }
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
                <span className="ml-auto text-2xs text-muted-foreground">updated {timeAgo(flag.updatedAt)}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {!isLoading && rows.length === 0 && <EmptyState icon={<Search className="h-5 w-5" />} title="No flags match" description="Adjust the filters or create a new flag." actions={<Button onClick={() => setCreateOpen(true)}>New flag</Button>} />}

      <Card className="mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Gating matrix</CardTitle>
          <CardDescription className="text-xs">How the frontend and service layer read each scope.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-2xs sm:grid-cols-3">
          <p className="rounded border p-2"><strong className="block text-xs">global</strong>Everyone sees the feature when enabled.</p>
          <p className="rounded border p-2"><strong className="block text-xs">plan</strong>Only accounts whose plan includes it see the feature.</p>
          <p className="rounded border p-2"><strong className="block text-xs">beta</strong>Opt-in accounts and staff; controlled by rollout percentage.</p>
          <Separator className="sm:col-span-3" />
          <p className="text-muted-foreground sm:col-span-3">Every flag read goes through the service layer, so no component hardcodes a feature decision and Phase 2 can move flags server-side without touching the UI.</p>
        </CardContent>
      </Card>

      <Modal
        open={Boolean(editing) || createOpen}
        onOpenChange={(next) => { if (!next) { setEditing(null); setCreateOpen(false); } }}
        title={editing ? `Edit ${editing.name}` : 'New feature flag'}
        footer={
          <>
            <Button variant="outline" onClick={() => { setEditing(null); setCreateOpen(false); }}>Cancel</Button>
            <Button
              onClick={() => {
                const source = editing ?? draft;
                if (!source.key || !source.name) return;
                if (editing) {
                  adminService.updateFlag(editing.id, source);
                  success('Flag saved');
                } else {
                  adminService.createFlag({
                    id: `flag_${String(source.key).replace(/[^a-z0-9]/gi, '_')}`,
                    key: source.key,
                    name: source.name,
                    description: source.description ?? '',
                    enabled: Boolean(source.enabled),
                    scope: source.scope ?? 'global',
                    rollout: source.rollout ?? 100,
                    category: source.category ?? 'platform',
                    updatedAt: new Date().toISOString(),
                  }, actor);
                  success('Flag created', `${source.key} is ready to read from the app.`);
                }
                setEditing(null);
                setCreateOpen(false);
                void refetch();
              }}
            >
              Save flag
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {!editing && (
            <div className="space-y-1.5"><Label htmlFor="f-key" className="text-xs">Key</Label><Input id="f-key" value={draft.key ?? ''} onChange={(event) => setDraft((current) => ({ ...current, key: event.target.value }))} placeholder="new_editor_toolbar" /></div>
          )}
          <div className="space-y-1.5"><Label htmlFor="f-name" className="text-xs">Name</Label><Input id="f-name" value={(editing ?? draft).name ?? ''} onChange={(event) => (editing ? setEditing({ ...editing, name: event.target.value }) : setDraft((current) => ({ ...current, name: event.target.value })))} /></div>
          <div className="space-y-1.5"><Label htmlFor="f-desc" className="text-xs">Description</Label><Textarea id="f-desc" rows={2} value={(editing ?? draft).description ?? ''} onChange={(event) => (editing ? setEditing({ ...editing, description: event.target.value }) : setDraft((current) => ({ ...current, description: event.target.value })))} /></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="f-scope" className="text-xs">Scope</Label>
              <select id="f-scope" value={(editing ?? draft).scope} onChange={(event) => (editing ? setEditing({ ...editing, scope: event.target.value as FeatureFlag['scope'] }) : setDraft((current) => ({ ...current, scope: event.target.value as FeatureFlag['scope'] })))} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
                {['global', 'plan', 'beta'].map((scope) => <option key={scope} value={scope}>{scope}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="f-category" className="text-xs">Category</Label>
              <select id="f-category" value={(editing ?? draft).category} onChange={(event) => (editing ? setEditing({ ...editing, category: event.target.value as FeatureFlag['category'] }) : setDraft((current) => ({ ...current, category: event.target.value as FeatureFlag['category'] })))} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
                {CATEGORIES.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
              </select>
            </div>
          </div>
          <Slider label="Rollout" value={(editing ?? draft).rollout ?? 100} min={0} max={100} onChange={(value) => (editing ? setEditing({ ...editing, rollout: value }) : setDraft((current) => ({ ...current, rollout: value })))} format={(value) => `${value}%`} />
          <label className="flex items-center justify-between rounded border p-2 text-xs">Enabled <Switch checked={Boolean((editing ?? draft).enabled)} onCheckedChange={(checked) => (editing ? setEditing({ ...editing, enabled: checked }) : setDraft((current) => ({ ...current, enabled: checked })))} /></label>
        </div>
      </Modal>
    </div>
  );
}
