import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Brain, Download, Filter, Layers, Pin, Plus, RefreshCw, Search, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { useActiveCharacter, useApp } from '@/lib/../store/app';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';
import type { Memory } from '@/lib/types';
import { Badge, Button, EmptyState, ErrorState, Field, Modal, Panel, Select, Skeleton, Tabs, Toggle } from '@/components/ui';
import { cn, downloadJson, formatNumber, relativeTime } from '@/lib/utils';

const LAYERS = [
  { value: 'all', label: 'All layers' },
  { value: 'short_term', label: 'Short term' },
  { value: 'long_term', label: 'Long term' },
  { value: 'episodic', label: 'Episodic' },
  { value: 'knowledge', label: 'Knowledge' },
] as const;

const CATEGORIES = ['preference', 'fact', 'instruction', 'relationship', 'project', 'event', 'summary', 'knowledge'];

export function MemoryPage() {
  const character = useActiveCharacter();
  const { toast } = useApp();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const [layer, setLayer] = React.useState<(typeof LAYERS)[number]['value']>('all');
  const [category, setCategory] = React.useState('');
  const [q, setQ] = React.useState('');
  const [pinnedOnly, setPinnedOnly] = React.useState(false);
  const [addOpen, setAddOpen] = React.useState(false);
  const [exportOpen, setExportOpen] = React.useState(false);
  const [focusId, setFocusId] = React.useState<string | null>(params.get('focus'));

  const list = useQuery({
    queryKey: ['memory-center', character?.id, layer, category, q, pinnedOnly],
    queryFn: () => {
      const params = new URLSearchParams({ characterId: character!.id, limit: '500' });
      if (layer !== 'all') params.set('layer', layer);
      if (category) params.set('category', category);
      if (q.trim()) params.set('q', q.trim());
      if (pinnedOnly) params.set('pinnedOnly', 'true');
      return apiGet<{ memories: Memory[]; counts: Record<string, number>; total: number }>(`/memory?${params}`);
    },
    enabled: Boolean(character),
  });

  const stats = useQuery({
    queryKey: ['memory-stats', character?.id],
    queryFn: () => apiGet<{ characters: Array<{ id: string; name: string; counts: Record<string, number> }>; total: number }>(`/memory/stats?characterId=${character?.id}`),
    enabled: Boolean(character),
  });

  const refresh = async () => {
    await Promise.all([list.refetch(), stats.refetch()]);
    await qc.invalidateQueries({ queryKey: ['character-detail'] });
  };

  const consolidate = async () => {
    if (!character) return;
    try {
      const res = await apiPost<{ merged: number; pruned: number; summary: string }>('/memory/consolidate', { characterId: character.id });
      toast({ title: 'Memory consolidated', description: `${res.merged} duplicates merged · ${res.pruned} expired pruned`, tone: 'success' });
      await refresh();
    } catch (err) {
      toast({ title: 'Consolidation failed', description: err instanceof Error ? err.message : '', tone: 'error' });
    }
  };

  const togglePin = async (m: Memory) => {
    await apiPatch(`/memory/${m.id}`, { pinned: !m.pinned });
    await refresh();
  };

  const remove = async (m: Memory) => {
    await apiDelete(`/memory/${m.id}`);
    await refresh();
  };

  if (!character) {
    return <div className="px-6 py-12"><EmptyState title="No character selected" description="Memory is scoped per character. Create or select one first." /></div>;
  }

  const memories = list.data?.memories ?? [];
  const layers = stats.data?.characters.find((c) => c.id === character.id)?.counts ?? {};

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-6">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-4">
          <Panel className="p-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[180px] flex-1">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-600" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Semantic + keyword search across memories…" className="input pl-9 text-xs" aria-label="Search memories" />
              </div>
              <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-auto text-xs">
                <option value="">All categories</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
              <Button variant="ghost" size="sm" onClick={() => void consolidate()} title="Merge duplicates and prune expired entries">
                <Sparkles className="h-3.5 w-3.5" /> Consolidate
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void refresh()} aria-label="Refresh"><RefreshCw className="h-3.5 w-3.5" /></Button>
              <Button variant="ghost" size="sm" onClick={() => setExportOpen(true)}><Download className="h-3.5 w-3.5" /></Button>
              <Button variant="primary" size="sm" onClick={() => setAddOpen(true)}><Plus className="h-3.5 w-3.5" /> Add</Button>
            </div>
            <Tabs className="mt-3" value={layer} onChange={setLayer} items={LAYERS.map((l) => ({ value: l.value, label: l.label, count: l.value === 'all' ? memories.length : layers[l.value] ?? 0 }))} />
            <label className="mt-2 flex items-center gap-2 text-[11px] text-slate-500">
              <input type="checkbox" checked={pinnedOnly} onChange={(e) => setPinnedOnly(e.target.checked)} className="h-3 w-3 accent-holo-500" />
              Pinned only
            </label>
          </Panel>

          {list.error ? <ErrorState message={list.error.message} onRetry={() => void list.refetch()} /> : null}
          {list.isLoading ? <Skeleton className="h-40" /> : memories.length === 0 ? (
            <EmptyState
              title={q ? 'No memories match that search' : 'No memories stored yet'}
              description={q ? 'Try a broader phrase, or clear the filters.' : `Memories are written when ${character.name} learns durable facts and preferences — or you can add one manually.`}
              icon={<Brain className="h-5 w-5" />}
              action={<Button size="sm" variant="primary" onClick={() => setAddOpen(true)}><Plus className="h-3.5 w-3.5" /> Add memory</Button>}
            />
          ) : (
            <div className="space-y-2">
              {memories.map((m) => (
                <Panel key={m.id} className={cn('group p-3.5 transition-all', m.pinned && 'border-amber-500/25', focusId === m.id && 'border-holo-500/50 shadow-glow')} onClick={() => setFocusId(m.id)}>
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs leading-relaxed text-slate-200">{m.content}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[9px]">
                        <Badge tone={m.layer === 'long_term' ? 'accent' : m.layer === 'episodic' ? 'neutral' : m.layer === 'short_term' ? 'warn' : 'good'} className="px-1.5 py-0 text-[8px]">{m.layer.replace('_', ' ')}</Badge>
                        <Badge className="px-1.5 py-0 text-[8px]">{m.category}</Badge>
                        <Meter label="imp" value={m.importance} />
                        <Meter label="conf" value={m.confidence} />
                        <span className="text-slate-600">used {m.accessCount}×</span>
                        {m.tags.map((t) => <span key={t} className="rounded bg-white/5 px-1 text-slate-500">#{t}</span>)}
                        <span className="ml-auto text-slate-600">{relativeTime(m.createdAt)}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <button onClick={(e) => { e.stopPropagation(); void togglePin(m); }} className={cn('rounded p-1.5 hover:bg-white/5', m.pinned ? 'text-amber-400' : 'text-slate-600 hover:text-amber-300')} aria-label={m.pinned ? 'Unpin' : 'Pin'}><Pin className="h-3 w-3" /></button>
                      <button onClick={(e) => { e.stopPropagation(); void remove(m); }} className="rounded p-1.5 text-slate-600 hover:bg-rose-500/10 hover:text-rose-400" aria-label="Delete memory"><Trash2 className="h-3 w-3" /></button>
                    </div>
                  </div>
                </Panel>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <Panel className="p-4">
            <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400"><Layers className="h-3.5 w-3.5" /> Layer distribution</h3>
            <div className="space-y-2">
              {(['short_term', 'long_term', 'episodic', 'knowledge'] as const).map((l) => {
                const n = layers[l] ?? 0;
                const total = Object.values(layers).reduce((a, b) => a + b, 0) || 1;
                return (
                  <div key={l}>
                    <div className="mb-0.5 flex justify-between text-[10px]"><span className="text-slate-400">{l.replace('_', ' ')}</span><span className="text-slate-500">{n}</span></div>
                    <div className="h-1 overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full rounded-full bg-holo-400/70" style={{ width: `${(n / total) * 100}%` }} /></div>
                  </div>
                );
              })}
            </div>
            <div className="hairline my-3" />
            <div className="flex items-baseline justify-between text-xs"><span className="text-slate-500">Total</span><span className="text-lg font-semibold text-slate-100">{formatNumber(stats.data?.total ?? 0)}</span></div>
          </Panel>

          <Panel className="p-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">How memory works</h3>
            <ul className="space-y-2 text-[10px] leading-relaxed text-slate-500">
              <li><strong className="text-slate-300">Short term</strong> — recent exchange context, decays quickly.</li>
              <li><strong className="text-slate-300">Long term</strong> — durable facts and preferences, retrieved by hybrid vector + keyword search.</li>
              <li><strong className="text-slate-300">Episodic</strong> — what happened in past sessions (decisions, outcomes).</li>
              <li><strong className="text-slate-300">Knowledge</strong> — grounded passages from your documents.</li>
            </ul>
            <p className="mt-2 text-[10px] leading-relaxed text-slate-600">Embeddings are deterministic hashes computed locally — no text is sent anywhere to build the index.</p>
          </Panel>

          <Panel className="p-4">
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400"><Filter className="h-3 w-3" /> Privacy</h3>
            <p className="text-[10px] leading-relaxed text-slate-500">Everything shown here lives in your local SQLite database. Export produces a JSON file with vectors stripped; deletion is immediate and permanent.</p>
            <Button className="mt-2 w-full" size="sm" variant="ghost" onClick={() => setExportOpen(true)}><Download className="h-3 w-3" /> Export memories</Button>
          </Panel>
        </div>
      </div>

      <AddMemoryModal open={addOpen} onClose={() => setAddOpen(false)} characterId={character.id} onDone={refresh} />
      <ExportModal open={exportOpen} onClose={() => setExportOpen(false)} characterId={character.id} characterName={character.name} />
    </div>
  );
}

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <span className="flex items-center gap-1 text-slate-600">
      {label}
      <span className="flex gap-[1px]">
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className={cn('h-2 w-[2px] rounded-sm', value * 5 > i ? 'bg-holo-400' : 'bg-white/10')} />
        ))}
      </span>
    </span>
  );
}

