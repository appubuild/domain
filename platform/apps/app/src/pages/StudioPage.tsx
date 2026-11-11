import * as React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Brain, Check, Cpu, Eye, Fingerprint, Palette, Save, ShieldCheck, Sparkles, Volume2, Wand2, AlertTriangle, RotateCcw, Mic, MessageSquare, BookOpen, Sliders,
} from 'lucide-react';
import { useApp } from '@/store/app';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import type { Character, CharacterConfig } from '@/lib/types';
import { AvatarStage } from '@/components/avatar/AvatarStage';
import { AvatarOrb } from '@/components/avatar/AvatarOrb';
import { Badge, Button, ErrorState, Field, Modal, Panel, Select, Skeleton, Slider, Tabs, Toggle } from '@/components/ui';
import { cn } from '@/lib/utils';
import { CharacterStudioVoice } from '@/components/studio/VoiceTab';
import { CharacterStudioIntelligence } from '@/components/studio/IntelligenceTab';
import { CharacterStudioMemory } from '@/components/studio/MemoryTab';
import { CharacterStudioPermissions } from '@/components/studio/PermissionsTab';
import { CharacterStudioAvatar } from '@/components/studio/AvatarTab';
import { CharacterStudioIdentity } from '@/components/studio/IdentityTab';
import { CharacterStudioSkills } from '@/components/studio/SkillsTab';
import { CharacterStudioKnowledge } from '@/components/studio/KnowledgeTab';
import { CharacterStudioBehaviour } from '@/components/studio/BehaviourTab';

type TabKey = 'identity' | 'avatar' | 'personality' | 'voice' | 'intelligence' | 'memory' | 'skills' | 'knowledge' | 'behaviour' | 'permissions';

const TABS: Array<{ value: TabKey; label: string; icon: React.ReactNode }> = [
  { value: 'identity', label: 'Identity', icon: <Fingerprint className="h-3.5 w-3.5" /> },
  { value: 'avatar', label: 'Avatar', icon: <Palette className="h-3.5 w-3.5" /> },
  { value: 'personality', label: 'Personality', icon: <Sparkles className="h-3.5 w-3.5" /> },
  { value: 'voice', label: 'Voice', icon: <Volume2 className="h-3.5 w-3.5" /> },
  { value: 'intelligence', label: 'Intelligence', icon: <Cpu className="h-3.5 w-3.5" /> },
  { value: 'memory', label: 'Memory', icon: <Brain className="h-3.5 w-3.5" /> },
  { value: 'skills', label: 'Skills', icon: <Wand2 className="h-3.5 w-3.5" /> },
  { value: 'knowledge', label: 'Knowledge', icon: <BookOpen className="h-3.5 w-3.5" /> },
  { value: 'behaviour', label: 'Behaviour', icon: <Sliders className="h-3.5 w-3.5" /> },
  { value: 'permissions', label: 'Permissions', icon: <ShieldCheck className="h-3.5 w-3.5" /> },
];

