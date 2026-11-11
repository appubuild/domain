import * as React from 'react';
import { Palette, RotateCcw, Shuffle } from 'lucide-react';
import type { Character, AvatarSpec, Template } from '@/lib/types';
import { Badge, Button, Field, Panel, Select, Slider, Toggle } from '@/components/ui';
import { useApp } from '@/store/app';
import { cn } from '@/lib/utils';

const HAIR_STYLES: AvatarSpec['hair']['style'][] = ['slick', 'short', 'long-straight', 'twin-tail', 'bob-curly', 'spiky', 'none'];
const BODY_STYLES: AvatarSpec['body']['style'][] = ['suit', 'hoodie', 'techsuit', 'dress', 'coat', 'hologram'];
const ACCESSORIES: AvatarSpec['accessory'][] = ['none', 'headset', 'visor', 'hairpin', 'earpiece', 'glasses', 'antenna'];
const HEAD_SHAPES: AvatarSpec['head']['shape'][] = ['crystalline', 'rounded', 'soft', 'angular', 'oval', 'arc'];

export function CharacterStudioAvatar({ draft, update }: { draft: Character; update: (m: (c: Character) => void) => void }) {
  const { templates } = useApp();
  const spec = draft.avatarSpec;
  const setSpec = (mutator: (s: AvatarSpec) => void) => update((c) => mutator(c.avatarSpec));
  const setColor = (key: keyof AvatarSpec['palette'], value: string) => setSpec((s) => { s.palette[key] = value; });
  const family = templates.find((t) => t.key === draft.templateKey);

  const applyTemplateLook = (t: Template) => {
    update((c) => {
      c.avatarSpec = structuredClone(t.avatar);
      c.avatarVariant = t.key;
    });
  };

  return (
    <div className="space-y-5">
      <Panel className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">Render family</h3>
            <p className="text-[11px] text-slate-500">Start from a character family, then tune the rig.</p>
          </div>
          <Badge tone="accent">{draft.avatarModel}</Badge>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {templates.map((t) => (
            <button key={t.key} onClick={() => applyTemplateLook(t)} className={cn('rounded-xl border p-2 text-left transition-colors', draft.avatarVariant === t.key ? 'border-holo-500/40 bg-holo-500/[0.06]' : 'border-white/[0.06] hover:border-white/15')}>
              <span className="block h-1.5 w-8 rounded-full" style={{ background: t.accent }} />
              <span className="mt-1.5 block text-[11px] text-slate-200">{t.name}</span>
              <span className="block text-[9px] text-slate-500">{t.renderFamily}</span>
            </button>
          ))}
        </div>
      </Panel>

      <Panel className="p-5">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-100"><Palette className="h-4 w-4 text-holo-400" /> Palette</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(['primary', 'secondary', 'accent', 'glow', 'skin', 'hair', 'eye'] as const).map((key) => (
            <label key={key} className="space-y-1">
              <span className="block text-[10px] capitalize text-slate-500">{key}</span>
              <div className="flex items-center gap-1.5">
                <input type="color" value={spec.palette[key]} onChange={(e) => setColor(key, e.target.value)} className="h-8 w-9 cursor-pointer rounded border border-white/10 bg-transparent" aria-label={`${key} colour`} />
                <input value={spec.palette[key]} onChange={(e) => setColor(key, e.target.value)} className="input h-8 px-2 font-mono text-[10px]" maxLength={7} />
              </div>
            </label>
          ))}
        </div>
      </Panel>

      <Panel className="p-5">
        <h3 className="mb-3 text-sm font-semibold text-slate-100">Geometry</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Head shape">
            <Select value={spec.head.shape} onChange={(e) => setSpec((s) => { s.head.shape = e.target.value as AvatarSpec['head']['shape']; })}>
              {HEAD_SHAPES.map((v) => <option key={v} value={v}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Surface material">
            <Select value={spec.head.material} onChange={(e) => setSpec((s) => { s.head.material = e.target.value as AvatarSpec['head']['material']; })}>
              {['solid', 'toon', 'glass', 'wireframe'].map((v) => <option key={v} value={v}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Hair style">
            <Select value={spec.hair.style} onChange={(e) => setSpec((s) => { s.hair.style = e.target.value as AvatarSpec['hair']['style']; })}>
              {HAIR_STYLES.map((v) => <option key={v} value={v}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Outfit">
            <Select value={spec.body.style} onChange={(e) => setSpec((s) => { s.body.style = e.target.value as AvatarSpec['body']['style']; })}>
              {BODY_STYLES.map((v) => <option key={v} value={v}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Collar">
            <Select value={spec.body.collar} onChange={(e) => setSpec((s) => { s.body.collar = e.target.value as AvatarSpec['body']['collar']; })}>
              {['tie', 'open', 'high', 'none'].map((v) => <option key={v} value={v}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Accessory">
            <Select value={spec.accessory} onChange={(e) => setSpec((s) => { s.accessory = e.target.value as AvatarSpec['accessory']; })}>
              {ACCESSORIES.map((v) => <option key={v} value={v}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Eye style">
            <Select value={spec.eyes.shape} onChange={(e) => setSpec((s) => { s.eyes.shape = e.target.value as AvatarSpec['eyes']['shape']; })}>
              {['round', 'almond', 'sharp', 'glow'].map((v) => <option key={v} value={v}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Background">
            <Select value={spec.background} onChange={(e) => setSpec((s) => { s.background = e.target.value as AvatarSpec['background']; })}>
              {['void', 'holo-room', 'gradient'].map((v) => <option key={v} value={v}>{v}</option>)}
            </Select>
          </Field>
        </div>
        <div className="mt-3 grid gap-x-6 sm:grid-cols-2">
          <Slider label="Head width" value={spec.head.width} min={0.6} max={1.6} step={0.02} onChange={(v) => setSpec((s) => { s.head.width = v; })} />
          <Slider label="Head height" value={spec.head.height} min={0.8} max={1.6} step={0.02} onChange={(v) => setSpec((s) => { s.head.height = v; })} />
          <Slider label="Jaw taper" value={spec.head.jawTaper} min={0} max={1} step={0.02} onChange={(v) => setSpec((s) => { s.head.jawTaper = v; })} />
          <Slider label="Hair volume" value={spec.hair.volume} min={0} max={1.5} step={0.02} onChange={(v) => setSpec((s) => { s.hair.volume = v; })} />
          <Slider label="Eye scale" value={spec.eyes.scale} min={0.5} max={1.8} step={0.02} onChange={(v) => setSpec((s) => { s.eyes.scale = v; })} />
          <Slider label="Eye glow" value={spec.eyes.emissive} min={0} max={2} step={0.05} onChange={(v) => setSpec((s) => { s.eyes.emissive = v; })} />
          <Slider label="Shoulder width" value={spec.body.shoulderWidth} min={0.7} max={1.4} step={0.02} onChange={(v) => setSpec((s) => { s.body.shoulderWidth = v; })} />
          <Slider label="Glow intensity" value={spec.glowIntensity} min={0} max={1} step={0.02} onChange={(v) => setSpec((s) => { s.glowIntensity = v; })} />
        </div>
        <div className="mt-2 grid gap-x-6 sm:grid-cols-2">
          <Toggle checked={spec.halo} onChange={(v) => setSpec((s) => { s.halo = v; })} label="Halo ring" description="Adds a rotating emissive ring above the head." />
          <Toggle checked={spec.gridFloor} onChange={(v) => setSpec((s) => { s.gridFloor = v; })} label="Holographic floor" description="Ground grid that anchors the character in space." />
        </div>
      </Panel>

      <Panel className="p-5">
        <h3 className="mb-2 text-sm font-semibold text-slate-100">Animation</h3>
        <p className="text-[11px] leading-relaxed text-slate-500">
          Idle breathing, blinking, gaze drift, expression blends and viseme mouth shapes are driven by the shared avatar engine. Lip sync uses measured audio amplitude or phoneme <em>estimates</em> from the TTS proxy — this is not phoneme-accurate viseme detection, and the UI says so.
        </p>
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => { const f = templates[0]; if (f) applyTemplateLook(f); }}>
            <Shuffle className="h-3.5 w-3.5" /> Reset to {family?.name ?? 'family'}
          </Button>
        </div>
      </Panel>
    </div>
  );
}
