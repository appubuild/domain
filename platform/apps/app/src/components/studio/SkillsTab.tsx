import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Wrench, ShieldAlert, Search } from 'lucide-react';
import type { Character, Skill } from '@/lib/types';
import { Badge, Panel, Skeleton } from '@/components/ui';
import { apiGet } from '@/lib/api';

const CATEGORY_LABELS: Record<string, string> = {
  information: 'Information',
  files: 'Files',
  system: 'System',
  browser: 'Browser',
  communication: 'Communication',
  productivity: 'Productivity',
  memory: 'Memory',
  media: 'Media',
  developer: 'Developer',
};

export function CharacterStudioSkills({ draft, update }: { draft: Character; update: (m: (c: Character) => void) => void }) {
  const [q, setQ] = React.useState('');
  const skills = useQuery({ queryKey: ['skills'], queryFn: () => apiGet<{ skills: Skill[] }>('/skills') });
  const disabled = draft.config.permissions.disabledSkillIds;
  const toggle = (id: string, on: boolean) =>
    update((c) => {
      c.config.permissions.disabledSkillIds = on ? c.config.permissions.disabledSkillIds.filter((x) => x !== id) : [...c.config.permissions.disabledSkillIds, id];
    });

  const filtered = (skills.data?.skills ?? []).filter((s) => !q || s.name.toLowerCase().includes(q.toLowerCase()) || s.id.includes(q.toLowerCase()));
  const grouped = filtered.reduce<Record<string, Skill[]>>((acc, s) => {
    (acc[s.category] ??= []).push(s);
    return acc;
  }, {});

  return (
    <div className="space-y-5">
      <Panel className="p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-100"><Wrench className="h-4 w-4 text-holo-400" /> Skills available to {draft.name}</h3>
        <p className="mb-3 mt-1 text-[11px] leading-relaxed text-slate-500">
          Each skill declares its own permissions. Disabling one here removes it from this character&apos;s tool list; the server also re-checks permissions and global state before running anything.
        </p>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-600" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter skills…" className="input pl-9 text-xs" aria-label="Filter skills" />
        </div>
      </Panel>

      {skills.isLoading ? <Skeleton className="h-64" /> : (
        Object.entries(grouped).map(([cat, list]) => (
          <Panel key={cat} className="p-5">
            <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{CATEGORY_LABELS[cat] ?? cat}</h4>
            <div className="space-y-1">
              {list.map((s) => {
                const enabled = !disabled.includes(s.id);
                return (
                  <div key={s.id} className="flex items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-white/[0.03]">
                    <input type="checkbox" checked={enabled} onChange={(e) => toggle(s.id, e.target.checked)} className="mt-0.5 h-3.5 w-3.5 accent-holo-500" aria-label={`Enable ${s.name}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[11px] font-medium text-slate-300">{s.name}</span>
                        {s.origin !== 'builtin' ? <Badge className="px-1.5 py-0 text-[8px]">{s.origin}</Badge> : null}
                        {s.permissions.some((p) => ['computer', 'shell', 'filesystem'].includes(p)) ? <ShieldAlert className="h-3 w-3 text-amber-500" /> : null}
                      </div>
                      <p className="text-[10px] leading-relaxed text-slate-500">{s.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>
        ))
      )}
    </div>
  );
}