function AddMemoryModal({ open, onClose, characterId, onDone }: { open: boolean; onClose: () => void; characterId: string; onDone: () => Promise<void> }) {
  const { toast } = useApp();
  const [content, setContent] = React.useState('');
  const [layer, setLayer] = React.useState('long_term');
  const [category, setCategory] = React.useState('fact');
  const [importance, setImportance] = React.useState(0.7);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await apiPost<{ duplicate: boolean }>('/memory', { characterId, content, layer, category, importance, confidence: 1 });
      if (res.duplicate) toast({ title: 'Already remembered', description: 'A near-identical memory exists — nothing was duplicated.', tone: 'info' });
      else toast({ title: 'Memory saved', tone: 'success' });
      setContent('');
      onClose();
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save memory');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add a memory" description="Manual memories have full confidence and are never auto-pruned while pinned." footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => void submit()} loading={saving} disabled={content.trim().length < 3}>Save memory</Button></>}>
      {error ? <div className="mb-3"><ErrorState message={error} /></div> : null}
      <Field label="What should be remembered?">
        <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={4} className="input" placeholder="Prefers concise answers before 9am. Works in UTC+6." maxLength={4000} />
      </Field>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Layer"><Select value={layer} onChange={(e) => setLayer(e.target.value)}>{['short_term', 'long_term', 'episodic', 'knowledge'].map((l) => <option key={l} value={l}>{l.replace('_', ' ')}</option>)}</Select></Field>
        <Field label="Category"><Select value={category} onChange={(e) => setCategory(e.target.value)}>{CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</Select></Field>
      </div>
      <Field label={`Importance: ${Math.round(importance * 100)}%`} hint="Higher importance boosts retrieval ranking and resists pruning.">
        <input type="range" min={0} max={1} step={0.05} value={importance} onChange={(e) => setImportance(Number(e.target.value))} className="w-full accent-holo-500" />
      </Field>
    </Modal>
  );
}

function ExportModal({ open, onClose, characterId, characterName }: { open: boolean; onClose: () => void; characterId: string; characterName: string }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await apiGet<{ memories: Memory[]; exportedAt: string; format: string }>(`/memory/export?characterId=${characterId}`);
      downloadJson(`${characterName.replace(/\W+/g, '-').toLowerCase()}-memories.json`, data);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Export memories" description="Downloads a JSON file containing every memory for this character. Embedding vectors are stripped because they are derived data." footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => void run()} loading={busy}><Download className="h-3.5 w-3.5" /> Download JSON</Button></>}>
      {error ? <ErrorState message={error} /> : <p className="text-xs leading-relaxed text-slate-400">This export is portable and human-readable. Use it as a backup before clearing memory — the app never uploads it anywhere.</p>}
    </Modal>
  );
}
