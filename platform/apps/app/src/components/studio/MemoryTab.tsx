import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Brain, Layers, Search, Trash2 } from 'lucide-react';
import type { Character, Memory } from '@/lib/types';
import { Badge, Button, Field, Modal, Panel, Select, Skeleton, Slider, Toggle } from '@/components/ui';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';
import { useApp } from '@/store/app';
import { relativeTime } from '@/lib/utils';

const LAYERS = ['short_term', 'long_term', 'episodic', 'knowledge'] as const;

export function CharacterStudioMemory({ draft, update, updateConfig }: { draft: Character; update: (m: (c: Character) => void) => void; updateConfig: (p: Partial<Character['config']>) => void }) {
  const { toast } = useApp();
  const m = draft.config.memory;
  const [layer, setLayer] = React.useState<(typeof LAYERS)[number]>('long_term');
  const [confirmClear, setConfirmClear] = React.useState(false);

  const memories = useQuery({
    queryKey: ['memory', draft.id, layer],
    queryFn: () => apiGet<{ memories: Memory[] }>(`/memory?characterId=${draft.id}&layer=${layer}&limit=100`),
  });

  const counts = useQuery({
    queryKey: ['character-detail', draft.id],
    queryFn: () => apiGet<{ stats?: { memories?: Record<string, number> } }>(`/characters/${draft.id}`),
  });

  const pin = async (mem: Memory) => {
    try {
      await apiPatch(`/memory/${mem.id}`, { pinned: !mem.pinned });
      await memories.refetch();
    } catch (err) {
      toast({ title: 'Update failed', description: err instanceof Error ? err.message : '', tone: 'error' });
    }
  };

  const forget = async (mem: Memory) => {
    try {
      await apiDelete(`/memory/${mem.id}`);
      await memories.refetch();
    } catch (err) {
      toast({ title: 'Delete failed', description: err instanceof Error ? err.message : '', tone: 'error' });
    }
  };

  const clearLayer = async () => {
    try {
      await apiPost('/memory/clear', { characterId: draft.id, layer });
      setConfirmClear(false);
      await memories.refetch();
      toast({ title: `Cleared ${layer.replace('_', ' ')} memory`, tone: 'success' });
    } catch (err) {
      toast({ title: 'Clear failed', description: err instanceof Error ? err.message : '', tone: 'error' });
    }
  };

  return (
    <div className="space-y-5">
      <Panel className="p-5">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-100"><Layers className="h-4 w-4 text-violet-400" /> Memory policy</h3>
        <Toggle checked={m.autoExtract} onChange={(autoExtract) => updateConfig({ memory: { ...m, autoExtract } })} label="Extract memories automatically" description="After each exchange, the model proposes durable facts and preferences. Low-confidence items are discarded." />
        <Toggle checked={m.shareLongTermAcrossCharacters} onChange={(shareLongTermAcrossCharacters) => updateConfig({ memory: { ...m, shareLongTermAcrossCharacters } })} label="Share long-term memory across characters" description="Off by default: each character keeps an isolated memory space." />
        <Slider label="Retention" value={m.retentionDays} min={0} max={3650} step={30} onChange={(retentionDays) => updateConfig({ memory: { ...m, retentionDays } })} format={(v) => (v === 0 ? 'keep forever' : `${v} days`)} />
      </Panel>

      <Panel className="p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-100"><Brain className="h-4 w-4 text-holo-400" /> Stored memories</h3>
          <div className="flex gap-1.5">
            <Select value={layer} onChange={(e) => setLayer(e.target.value as typeof layer)} className="h-8 py-1 text-[11px]">
              {LAYERS.map((l) => <option key={l} value={l}>{l.replace('_', ' ')} ({counts.data?.stats?.memories?.[l] ?? '—'})</option>)}
            </Select>
            <Button size="sm" variant="danger" onClick={() => setConfirmClear(true)} disabled={!memories.data?.memories.length}>
              <Trash2 className="h-3 w-3" /> Clear
            </Button>
          </div>
        </div>
        {memories.isLoading ? <Skeleton className="h-24" /> : (memories.data?.memories.length ?? 0) === 0 ? (
          <p className="py-8 text-center text-xs text-slate-600">No {layer.replace('_', ' ')} memories yet. They accumulate as you talk to {draft.name}.</p>
        ) : (
          <div className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1">
            {memories.data!.memories.map((mem) => (
              <div key={mem.id} className="group rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5">
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-slate-300">{mem.content}</p>
                  <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button onClick={() => void pin(mem)} className="rounded p-1 text-slate-600 hover:text-amber-300" aria-label={mem.pinned ? 'Unpin' : 'Pin'} title={mem.pinned ? 'Unpin' : 'Pin (never decays)'}>
                      <span className={mem.pinned ? 'text-amber-400' : ''}>★</span>
                    </button>
                    <button onClick={() => void forget(mem)} className="rounded p-1 text-slate-600 hover:text-rose-400" aria-label="Forget memory">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[9px]">
                  <Badge className="px-1.5 py-0 text-[8px]">{mem.category}</Badge>
                  <span className="text-slate-600">importance {(mem.importance * 100).toFixed(0)}%</span>
                  <span className="text-slate-600">confidence {(mem.confidence * 100).toFixed(0)}%</span>
                  <span className="text-slate-600">used {mem.accessCount}×</span>
                  {mem.pinned ? <span className="text-amber-400">pinned</span> : null}
                  <span className="ml-auto text-slate-600">{relativeTime(mem.createdAt)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Modal
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title={`Clear ${layer.replace('_', ' ')} memory?`}
        description={`This permanently deletes every ${layer.replace('_', ' ')} memory for ${draft.name}. It cannot be undone. Export first from the Memory Center if you need a copy.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmClear(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => void clearLayer()}>Clear memories</Button>
          </>
        }
      />
    </div>
  );
}
