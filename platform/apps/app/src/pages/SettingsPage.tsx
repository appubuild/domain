import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Database, Download, HardDrive, Keyboard, Mic, RotateCcw, Save, Shield, Sliders, Trash2, MonitorSmartphone, AlertTriangle, Check } from 'lucide-react';
import { apiGet, apiPost, apiSend } from '@/lib/api';
import type { Health, PermissionsResponse } from '@/lib/types';
import type { SettingsKey, SettingsShape } from '@/lib/settingsTypes';
import { Badge, Button, EmptyState, ErrorState, Field, Modal, Panel, Select, Skeleton, Slider, Tabs, Toggle } from '@/components/ui';
import { useApp } from '@/store/app';
import { cn, formatNumber } from '@/lib/utils';

export function SettingsPage() {
  const { health, system, toast, refreshHealth } = useApp();
  const [tab, setTab] = React.useState<'appearance' | 'voice' | 'memory' | 'privacy' | 'hotkeys' | 'permissions' | 'data'>('appearance');
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => apiGet<{ settings: SettingsShape; defaults: SettingsShape }>('/settings') });
  const permissions = useQuery({ queryKey: ['permissions'], queryFn: () => apiGet<PermissionsResponse>('/permissions') });
  const [saveState, setSaveState] = React.useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [resetOpen, setResetOpen] = React.useState(false);
  const [resetConfirm, setResetConfirm] = React.useState('');

  const save = async (key: SettingsKey, patch: Record<string, unknown>) => {
    setSaveState('saving');
    try {
      await apiSend(`/settings/${key}`, 'PUT', patch);
      await settings.refetch();
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 1600);
    } catch (err) {
      setSaveState('error');
      toast({ title: 'Settings not saved', description: err instanceof Error ? err.message : '', tone: 'error' });
    }
  };

  const reset = async () => {
    try {
      await apiPost('/system/reset', { scope: 'everything', confirm: resetConfirm });
      setResetOpen(false);
      setResetConfirm('');
      toast({ title: 'Local data cleared', description: 'Characters, conversations and memories were deleted. Provider keys were not touched.', tone: 'success' });
      window.location.reload();
    } catch (err) {
      toast({ title: 'Reset failed', description: err instanceof Error ? err.message : '', tone: 'error' });
    }
  };

  const s = settings.data?.settings;

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Settings</h2>
          <p className="mt-0.5 text-xs text-slate-500">Stored in your local database. Nothing syncs unless you configure a cloud backend.</p>
        </div>
        <span className={cn('flex items-center gap-1.5 text-[11px]', saveState === 'saved' ? 'text-emerald-400' : saveState === 'error' ? 'text-rose-400' : 'text-slate-600')}>
          {saveState === 'saved' ? <><Check className="h-3 w-3" /> saved</> : saveState === 'saving' ? 'saving…' : ''}
        </span>
      </div>

      <Tabs className="mb-4" value={tab} onChange={setTab} items={[
        { value: 'appearance', label: 'Appearance', icon: <MonitorSmartphone className="h-3.5 w-3.5" /> },
        { value: 'voice', label: 'Voice', icon: <Mic className="h-3.5 w-3.5" /> },
        { value: 'memory', label: 'Memory', icon: <Database className="h-3.5 w-3.5" /> },
        { value: 'privacy', label: 'Privacy', icon: <Shield className="h-3.5 w-3.5" /> },
        { value: 'hotkeys', label: 'Hotkeys', icon: <Keyboard className="h-3.5 w-3.5" /> },
        { value: 'permissions', label: 'Permissions', icon: <Sliders className="h-3.5 w-3.5" /> },
        { value: 'data', label: 'Data & backup', icon: <HardDrive className="h-3.5 w-3.5" /> },
      ]} />

      {settings.isLoading || !s ? <Skeleton className="h-64" /> : (
        <div className="space-y-4">
          {tab === 'appearance' ? (
            <Panel className="p-5">
              <h3 className="mb-3 text-sm font-semibold text-slate-100">Appearance</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Theme" hint="Only the dark holographic theme is production-ready; others are roadmap.">
                  <Select value={s.appearance.theme} onChange={(e) => void save('appearance', { theme: e.target.value })}>
                    <option value="midnight">Midnight (dark navy + cyan)</option>
                    <option value="system">Follow system (falls back to midnight)</option>
                  </Select>
                </Field>
                <Field label="Density">
                  <Select value={s.appearance.density} onChange={(e) => void save('appearance', { density: e.target.value })}>
                    <option value="comfortable">Comfortable</option>
                    <option value="compact">Compact</option>
                  </Select>
                </Field>
                <Field label="Avatar quality" hint="Affects render resolution and geometry detail. Lower on integrated GPUs.">
                  <Select value={s.appearance.avatarQuality} onChange={(e) => void save('appearance', { avatarQuality: e.target.value })}>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </Select>
                </Field>
              </div>
              <Toggle checked={s.appearance.reduceMotion} onChange={(v) => void save('appearance', { reduceMotion: v })} label="Reduce motion" description="Disables floating, pulsing and non-essential avatar animation." />
              <Toggle checked={s.appearance.showWorldMonitor} onChange={(v) => void save('appearance', { showWorldMonitor: v })} label="Show world monitor" description="Clock, weather and world context on the dashboard." />
            </Panel>
          ) : null}

          {tab === 'voice' ? (
            <Panel className="p-5">
              <h3 className="mb-3 text-sm font-semibold text-slate-100">Voice defaults</h3>
              <Toggle checked={s.voice.autoStartMic} onChange={(v) => void save('voice', { autoStartMic: v })} label="Start microphone automatically" description="Opens the mic as soon as a voice session starts. Browsers still require a click to grant permission." />
              <Toggle checked={s.voice.handsFree} onChange={(v) => void save('voice', { handsFree: v })} label="Hands-free conversation" description="Server VAD decides turn boundaries instead of push-to-talk." />
              <Toggle checked={s.voice.interruptionEnabled} onChange={(v) => void save('voice', { interruptionEnabled: v })} label="Allow interruptions" description="Speaking over the character cancels its audio immediately." />
              <Toggle checked={s.voice.ttsFallback} onChange={(v) => void save('voice', { ttsFallback: v })} label="Fall back to browser speech" description="When no provider TTS key exists, use the device voice. Clearly marked in the UI." />
              <Slider label="Voice activity threshold" value={s.voice.vadThreshold} min={0.1} max={0.95} step={0.05} onChange={(v) => void save('voice', { vadThreshold: v })} format={(v) => v.toFixed(2)} />
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <Field label="Wake word" hint="Detection runs locally; disabled until a provider key exists for the matching path.">
                  <input value={s.voice.wakeWord} onChange={(e) => void save('voice', { wakeWord: e.target.value })} className="input" maxLength={24} />
                </Field>
              </div>
              <Toggle checked={s.voice.wakeWordEnabled} onChange={(v) => void save('voice', { wakeWordEnabled: v })} label="Enable wake word" description="Experimental: requires the desktop runtime and an audio model. Kept off in this build." />
            </Panel>
          ) : null}

          {tab === 'memory' ? (
            <Panel className="p-5">
              <h3 className="mb-3 text-sm font-semibold text-slate-100">Memory engine</h3>
              <Toggle checked={s.memory.autoExtractEnabled} onChange={(v) => void save('memory', { autoExtractEnabled: v })} label="Extract memories automatically" description="Global default; each character can override it." />
              <Toggle checked={s.memory.autoSummarizeEnabled} onChange={(v) => void save('memory', { autoSummarizeEnabled: v })} label="Summarise long conversations" description="Rolls older turns into episodic summaries to keep context small." />
              <Toggle checked={s.memory.embeddingsEnabled} onChange={(v) => void save('memory', { embeddingsEnabled: v })} label="Vector retrieval" description="Uses the local deterministic hash embedding — no external embedding API calls." />
              <Slider label="Retention" value={s.memory.retentionDays} min={0} max={3650} step={30} onChange={(v) => void save('memory', { retentionDays: v })} format={(v) => (v === 0 ? 'forever' : `${v} days`)} />
              <Slider label="Retrieval limit" value={s.memory.retrievalLimit} min={1} max={30} step={1} onChange={(v) => void save('memory', { retrievalLimit: v })} format={(v) => `${v} items / turn`} />
            </Panel>
          ) : null}

          {tab === 'privacy' ? (
            <Panel className="p-5">
              <h3 className="mb-3 text-sm font-semibold text-slate-100">Privacy</h3>
              <Toggle checked={s.privacy.telemetryEnabled} onChange={(v) => void save('privacy', { telemetryEnabled: v })} label="Anonymous diagnostics" description="Off by default and there is no telemetry endpoint configured — enabling it records local counters only." />
              <Toggle checked={s.privacy.logPrompts} onChange={(v) => void save('privacy', { logPrompts: v })} label="Store prompt snapshots" description="Keeps the assembled prompt for debugging in the local audit log. Off by default because prompts can contain personal context." />
              <Slider label="Execution log retention" value={s.privacy.retentionDaysForLogs} min={1} max={365} step={1} onChange={(v) => void save('privacy', { retentionDaysForLogs: v })} format={(v) => `${v} days`} />
              <div className="mt-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-[11px] leading-relaxed text-slate-400">
                <p className="mb-1 font-medium text-slate-200">Where your data lives</p>
                <p>Database: <code className="font-mono text-[10px] text-holo-300">{health?.database.path}</code></p>
                <p>Workspace: <code className="font-mono text-[10px] text-holo-300">{health?.workspaceRoot}</code></p>
                <p>Vault key: <code className="font-mono text-[10px] text-holo-300">{health?.vaultKeyPath ?? '—'}</code></p>
                <p className="mt-1">Requests go only to the providers whose keys you saved. There is no AURA cloud service in this build.</p>
              </div>
            </Panel>
          ) : null}

          {tab === 'hotkeys' ? (
            <Panel className="p-5">
              <h3 className="mb-1 text-sm font-semibold text-slate-100">Global hotkeys</h3>
              <p className="mb-3 text-[11px] text-slate-500">Global shortcuts are registered by the Tauri desktop shell. In a browser they cannot be captured system-wide, so values are stored here and applied by the desktop app.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {(Object.entries(s.hotkeys) as Array<[keyof SettingsShape['hotkeys'], string]>).map(([k, v]) => (
                  <Field key={k} label={labelFor(k)} hint={k === 'stopAgent' ? 'Applied in-app now (Escape); global capture needs the desktop shell.' : 'Stored now; registered with Windows by the desktop shell.'}>
                    <input value={v} onChange={(e) => void save('hotkeys', { [k]: e.target.value })} className="input font-mono text-[11px]" />
                  </Field>
                ))}
              </div>
            </Panel>
          ) : null}

          {tab === 'permissions' ? (
            <Panel className="p-5">
              <h3 className="mb-1 text-sm font-semibold text-slate-100">Default tool permissions</h3>
              <p className="mb-3 text-[11px] leading-relaxed text-slate-500">Global default for every character. <strong className="text-slate-300">ask</strong> makes the orchestrator pause for approval on each high-risk action; <strong className="text-slate-300">deny</strong> blocks it outright.</p>
              {permissions.isLoading ? <Skeleton className="h-40" /> : permissions.error ? <ErrorState message={permissions.error.message} /> : (
                <div className="space-y-1">
                  {(permissions.data?.permissions ?? []).map((p) => (
                    <div key={p.permission} className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-white/[0.03]">
                      <div>
                        <p className="text-xs text-slate-200">{p.permission.replace(/\./g, ' · ')}</p>
                        <p className="text-[10px] text-slate-500">{p.risk} risk</p>
                      </div>
                      <Select
                        value={p.decision}
                        onChange={async (e) => {
                          // The server validates permission ids against the canonical
                          // PERMISSIONS enum, so a failure must surface, not vanish.
                          try {
                            await apiSend('/permissions', 'PUT', { permission: p.permission, decision: e.target.value });
                            await permissions.refetch();
                          } catch (err) {
                            toast({ title: 'Permission not saved', description: err instanceof Error ? err.message : '', tone: 'error' });
                            await permissions.refetch();
                          }
                        }}
                        className="w-28 py-1 text-xs"
                      >
                        <option value="allow">allow</option>
                        <option value="ask">ask</option>
                        <option value="deny">deny</option>
                      </Select>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-3 flex items-center justify-between rounded-lg border border-rose-500/25 bg-rose-500/[0.05] p-3">
                <div>
                  <p className="text-xs font-medium text-rose-200">Emergency stop</p>
                  <p className="text-[10px] text-rose-200/60">{permissions.data?.emergencyStop ? 'Engaged — all agent actions are blocked.' : 'Releases/engages the global kill switch.'}</p>
                </div>
                <Button variant={permissions.data?.emergencyStop ? 'primary' : 'danger'} size="sm" onClick={async () => { await apiPost('/permissions/emergency-stop', { engage: !permissions.data?.emergencyStop }); await permissions.refetch(); await useApp.getState().refreshHealth(); }}>
                  {permissions.data?.emergencyStop ? 'Release' : 'Engage'}
                </Button>
              </div>
            </Panel>
          ) : null}

          {tab === 'data' ? (
            <>
              <Panel className="p-5">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-100"><HardDrive className="h-4 w-4 text-holo-400" /> Storage</h3>
                {health ? (
                  <div className="space-y-1.5 text-[11px]">
                    <Row label="Database size" value={`${formatNumber(Math.round(health.database.sizeBytes / 1024))} KB`} />
                    <Row label="Schema version" value={`v${health.schemaVersion}`} />
                    <Row label="Uptime" value={`${Math.round(health.uptimeSeconds / 60)} minutes`} />
                    <Row label="Data directory" value={<span className="break-all font-mono text-[10px]">{health.dataDir}</span>} />
                    <Row label="Runtime" value={system?.capabilityMode === 'desktop' ? 'Tauri desktop' : 'Node server (browser UI)'} />
                    <Button size="sm" variant="subtle" className="mt-2" onClick={() => void refreshHealth()}>Refresh</Button>
                  </div>
                ) : <Skeleton className="h-20" />}
              </Panel>
              <Panel className="p-5">
                <h3 className="mb-2 text-sm font-semibold text-slate-100">Backup</h3>
                <p className="mb-2 text-[11px] leading-relaxed text-slate-500">Exports settings, characters, conversations and memories as JSON. Provider keys and license signatures are deliberately excluded — restore by importing characters on the My Characters page.</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="ghost" onClick={async () => {
                    try {
                      const res = await fetch('/api/system/export', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ includeConversations: true, includeMemories: true }) });
                      if (!res.ok) throw new Error(`Export failed (${res.status})`);
                      const blob = await res.blob();
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `aura-backup-${new Date().toISOString().slice(0, 10)}.json`;
                      a.click();
                      URL.revokeObjectURL(url);
                    } catch (err) {
                      toast({ title: 'Export failed', description: err instanceof Error ? err.message : '', tone: 'error' });
                    }
                  }}><Download className="h-3.5 w-3.5" /> Download backup</Button>
                </div>
              </Panel>
              <Panel className="border-rose-500/20 p-5">
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-rose-200"><AlertTriangle className="h-4 w-4" /> Danger zone</h3>
                <p className="mb-2 text-[11px] leading-relaxed text-rose-200/60">Deletes every character, conversation and memory from the local database. Provider keys remain (remove them individually on AI Models). There is no undo.</p>
                <Button variant="danger" size="sm" onClick={() => setResetOpen(true)}><Trash2 className="h-3.5 w-3.5" /> Delete all local data</Button>
              </Panel>
            </>
          ) : null}
        </div>
      )}

      <Modal open={resetOpen} onClose={() => setResetOpen(false)} title="Delete all local data?" description="Type DELETE to confirm. This removes characters, conversations and memories permanently." footer={<><Button variant="ghost" onClick={() => setResetOpen(false)}>Cancel</Button><Button variant="danger" onClick={() => void reset()} disabled={resetConfirm !== 'DELETE'}>Delete everything</Button></>}>
        <Field label="Confirmation">
          <input value={resetConfirm} onChange={(e) => setResetConfirm(e.target.value)} className="input font-mono" placeholder="DELETE" />
        </Field>
      </Modal>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex items-baseline justify-between gap-3"><span className="text-slate-500">{label}</span><span className="text-right text-slate-300">{value}</span></div>;
}

function labelFor(k: keyof SettingsShape['hotkeys']): string {
  return { activateAssistant: 'Activate assistant', pushToTalk: 'Push to talk', openDashboard: 'Open dashboard', stopAgent: 'Stop agent', toggleVoice: 'Toggle voice' }[k];
}
