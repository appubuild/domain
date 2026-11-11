import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronRight, Code2, Play, Search, ShieldAlert, Upload, Wrench, X, FileJson } from 'lucide-react';
import { useActiveCharacter, useApp } from '@/store/app';
import { apiGet, apiPost, apiSend } from '@/lib/api';
import type { Skill } from '@/lib/types';
import { Badge, Button, EmptyState, ErrorState, Modal, Panel, Skeleton, Tabs, Toggle } from '@/components/ui';
import { cn } from '@/lib/utils';

export function SkillsPage() {
  const character = useActiveCharacter();
  const { toast } = useApp();
  const [q, setQ] = React.useState('');
  const [selected, setSelected] = React.useState<Skill | null>(null);
  const [runOpen, setRunOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const skills = useQuery({ queryKey: ['skills'], queryFn: () => apiGet<{ skills: Skill[]; warnings: string[] }>('/skills') });

  const toggle = async (s: Skill, enabled: boolean) => {
    try {
      await apiSend(`/skills/${s.id}`, 'PUT', { enabled });
      await skills.refetch();
      toast({ title: `${s.name} ${enabled ? 'enabled' : 'disabled'}`, tone: 'success' });
    } catch (err) {
      toast({ title: 'Update failed', description: err instanceof Error ? err.message : '', tone: 'error' });
    }
  };

  const filtered = (skills.data?.skills ?? []).filter((s) => !q || `${s.name} ${s.description} ${s.id} ${s.category}`.toLowerCase().includes(q.toLowerCase()));
  const grouped = filtered.reduce<Record<string, Skill[]>>((acc, s) => {
    const bucket = acc[s.category] ?? (acc[s.category] = []);
    bucket.push(s);
    return acc;
  }, {});

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Skills &amp; tools</h2>
          <p className="mt-0.5 text-xs text-slate-500">{(skills.data?.skills ?? []).length} registered skills · {filtered.filter((s) => s.enabled).length} enabled</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setImportOpen(true)}><Upload className="h-3.5 w-3.5" /> Import skill</Button>
        </div>
      </div>

      {skills.data?.warnings?.length ? (
        <div className="mb-4 space-y-1">
          {skills.data.warnings.map((w) => (
            <div key={w} className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.05] p-2.5 text-[11px] text-amber-200/80"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{w}</div>
          ))}
        </div>
      ) : null}

      <div className="relative mb-4 max-w-md">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-600" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search skills…" className="input pl-9 text-xs" aria-label="Search skills" />
      </div>

      {skills.isLoading ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"><Skeleton className="h-32" /><Skeleton className="h-32" /><Skeleton className="h-32" /></div> : filtered.length === 0 ? <EmptyState title="No skills match" description="Try a different search term." icon={<Wrench className="h-5 w-5" />} /> : (
        <div className="space-y-5">
          {Object.entries(grouped).map(([cat, list]) => (
            <div key={cat}>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{cat}</h3>
              <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                {list.map((s) => (
                  <Panel key={s.id} className={cn('panel-hover group cursor-pointer p-4', !s.enabled && 'opacity-60')} onClick={() => setSelected(s)}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className={cn('dot', s.enabled ? 'bg-emerald-400' : 'bg-slate-600')} />
                        <h4 className="text-xs font-semibold text-slate-100">{s.name}</h4>
                      </div>
                      <Badge className="px-1.5 py-0 text-[8px]">{s.origin}</Badge>
                    </div>
                    <p className="mt-1.5 line-clamp-2 min-h-[30px] text-[11px] leading-relaxed text-slate-400">{s.description}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      {s.permissions.map((p) => (
                        <span key={p} className={cn('rounded px-1.5 py-0.5 text-[9px]', ['computer', 'shell', 'filesystem'].includes(p) ? 'bg-amber-500/10 text-amber-300' : 'bg-white/5 text-slate-500')}>{p}</span>
                      ))}
                      <ChevronRight className="ml-auto h-3 w-3 text-slate-700 group-hover:text-holo-400" />
                    </div>
                  </Panel>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <SkillDetail skill={selected} onClose={() => setSelected(null)} onToggle={toggle} onRun={() => setRunOpen(true)} characterId={character?.id ?? ''} />
      {selected ? <RunSkillModal skill={selected} open={runOpen} onClose={() => setRunOpen(false)} characterId={character?.id ?? ''} /> : null}
      <ImportSkillModal open={importOpen} onClose={() => setImportOpen(false)} onDone={() => skills.refetch()} />
    </div>
  );
}

function SkillDetail({ skill, onClose, onToggle, onRun, characterId }: { skill: Skill | null; onClose: () => void; onToggle: (s: Skill, enabled: boolean) => Promise<void>; onRun: () => void; characterId: string }) {
  if (!skill) return null;
  return (
    <Modal open onClose={onClose} title={skill.name} description={skill.description} width="lg" footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button variant="primary" onClick={onRun} disabled={!skill.enabled || !characterId}><Play className="h-3.5 w-3.5" /> Test run</Button></>}>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={skill.enabled ? 'good' : 'neutral'}>{skill.enabled ? 'enabled' : 'disabled'}</Badge>
          <Badge>{skill.category}</Badge>
          <Badge>v{skill.version}</Badge>
          <Badge tone={skill.origin === 'builtin' ? 'accent' : 'warn'}>{skill.origin}</Badge>
        </div>
        <div>
          <p className="label mb-1">Permissions required</p>
          <div className="flex flex-wrap gap-1">{skill.permissions.length === 0 ? <span className="text-[11px] text-slate-500">None — read-only computation</span> : skill.permissions.map((p) => <span key={p} className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">{p}</span>)}</div>
        </div>
        <div>
          <p className="label mb-1">Input schema</p>
          <pre className="max-h-40 overflow-auto rounded-lg border border-white/[0.06] bg-ink-950/70 p-2.5 font-mono text-[10px] leading-relaxed text-slate-400">{JSON.stringify(skill.inputSchema, null, 2)}</pre>
        </div>
        <div>
          <p className="label mb-1">Verification</p>
          <p className="text-[11px] text-slate-400">{skill.verification.kind} — {skill.verification.description}</p>
        </div>
        <Toggle checked={skill.enabled} onChange={(v) => void onToggle(skill, v)} label="Enabled globally" description="Disabled skills are hidden from every character's tool list." />
      </div>
    </Modal>
  );
}

function RunSkillModal({ skill, open, onClose, characterId }: { skill: Skill; open: boolean; onClose: () => void; characterId: string }) {
  const [args, setArgs] = React.useState('{}');
  const [running, setRunning] = React.useState(false);
  const [result, setResult] = React.useState<{ ok: boolean; output?: unknown; error?: string } | null>(null);
  const run = async () => {
    setRunning(true);
    setResult(null);
    try {
      let parsed: unknown = {};
      try {
        parsed = args.trim() ? JSON.parse(args) : {};
      } catch {
        setResult({ ok: false, error: 'Arguments must be valid JSON.' });
        setRunning(false);
        return;
      }
      const res = await apiPost<{ ok: boolean; output?: unknown; error?: string; denied?: boolean }>(`/skills/${skill.id}/run`, { characterId, args: parsed, approved: true });
      setResult({ ok: res.ok, output: res.output, error: res.error });
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : 'Run failed' });
    } finally {
      setRunning(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title={`Test ${skill.name}`} description="Runs the skill directly on the server with the active character's permissions. Real side effects occur for file / system skills." footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button variant="primary" onClick={() => void run()} loading={running}><Play className="h-3.5 w-3.5" /> Run</Button></>}>
      <p className="label mb-1">Arguments (JSON)</p>
      <textarea value={args} onChange={(e) => setArgs(e.target.value)} rows={5} className="input font-mono text-[11px]" spellCheck={false} />
      {result ? (
        <div className={cn('mt-3 rounded-lg border p-2.5', result.ok ? 'border-emerald-500/20 bg-emerald-500/[0.05]' : 'border-rose-500/20 bg-rose-500/[0.05]')}>
          <p className={cn('text-[11px] font-medium', result.ok ? 'text-emerald-300' : 'text-rose-300')}>{result.ok ? 'Success' : 'Failed / denied'}</p>
          <pre className="mt-1 max-h-52 overflow-auto whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-slate-300">{result.error ?? JSON.stringify(result.output, null, 2)}</pre>
        </div>
      ) : null}
    </Modal>
  );
}

function ImportSkillModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => Promise<unknown> }) {
  const { toast } = useApp();
  const [json, setJson] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const parsed = JSON.parse(json) as Record<string, unknown>;
      await apiPost('/skills/import', parsed);
      toast({ title: 'Skill imported', description: 'New skills start disabled — review permissions before enabling.', tone: 'success' });
      onClose();
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Import a skill" description="Paste a skill manifest exported from AURA. Imported skills are untrusted by default: they start disabled and cannot execute shell commands." width="lg" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => void submit()} loading={busy} disabled={!json.trim()}>Import</Button></>}>
      {error ? <div className="mb-2"><ErrorState message={error} /></div> : null}
      <textarea value={json} onChange={(e) => setJson(e.target.value)} rows={12} className="input font-mono text-[10px]" placeholder='{ "id": "my.skill", "name": "My skill", ... }' spellCheck={false} />
      <p className="mt-2 flex items-start gap-1.5 text-[10px] leading-relaxed text-amber-200/60"><ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" />Skill manifests declare — but never grant — permissions. The server enforces the real gates.</p>
    </Modal>
  );
}
