import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Copy, Download, Plus, Sparkles, Star, Trash2, Upload, UserRound, Volume2, Brain, ShieldCheck } from 'lucide-react';
import { useApp } from '@/store/app';
import { apiDelete, apiGet, apiPost } from '@/lib/api';
import type { Character, CharacterExport } from '@/lib/types';
import { AvatarStage } from '@/components/avatar/AvatarStage';
import { Badge, Button, EmptyState, ErrorState, Modal, Panel, Skeleton } from '@/components/ui';
import { cn, downloadJson, relativeTime } from '@/lib/utils';

export function CharactersPage() {
  const { characters, activeCharacterId, setActiveCharacter, refreshCharacters, templates, toast } = useApp();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState<Character | null>(null);
  const [newName, setNewName] = React.useState('');
  const [template, setTemplate] = React.useState<string>('');
  const [createOpen, setCreateOpen] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [error, setError] = React.useState<string | null>(null);

  const create = async () => {
    if (!template) return;
    setBusy('create');
    setError(null);
    try {
      const res = await apiPost<{ character: Character }>('/characters', { fromTemplate: true, templateKey: template, name: newName.trim() || undefined, makeDefault: characters.length === 0 });
      await refreshCharacters();
      setActiveCharacter(res.character.id);
      setCreateOpen(false);
      setNewName('');
      toast({ title: `${res.character.name} is ready`, description: 'Open Character Studio to fine-tune personality, voice and permissions.', tone: 'success' });
      navigate(`/studio/${res.character.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create character');
    } finally {
      setBusy(null);
    }
  };

  const duplicate = async (c: Character) => {
    setBusy(c.id);
    try {
      const res = await apiPost<{ character: Character }>(`/characters/${c.id}/duplicate`, {});
      await refreshCharacters();
      toast({ title: `Duplicated as ${res.character.name}`, tone: 'success' });
    } catch (err) {
      toast({ title: 'Duplicate failed', description: err instanceof Error ? err.message : '', tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const makeDefault = async (c: Character) => {
    try {
      await apiPost(`/characters/${c.id}/default`, {});
      await refreshCharacters();
      toast({ title: `${c.name} is now the default character`, tone: 'success' });
    } catch (err) {
      toast({ title: 'Could not set default', description: err instanceof Error ? err.message : '', tone: 'error' });
    }
  };

  const exportCharacter = async (c: Character) => {
    try {
      const res = await apiGet<CharacterExport & { character: unknown }>(`/characters/${c.id}/export`);
      downloadJson(`${c.name.replace(/\W+/g, '-').toLowerCase()}.aura.json`, res);
    } catch (err) {
      toast({ title: 'Export failed', description: err instanceof Error ? err.message : '', tone: 'error' });
    }
  };

  const importCharacter = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as CharacterExport;
      const res = await apiPost<{ character: Character; renamed: boolean }>('/characters/import', parsed);
      await refreshCharacters();
      toast({ title: `Imported ${res.character.name}`, description: res.renamed ? 'Name was adjusted to avoid a clash.' : 'Character settings restored.', tone: 'success' });
    } catch (err) {
      toast({ title: 'Import failed', description: err instanceof Error ? err.message : 'Invalid character file', tone: 'error' });
    }
  };

  const remove = async (c: Character) => {
    try {
      await apiDelete(`/characters/${c.id}`);
      await qc.invalidateQueries();
      await refreshCharacters();
      setConfirmDelete(null);
      toast({ title: `${c.name} deleted`, description: 'Conversations, memories and documents for this character were removed.', tone: 'success' });
    } catch (err) {
      toast({ title: 'Delete failed', description: err instanceof Error ? err.message : '', tone: 'error' });
    }
  };

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Your characters</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {characters.length} character{characters.length === 1 ? '' : 's'} · each with its own memory, voice, model and permissions
          </p>
        </div>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importCharacter(f); e.currentTarget.value = ''; }} />
          <Button variant="ghost" onClick={() => fileRef.current?.click()}>
            <Upload className="h-3.5 w-3.5" /> Import
          </Button>
          <Button variant="primary" onClick={() => { setCreateOpen(true); setTemplate(templates[0]?.key ?? ''); }}>
            <Plus className="h-4 w-4" /> New character
          </Button>
        </div>
      </div>

      {error ? <div className="mb-4"><ErrorState message={error} /></div> : null}

      {characters.length === 0 ? (
        <EmptyState
          title="No characters yet"
          description="Start from one of seven built-in templates. Everything — avatar, personality, voice and permissions — is editable afterwards."
          icon={<UserRound className="h-5 w-5" />}
          action={<Button variant="primary" onClick={() => { setCreateOpen(true); setTemplate(templates[0]?.key ?? ''); }}><Plus className="h-4 w-4" /> Create from template</Button>}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {characters.map((c) => {
            const isActive = c.id === activeCharacterId;
            return (
              <Panel key={c.id} className={cn('overflow-hidden transition-all', isActive ? 'ring-1 ring-holo-500/40' : 'panel-hover')}>
                <div className="relative">
                  <AvatarStage spec={c.avatarSpec} height={200} mode="compact" quality="low" />
                  <div className="absolute left-3 top-3 flex gap-1.5">
                    {c.isDefault ? <Badge tone="accent"><Star className="h-2.5 w-2.5" /> default</Badge> : null}
                    {isActive ? <Badge tone="good">active</Badge> : null}
                  </div>
                  <div className="absolute right-3 top-3">
                    <Badge>{c.config.characterType}</Badge>
                  </div>
                </div>
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold text-slate-100">{c.name}</h3>
                      <p className="mt-0.5 truncate text-[11px] text-slate-500">{c.config.visualStyle} · {c.templateKey}</p>
                    </div>
                    <button onClick={() => void makeDefault(c)} disabled={c.isDefault} className={cn('rounded-lg p-1.5', c.isDefault ? 'text-amber-300' : 'text-slate-600 hover:bg-white/5 hover:text-amber-300')} title={c.isDefault ? 'Default character' : 'Make default'} aria-label="Make default">
                      <Star className="h-3.5 w-3.5" fill={c.isDefault ? 'currentColor' : 'none'} />
                    </button>
                  </div>
                  <p className="mt-2 line-clamp-2 min-h-[32px] text-[11px] leading-relaxed text-slate-400">{c.config.description}</p>
                  <div className="mt-3 grid grid-cols-3 gap-1.5 text-[10px]">
                    <Chip icon={<Brain className="h-2.5 w-2.5" />} text={c.stats ? `${c.stats.memoryCount} mem` : 'mem'} />
                    <Chip icon={<Volume2 className="h-2.5 w-2.5" />} text={c.config.voice.voiceId || c.config.voice.provider} />
                    <Chip icon={<ShieldCheck className="h-2.5 w-2.5" />} text={permissionSummary(c)} />
                  </div>
                  <p className="mt-2 text-[10px] text-slate-600">Updated {relativeTime(c.updatedAt)}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Button size="sm" variant="primary" className="flex-1" onClick={() => { setActiveCharacter(c.id); navigate('/voice'); }}>
                      Talk
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => navigate(`/studio/${c.id}`)}>
                      <Sparkles className="h-3 w-3" /> Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setActiveCharacter(c.id)} disabled={isActive} title="Set active">
                      Use
                    </Button>
                  </div>
                  <div className="mt-1.5 flex justify-end gap-0.5">
                    <IconBtn label="Duplicate" onClick={() => void duplicate(c)} loading={busy === c.id}><Copy className="h-3 w-3" /></IconBtn>
                    <IconBtn label="Export" onClick={() => void exportCharacter(c)}><Download className="h-3 w-3" /></IconBtn>
                    <IconBtn label="Delete" danger onClick={() => setConfirmDelete(c)}><Trash2 className="h-3 w-3" /></IconBtn>
                  </div>
                </div>
              </Panel>
            );
          })}

          <button onClick={() => { setCreateOpen(true); setTemplate(templates[0]?.key ?? ''); }} className="flex min-h-[300px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/10 text-slate-500 transition-colors hover:border-holo-500/30 hover:text-holo-300">
            <Plus className="h-6 w-6" />
            <span className="text-xs">Create from template</span>
          </button>
        </div>
      )}

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create a character"
        description="Pick a starting point. You can change every detail afterwards — the template only seeds sensible defaults."
        width="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => void create()} loading={busy === 'create'} disabled={!template}>Create character</Button>
          </>
        }
      >
        <div className="space-y-4">
          <label className="block space-y-1.5">
            <span className="label">Name (optional)</span>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Nova, Atlas, Vera" maxLength={60} className="input" />
          </label>
          {templates.length === 0 ? <Skeleton className="h-40" /> : (
            <div className="grid gap-2 sm:grid-cols-2">
              {templates.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTemplate(t.key)}
                  className={cn('rounded-xl border p-3 text-left transition-all', template === t.key ? 'border-holo-500/50 bg-holo-500/[0.08]' : 'border-white/[0.06] bg-white/[0.02] hover:border-white/15')}
                >
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.accent }} />
                    <span className="text-xs font-medium text-slate-100">{t.name}</span>
                    <Badge className="ml-auto">{t.renderFamily}</Badge>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{t.tagline}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {t.personalityPreview.traits.slice(0, 3).map((tr) => (
                      <span key={tr} className="rounded bg-white/5 px-1.5 py-0.5 text-[9px] text-slate-400">{tr}</span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </Modal>

      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title={`Delete ${confirmDelete?.name ?? 'character'}?`}
        description="This permanently deletes the character, its conversations, memories and knowledge documents from the local database. Export it first if you want a backup."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Keep character</Button>
            <Button variant="danger" onClick={() => confirmDelete && void remove(confirmDelete)}>Delete permanently</Button>
          </>
        }
      />
    </div>
  );
}

function Chip({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <span className="flex items-center gap-1 truncate rounded-md border border-white/[0.06] bg-white/[0.03] px-1.5 py-1 text-slate-400">
      {icon}
      <span className="truncate">{text}</span>
    </span>
  );
}

function IconBtn({ children, label, onClick, danger, loading }: { children: React.ReactNode; label: string; onClick: () => void; danger?: boolean; loading?: boolean }) {
  return (
    <button onClick={onClick} disabled={loading} aria-label={label} title={label} className={cn('rounded-md p-1.5 text-slate-600 transition-colors hover:bg-white/5', danger ? 'hover:text-rose-400' : 'hover:text-slate-200')}>
      {children}
    </button>
  );
}

function permissionSummary(c: Character): string {
  const p = c.config.permissions;
  const on = [p.allowComputerControl && 'PC', p.allowBrowserAutomation && 'web', p.allowFileSystem && 'files'].filter(Boolean);
  return on.length ? on.join(' · ') : 'no tools';
}