export function StudioPage() {
  const { characterId } = useParams();
  const navigate = useNavigate();
  const { characters, refreshCharacters, toast, activeCharacterId, setActiveCharacter } = useApp();
  const qc = useQueryClient();
  const [tab, setTab] = React.useState<TabKey>('identity');
  const [draft, setDraft] = React.useState<Character | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [dirty, setDirty] = React.useState(false);
  const [resetOpen, setResetOpen] = React.useState(false);

  const targetId = characterId ?? activeCharacterId ?? characters[0]?.id;
  const source = characters.find((c) => c.id === targetId) ?? null;

  React.useEffect(() => {
    setDraft(source ? structuredClone(source) : null);
    setDirty(false);
    setError(null);
  }, [source?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (mutator: (c: Character) => void) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      mutator(next);
      return next;
    });
    setDirty(true);
  };

  const updateConfig = (patch: Partial<CharacterConfig>) => update((c) => Object.assign(c.config, patch));

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiPatch<{ character: Character }>(`/characters/${draft.id}`, {
        name: draft.name,
        avatarSpec: draft.avatarSpec,
        avatarVariant: draft.avatarVariant,
        config: draft.config,
      });
      setDraft(structuredClone(res.character));
      setDirty(false);
      await refreshCharacters();
      await qc.invalidateQueries({ queryKey: ['characters'] });
      toast({ title: 'Character saved', description: 'Changes apply to the next conversation immediately.', tone: 'success' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (!source) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-12">
        <ErrorState message="No character to edit yet. Create one from a template first." onRetry={() => navigate('/characters')} />
      </div>
    );
  }
  if (!draft) return <div className="p-8"><Skeleton className="h-64" /></div>;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-6 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button variant="subtle" size="sm" onClick={() => navigate('/characters')} aria-label="Back to characters">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <AvatarOrb state="IDLE" accent={draft.avatarSpec.palette.accent} size={30} />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-slate-100">{draft.name}</h2>
            <p className="truncate text-[10px] text-slate-500">{draft.templateKey} · {draft.avatarModel}</p>
          </div>
          {dirty ? <Badge tone="warn">unsaved</Badge> : <Badge tone="good"><Check className="h-2.5 w-2.5" /> saved</Badge>}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setResetOpen(true)} disabled={!dirty}>
            <RotateCcw className="h-3.5 w-3.5" /> Discard
          </Button>
          <Button variant="primary" size="sm" onClick={() => void save()} loading={saving} disabled={!dirty}>
            <Save className="h-3.5 w-3.5" /> Save changes
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1300px] space-y-4 px-6 py-5">
          {error ? <ErrorState message={error} /> : null}
          <Tabs value={tab} onChange={setTab} items={TABS} />

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-5">
              {tab === 'identity' && <CharacterStudioIdentity draft={draft} update={update} />}
              {tab === 'avatar' && <CharacterStudioAvatar draft={draft} update={update} />}
              {tab === 'personality' && <PersonalityTab draft={draft} update={update} />}
              {tab === 'voice' && <CharacterStudioVoice draft={draft} update={update} />}
              {tab === 'intelligence' && <CharacterStudioIntelligence draft={draft} update={update} />}
              {tab === 'memory' && <CharacterStudioMemory draft={draft} update={update} updateConfig={updateConfig} />}
              {tab === 'skills' && <CharacterStudioSkills draft={draft} update={update} />}
              {tab === 'knowledge' && <CharacterStudioKnowledge draft={draft} />}
              {tab === 'behaviour' && <CharacterStudioBehaviour draft={draft} update={update} updateConfig={updateConfig} />}
              {tab === 'permissions' && <CharacterStudioPermissions draft={draft} update={update} />}
            </div>

            {/* live preview */}
            <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
              <Panel className="overflow-hidden">
                <AvatarStage spec={draft.avatarSpec} height={300} mode="compact" quality="medium" />
                <div className="space-y-2 border-t border-white/[0.06] p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-200">{draft.name}</span>
                    <Badge tone="accent">{draft.config.personality.communicationStyle}</Badge>
                  </div>
                  <p className="text-[11px] leading-relaxed text-slate-500">{draft.config.description || 'No description yet.'}</p>
                  <div className="flex flex-wrap gap-1">
                    {draft.config.expertise.slice(0, 4).map((e) => (
                      <span key={e} className="rounded bg-white/5 px-1.5 py-0.5 text-[9px] text-slate-400">{e}</span>
                    ))}
                  </div>
                  <div className="hairline" />
                  <div className="grid grid-cols-2 gap-1.5 text-[10px] text-slate-500">
                    <span>Provider: <span className="text-slate-300">{draft.config.intelligence.provider}</span></span>
                    <span>Model: <span className="text-slate-300">{draft.config.intelligence.model || 'auto'}</span></span>
                    <span>Voice: <span className="text-slate-300">{draft.config.voice.provider}</span></span>
                    <span>Speech: <span className="text-slate-300">{draft.config.voice.autoSpeak ? 'auto' : 'manual'}</span></span>
                  </div>
                </div>
              </Panel>
              <Panel className="p-4">
                <p className="flex items-start gap-2 text-[10px] leading-relaxed text-slate-500">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
                  The preview is the same rig used in Live Voice. Lip sync here is intentionally off until real audio is playing.
                </p>
              </Panel>
            </div>
          </div>
        </div>
      </div>

      <Modal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title="Discard unsaved changes?"
        description="Your edits since the last save will be lost."
        footer={
          <>
            <Button variant="ghost" onClick={() => setResetOpen(false)}>Keep editing</Button>
            <Button variant="danger" onClick={() => { setDraft(source ? structuredClone(source) : null); setDirty(false); setResetOpen(false); }}>Discard</Button>
          </>
        }
      />
      {draft.id !== activeCharacterId ? (
        <div className="border-t border-white/[0.06] px-6 py-2 text-[10px] text-slate-600">
          Editing a non-active character.{' '}
          <button className="text-holo-300 hover:underline" onClick={() => setActiveCharacter(draft.id)}>
            Make {draft.name} active
          </button>
        </div>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- personality */

function PersonalityTab({ draft, update }: { draft: Character; update: (m: (c: Character) => void) => void }) {
  const p = draft.config.personality;
  const setP = (patch: Partial<Character['config']['personality']>) => update((c) => Object.assign(c.config.personality, patch));
  return (
    <div className="space-y-5">
      <Panel className="p-5">
        <h3 className="mb-1 text-sm font-semibold text-slate-100">System prompt</h3>
        <p className="mb-3 text-[11px] text-slate-500">The core instruction sent with every request. This is the character&apos;s actual operating contract — not decoration.</p>
        <textarea value={p.systemPrompt} onChange={(e) => setP({ systemPrompt: e.target.value })} rows={10} className="input font-mono text-[11px] leading-relaxed" maxLength={12000} aria-label="System prompt" />
        <p className="mt-1 text-right text-[10px] text-slate-600">{p.systemPrompt.length}/12 000</p>
      </Panel>
      <Panel className="p-5">
        <h3 className="mb-3 text-sm font-semibold text-slate-100">Voice & temperament</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Communication style">
            <Select value={p.communicationStyle} onChange={(e) => setP({ communicationStyle: e.target.value as typeof p.communicationStyle })}>
              {['direct', 'warm', 'analytical', 'playful', 'encouraging'].map((v) => <option key={v} value={v}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Response length">
            <Select value={p.responseLength} onChange={(e) => setP({ responseLength: e.target.value as typeof p.responseLength })}>
              {['concise', 'balanced', 'detailed'].map((v) => <option key={v} value={v}>{v}</option>)}
            </Select>
          </Field>
        </div>
        <div className="mt-3 grid gap-x-6 sm:grid-cols-2">
          <Slider label="Formality" value={p.formality} min={0} max={1} step={0.05} onChange={(v) => setP({ formality: v })} format={(v) => `${Math.round(v * 100)}%`} />
          <Slider label="Humor" value={p.humor} min={0} max={1} step={0.05} onChange={(v) => setP({ humor: v })} format={(v) => `${Math.round(v * 100)}%`} />
          <Slider label="Emotional expression" value={p.emotionalExpression} min={0} max={1} step={0.05} onChange={(v) => setP({ emotionalExpression: v })} format={(v) => `${Math.round(v * 100)}%`} />
        </div>
        <Field label="Speaking style" hint="How sentences should sound — rhythm, vocabulary, quirks.">
          <textarea value={p.speakingStyle} onChange={(e) => setP({ speakingStyle: e.target.value })} rows={3} className="input" maxLength={600} />
        </Field>
        <div className="mt-3">
          <Field label="Traits" hint="Comma separated, up to 12. Used in the system prompt and shown on cards.">
            <input value={p.traits.join(', ')} onChange={(e) => setP({ traits: e.target.value.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 12) })} className="input" />
          </Field>
        </div>
        <div className="mt-3">
          <Field label="Custom instructions" hint="Extra rules for this character only (e.g. 'never suggest cloud storage for medical data').">
            <textarea value={p.customInstructions} onChange={(e) => setP({ customInstructions: e.target.value })} rows={4} className="input" maxLength={6000} />
          </Field>
        </div>
      </Panel>
    </div>
  );
}
