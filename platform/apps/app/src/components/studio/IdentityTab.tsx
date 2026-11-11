import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Field, Panel, Select } from '@/components/ui';
import { apiGet } from '@/lib/api';
import type { Character, Conversation } from '@/lib/types';
import { formatNumber, relativeTime } from '@/lib/utils';

/** Identity: what this character *is* — name, purpose, expertise, language. */
export function CharacterStudioIdentity({ draft, update }: { draft: Character; update: (m: (c: Character) => void) => void }) {
  const detail = useQuery({
    queryKey: ['character-detail', draft.id],
    queryFn: () => apiGet<{ character: Character; stats?: { memories?: Record<string, number>; conversations?: number } }>(`/characters/${draft.id}`),
  });
  // The detail endpoint is informational: a partial payload must degrade to "—", never crash.
  const memoryCount = Object.values(detail.data?.stats?.memories ?? {}).reduce((a, b) => a + b, 0);
  const convs = useQuery({
    queryKey: ['conversations', 'studio', draft.id],
    queryFn: () => apiGet<{ conversations: Conversation[] }>(`/conversations?characterId=${draft.id}`),
  });

  return (
    <div className="space-y-5">
      <Panel className="p-5">
        <h3 className="mb-4 text-sm font-semibold text-slate-100">Identity</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" hint="Used in prompts, transcripts and the UI.">
            <input value={draft.name} onChange={(e) => update((c) => { c.name = e.target.value; })} maxLength={60} className="input" />
          </Field>
          <Field label="Character type">
            <Select value={draft.config.characterType} onChange={(e) => update((c) => { c.config.characterType = e.target.value as Character['config']['characterType']; })}>
              {['assistant', 'companion', 'specialist', 'custom'].map((v) => <option key={v} value={v}>{v}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Description" hint="What this character is for. Shown in lists and given to the planner as context.">
          <textarea value={draft.config.description} onChange={(e) => update((c) => { c.config.description = e.target.value; })} rows={3} maxLength={2000} className="input" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Visual style" hint="Short label for the look.">
            <input value={draft.config.visualStyle} onChange={(e) => update((c) => { c.config.visualStyle = e.target.value; })} maxLength={120} className="input" />
          </Field>
          <Field label="Language">
            <input value={draft.config.language} onChange={(e) => update((c) => { c.config.language = e.target.value; })} maxLength={16} className="input" placeholder="en" />
          </Field>
        </div>
        <Field label="Expertise" hint="Comma separated. Boosts relevance for memories and skills.">
          <input value={draft.config.expertise.join(', ')} onChange={(e) => update((c) => { c.config.expertise = e.target.value.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20); })} className="input" placeholder="Distributed systems, Rust, technical writing" />
        </Field>
      </Panel>

      <Panel className="p-5">
        <h3 className="mb-3 text-sm font-semibold text-slate-100">Footprint</h3>
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <Metric label="Memories" value={detail.isSuccess ? formatNumber(memoryCount) : '—'} />
          <Metric label="Chats" value={detail.data?.stats?.conversations !== undefined ? String(detail.data.stats.conversations) : '—'} />
          <Metric label="Created" value={relativeTime(draft.createdAt)} />
          <Metric label="Updated" value={relativeTime(draft.updatedAt)} />
        </div>
        <div className="mt-4">
          <p className="label mb-2">Recent conversations</p>
          <div className="space-y-1">
            {(convs.data?.conversations ?? []).slice(0, 4).map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-lg bg-white/[0.02] px-2.5 py-1.5 text-[11px]">
                <span className="truncate text-slate-300">{c.title}</span>
                <span className="text-slate-600">{relativeTime(c.updatedAt)}</span>
              </div>
            ))}
            {(convs.data?.conversations ?? []).length === 0 ? <p className="text-[11px] text-slate-600">No conversations yet.</p> : null}
          </div>
        </div>
      </Panel>

      <Panel className="p-5">
        <h3 className="mb-2 text-sm font-semibold text-slate-100">Asset provenance</h3>
        <p className="text-[11px] leading-relaxed text-slate-500">
          This character is rendered from an original <strong className="text-slate-300">procedural rig</strong> — geometry generated from the AvatarSpec below, driven by the avatar engine. No third-party model assets are bundled.
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge>procedural</Badge>
          <Badge>licensed: original</Badge>
          <Badge tone="warn">VRM import requires your own licensed model</Badge>
        </div>
      </Panel>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
      <p className="text-[9px] uppercase tracking-wider text-slate-600">{label}</p>
      <p className="mt-0.5 truncate text-sm text-slate-200">{value}</p>
    </div>
  );
}
