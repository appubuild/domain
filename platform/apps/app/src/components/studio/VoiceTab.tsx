import * as React from 'react';
import { Play, Square, Volume2, Info } from 'lucide-react';
import { Badge, Button, Field, Panel, Select, Slider, Toggle } from '@/components/ui';
import type { Character } from '@/lib/types';
import { apiPost } from '@/lib/api';
import { speakBrowser, listBrowserVoices } from '@/lib/speech';

const OPENAI_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer', 'coral', 'verse', 'sage', 'ash'];

/**
 * Voice configuration. The "Test voice" button performs a real synthesis request:
 * OpenAI TTS through the server when a key exists, otherwise the browser's speech engine.
 * If neither works, the failure is shown — never a silent fake success.
 */
export function CharacterStudioVoice({ draft, update }: { draft: Character; update: (m: (c: Character) => void) => void }) {
  const v = draft.config.voice;
  const [testing, setTesting] = React.useState(false);
  const [result, setResult] = React.useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [providers, setProviders] = React.useState<{ openai: boolean; google: boolean } | null>(null);
  const [browserVoices, setBrowserVoices] = React.useState<Array<{ name: string; lang: string }>>([]);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);

  React.useEffect(() => {
    void fetch('/api/voice/voices').then((r) => r.json()).then((d: { openai?: string[]; geminiLive?: boolean }) => setProviders({ openai: Array.isArray(d.openai), google: Boolean(d.geminiLive) })).catch(() => setProviders({ openai: false, google: false }));
    const load = () => setBrowserVoices(listBrowserVoices().map((x) => ({ name: x.name, lang: x.lang })));
    load();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.onvoiceschanged = load;
  }, []);

  const setV = (patch: Partial<Character['config']['voice']>) => update((c) => Object.assign(c.config.voice, patch));

  const test = async () => {
    setTesting(true);
    setResult(null);
    const sample = `Hello, I'm ${draft.name}. ${draft.config.personality.speakingStyle || 'This is how I sound.'}`;
    try {
      const res = await fetch('/api/voice/tts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: sample.slice(0, 400), voice: v.voiceId || 'alloy', speed: v.speed, withVisemes: false }),
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;
        await audio.play();
        setResult({ kind: 'ok', text: 'Playing provider voice (OpenAI TTS). Real synthesis, not a sample file.' });
      } else {
        const body = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as { error?: string };
        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
          speakBrowser(sample, { voiceName: v.voiceName, rate: v.speed, pitch: v.pitch });
          setResult({ kind: 'ok', text: `Provider TTS unavailable (${body.error ?? res.status}). Using this device's browser voice instead — quality varies by OS.` });
        } else {
          setResult({ kind: 'error', text: body.error ?? `TTS failed with status ${res.status}` });
        }
      }
    } catch (err) {
      setResult({ kind: 'error', text: err instanceof Error ? err.message : 'Voice test failed' });
    } finally {
      setTesting(false);
    }
  };

  const providerOptions = [
    { value: 'auto', label: 'Auto (best available)' },
    { value: 'openai', label: 'OpenAI TTS' },
    { value: 'gemini', label: 'Google Gemini Live voice' },
    { value: 'browser', label: 'Browser speech (no key)' },
  ];

  return (
    <div className="space-y-5">
      <Panel className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-100">Voice engine</h3>
          <div className="flex gap-1.5">
            <Badge tone={providers?.openai ? 'good' : 'neutral'}>OpenAI {providers?.openai ? 'ready' : 'no key'}</Badge>
            <Badge tone={providers?.google ? 'good' : 'neutral'}>Gemini {providers?.google ? 'ready' : 'no key'}</Badge>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Preferred provider">
            <Select value={v.provider} onChange={(e) => setV({ provider: e.target.value as typeof v.provider })}>
              {providerOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </Field>
          <Field label="Language">
            <input value={v.language} onChange={(e) => setV({ language: e.target.value })} className="input" maxLength={16} placeholder="en-US" />
          </Field>
          <Field label="Provider voice" hint="OpenAI voice id, or a browser voice name for the fallback.">
            <Select value={OPENAI_VOICES.includes(v.voiceId) ? v.voiceId : ''} onChange={(e) => setV({ voiceId: e.target.value, voiceName: e.target.selectedOptions[0]?.text ?? '' })}>
              <option value="">Choose…</option>
              {OPENAI_VOICES.map((x) => <option key={x} value={x}>{x}</option>)}
            </Select>
          </Field>
          <Field label="Browser fallback voice" hint={browserVoices.length ? `${browserVoices.length} voices installed on this device` : 'No browser voices detected yet'}>
            <Select value={v.voiceName} onChange={(e) => setV({ voiceName: e.target.value })}>
              <option value="">Automatic</option>
              {browserVoices.map((x) => <option key={x.name} value={x.name}>{x.name} ({x.lang})</option>)}
            </Select>
          </Field>
        </div>
        <div className="mt-3 grid gap-x-6 sm:grid-cols-2">
          <Slider label="Speed" value={v.speed} min={0.5} max={2} step={0.05} onChange={(speed) => setV({ speed })} format={(x) => `${x.toFixed(2)}×`} />
          <Slider label="Pitch" value={v.pitch} min={0.5} max={1.5} step={0.05} onChange={(pitch) => setV({ pitch })} format={(x) => x.toFixed(2)} />
        </div>
        <Field label="Style">
          <Select value={v.style} onChange={(e) => setV({ style: e.target.value as typeof v.style })}>
            {['natural', 'calm', 'energetic', 'professional', 'warm'].map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </Field>
        <Toggle checked={v.enabled} onChange={(enabled) => setV({ enabled })} label="Voice enabled" description="When off, the character answers in text only." />
        <Toggle checked={v.autoSpeak} onChange={(autoSpeak) => setV({ autoSpeak })} label="Speak replies automatically" description="Requires a working TTS path (provider key or browser voice)." />
      </Panel>

      <Panel className="p-5">
        <h3 className="mb-1 text-sm font-semibold text-slate-100">Test the voice</h3>
        <p className="mb-3 text-[11px] leading-relaxed text-slate-500">Sends a real synthesis request through the local server and plays the returned audio.</p>
        <div className="flex gap-2">
          <Button variant="primary" size="sm" onClick={() => void test()} loading={testing}>
            <Play className="h-3.5 w-3.5" /> Test voice
          </Button>
          <Button variant="ghost" size="sm" onClick={() => { audioRef.current?.pause(); if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel(); }}>
            <Square className="h-3 w-3" /> Stop
          </Button>
        </div>
        {result ? (
          <div className={`mt-3 rounded-lg border p-2.5 text-[11px] leading-relaxed ${result.kind === 'ok' ? 'border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-200/80' : 'border-rose-500/20 bg-rose-500/[0.06] text-rose-200/80'}`}>{result.text}</div>
        ) : null}
        <p className="mt-3 flex items-start gap-1.5 text-[10px] leading-relaxed text-slate-600">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          Lip sync in Live Voice is amplitude-driven by default (real audio level). OpenAI TTS returns estimated viseme timings that improve mouth shapes; neither is phoneme-accurate speech analysis.
        </p>
      </Panel>

      <Panel className="p-5">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-100"><Volume2 className="h-4 w-4 text-holo-400" /> Devices</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Input device" hint="Leave empty for the system default. Device labels appear after mic permission is granted.">
            <input value={v.inputDeviceId} onChange={(e) => setV({ inputDeviceId: e.target.value })} className="input" placeholder="default" />
          </Field>
          <Field label="Output device" hint="Browser support varies; the desktop app can pin an output device.">
            <input value={v.outputDeviceId} onChange={(e) => setV({ outputDeviceId: e.target.value })} className="input" placeholder="default" />
          </Field>
        </div>
      </Panel>
    </div>
  );
}
