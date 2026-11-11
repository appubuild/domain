import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ShieldCheck, ShieldAlert, Terminal, Globe, FolderOpen, Network, KeyRound, FastForward } from 'lucide-react';
import type { Character, Skill } from '@/lib/types';
import { Badge, Panel, Toggle, Skeleton } from '@/components/ui';
import { apiGet } from '@/lib/api';
import { useApp } from '@/store/app';

const RISKY = new Set(['computer', 'browser', 'filesystem', 'system', 'network']);

export function CharacterStudioPermissions({ draft, update }: { draft: Character; update: (m: (c: Character) => void) => void }) {
  const { system, emergencyStop } = useApp();
  const p = draft.config.permissions;
  const skills = useQuery({ queryKey: ['skills'], queryFn: () => apiGet<{ skills: Skill[] }>('/skills') });
  const set = (patch: Partial<typeof p>) => update((c) => Object.assign(c.config.permissions, patch));

  return (
    <div className="space-y-5">
      <Panel className="p-5">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-100"><ShieldCheck className="h-4 w-4 text-emerald-400" /> Capability permissions</h3>
        <p className="mb-3 text-[11px] leading-relaxed text-slate-500">
          These are the real gates the orchestrator checks before any tool runs. A skill whose permission is missing is refused server-side — the UI toggle is the source of truth, not a suggestion.
        </p>
        {!system?.capabilities.computerControl ? (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] p-2.5 text-[11px] leading-relaxed text-amber-200/80">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Computer control and browser automation require the Windows desktop runtime (Tauri bridge). In this browser/server session they cannot execute, even when enabled here.
          </div>
        ) : null}
        <Toggle checked={p.allowComputerControl} onChange={(allowComputerControl) => set({ allowComputerControl })} label="Computer control" description="Mouse, keyboard, window and app control on this machine. High risk — every action is logged and verifiable." />
        <Toggle checked={p.allowBrowserAutomation} onChange={(allowBrowserAutomation) => set({ allowBrowserAutomation })} label="Browser automation" description="Drive a real browser session to research or fill forms." />
        <Toggle checked={p.allowFileSystem} onChange={(allowFileSystem) => set({ allowFileSystem })} label="File system" description="Read and write inside the dedicated agent workspace folder only." />
        <Toggle checked={p.allowNetworkResearch} onChange={(allowNetworkResearch) => set({ allowNetworkResearch })} label="Web research" description="Fetch public web pages and search results through tools." />
      </Panel>

      <Panel className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-100">Skill overrides</h3>
          <Badge tone={emergencyStop ? 'bad' : 'neutral'}>{emergencyStop ? 'emergency stop engaged' : 'normal'}</Badge>
        </div>
        <p className="mb-3 text-[11px] leading-relaxed text-slate-500">Disable individual skills for this character. Global state (whether a skill works at all) is managed in Skills &amp; Tools.</p>
        {skills.isLoading ? <Skeleton className="h-32" /> : (
          <div className="space-y-1">
            {(skills.data?.skills ?? []).map((s) => {
              const disabled = p.disabledSkillIds.includes(s.id);
              const risky = s.permissions.some((perm) => RISKY.has(perm));
              return (
                <label key={s.id} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-white/[0.03]">
                  <input
                    type="checkbox"
                    checked={!disabled}
                    onChange={(e) => set({ disabledSkillIds: e.target.checked ? p.disabledSkillIds.filter((x) => x !== s.id) : [...p.disabledSkillIds, s.id] })}
                    className="h-3.5 w-3.5 rounded border-white/20 bg-transparent accent-holo-500"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] text-slate-300">{s.name}</span>
                    <span className="block truncate text-[10px] text-slate-600">{s.category} · {s.permissions.join(', ') || 'no permissions'}</span>
                  </span>
                  {risky ? <ShieldAlert className="h-3 w-3 shrink-0 text-amber-500" /> : null}
                  <Badge className="shrink-0 px-1.5 py-0 text-[8px]">{s.origin}</Badge>
                </label>
              );
            })}
          </div>
        )}
      </Panel>

      <Panel className="p-5">
        <h3 className="mb-2 text-sm font-semibold text-slate-100">What guards exist</h3>
        <ul className="space-y-1.5 text-[11px] leading-relaxed text-slate-400">
          <Guard icon={<KeyRound className="h-3 w-3" />} text="Provider keys are encrypted at rest with a machine-bound key and never sent to the browser." />
          <Guard icon={<Terminal className="h-3 w-3" />} text="Shell execution is disabled by default and rejects unsafe commands even when a skill requests it." />
          <Guard icon={<FolderOpen className="h-3 w-3" />} text="File operations are sandboxed to the workspace directory with path traversal rejection." />
          <Guard icon={<Globe className="h-3 w-3" />} text="High-risk actions require explicit confirmation per task and produce an audit entry." />
          <Guard icon={<Network className="h-3 w-3" />} text="Fetched web content is treated as untrusted data, never as instructions." />
          <Guard icon={<FastForward className="h-3 w-3" />} text="Emergency stop halts scheduling immediately and blocks every subsequent tool call." />
        </ul>
      </Panel>
    </div>
  );
}

function Guard({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-0.5 text-holo-500">{icon}</span>
      <span>{text}</span>
    </li>
  );
}
