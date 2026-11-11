import * as React from 'react';
import { AlertTriangle, AudioLines, Brain, Check, CircleStop, Ear, Mic, MicOff, PhoneCall, PhoneOff, Settings2, Sparkles, Zap } from 'lucide-react';
import { useActiveCharacter, useApp } from '@/store/app';
import { AvatarStage } from '@/components/avatar/AvatarStage';
import { AvatarOrb } from '@/components/avatar/AvatarOrb';
import { Badge, Button, EmptyState, ErrorState, Panel, Skeleton, Toggle } from '@/components/ui';
import { fetchVoiceAvailability, LiveVoiceSession, type TranscriptEntry, type VoiceAvailability, type VoiceMode } from '@/lib/liveVoice';
import { listAudioDevices } from '@/lib/audio';
import { listBrowserVoices } from '@/lib/speech';
import type { AvatarState } from '@aura/core/avatar';
import { cn, relativeTime } from '@/lib/utils';

const STATE_LABEL: Record<AvatarState, string> = {
  IDLE: 'Idle',
  LISTENING: 'Listening',
  PROCESSING: 'Processing',
  THINKING: 'Thinking',
  SPEAKING: 'Speaking',
  INTERRUPTED: 'Interrupted',
  ERROR: 'Error',
};

const STATE_TONE: Record<AvatarState, string> = {
  IDLE: 'text-slate-400',
  LISTENING: 'text-emerald-300',
  PROCESSING: 'text-amber-300',
  THINKING: 'text-violet-300',
  SPEAKING: 'text-holo-300',
  INTERRUPTED: 'text-orange-300',
  ERROR: 'text-rose-300',
};

export function VoicePage() {
  const character = useActiveCharacter();
  const { toast } = useApp();
  const [availability, setAvailability] = React.useState<VoiceAvailability | null>(null);
  const [availabilityError, setAvailabilityError] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<VoiceMode>('browser');
  const [state, setState] = React.useState<AvatarState>('IDLE');
  const [status, setStatus] = React.useState('Ready');
  const [level, setLevel] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const [transcript, setTranscript] = React.useState<TranscriptEntry[]>([]);
  const [showConfig, setShowConfig] = React.useState(false);
  const [deviceId, setDeviceId] = React.useState<string>('');
  const [devices, setDevices] = React.useState<Array<{ deviceId: string; label: string }>>([]);
  const [voiceId, setVoiceId] = React.useState('');
  const [voices, setVoices] = React.useState<Array<{ name: string; lang: string }>>([]);
  const [autoSpeak, setAutoSpeak] = React.useState(character?.config.voice.autoSpeak ?? true);
  const sessionRef = React.useRef<LiveVoiceSession | null>(null);
  const [active, setActive] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const load = React.useCallback(async () => {
    setAvailabilityError(null);
    try {
      const av = await fetchVoiceAvailability();
      setAvailability(av);
      // Default to the highest-quality transport the server actually supports.
      setMode(av.geminiLive ? 'gemini-live' : 'browser');
    } catch (err) {
      setAvailabilityError(err instanceof Error ? err.message : 'Could not read voice capabilities');
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    void listAudioDevices().then((d) => setDevices(d.filter((x) => x.kind === 'audioinput' && x.deviceId).map((x) => ({ deviceId: x.deviceId, label: x.label || 'Microphone' }))));
    const loadVoices = () => setVoices(listBrowserVoices().map((v) => ({ name: v.name, lang: v.lang })));
    loadVoices();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
  }, []);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [transcript]);

  React.useEffect(() => {
    return () => {
      sessionRef.current?.stop();
    };
  }, []);

  const start = async () => {
    if (!character) return;
    setError(null);
    setTranscript([]);
    const session = new LiveVoiceSession(
      { characterId: character.id, mode, providerKeyPresent: Boolean(availability?.tts.openai), voiceId, language: character.config.voice.language || 'en-US', deviceId: deviceId || undefined },
      {
        onState: (s) => setState(s),
        onTranscript: (entry) =>
          setTranscript((prev) => {
            const existing = prev.findIndex((e) => e.id === entry.id);
            if (existing >= 0) {
              const next = [...prev];
              next[existing] = entry;
              return next;
            }
            return [...prev, entry];
          }),
        onLevel: setLevel,
        onStatus: setStatus,
        onError: (msg, fatal) => {
          setError(msg);
          if (fatal) {
            setActive(false);
            setState('ERROR');
          }
        },
        onClosed: (reason) => {
          setActive(false);
          setStatus(`Session ended: ${reason}`);
        },
      },
    );
    sessionRef.current = session;
    setActive(true);
    setStatus('Starting…');
    await session.start();
    if (mode === 'gemini-live' && availability && !availability.geminiLive) {
      setError('Gemini Live is not configured on the server. Add a Google API key in AI Models, or use browser mode.');
    }
  };

  const stop = () => {
    sessionRef.current?.stop();
    sessionRef.current = null;
    setActive(false);
    setState('IDLE');
    setStatus('Session ended');
    setLevel(0);
  };

  const interrupt = () => {
    sessionRef.current?.interrupt();
    setState('INTERRUPTED');
  };

  if (!character) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-12">
        <EmptyState title="No character selected" description="Create a character first — Live Voice needs a personality, voice and knowledge scope to talk as." />
      </div>
    );
  }

  const accent = character.avatarSpec.palette.accent;

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-6">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* stage */}
        <div className="space-y-4">
          <Panel className="relative overflow-hidden p-0">
            <div className="absolute left-4 top-4 z-10 flex flex-wrap items-center gap-2">
              <Badge tone={state === 'ERROR' ? 'bad' : active ? 'good' : 'neutral'}>
                <span className={cn('dot', active ? 'animate-pulse bg-emerald-400' : 'bg-slate-500')} />
                {active ? STATE_LABEL[state] : 'Not connected'}
              </Badge>
              <Badge tone="accent">{mode === 'gemini-live' ? 'Gemini Live' : 'Browser speech'}</Badge>
              {character.config.voice.enabled ? null : <Badge tone="warn">voice disabled in config</Badge>}
            </div>
            <div className="absolute right-4 top-4 z-10">
              <Button variant="ghost" size="sm" onClick={() => setShowConfig((v) => !v)} aria-expanded={showConfig}>
                <Settings2 className="h-3.5 w-3.5" /> {showConfig ? 'Hide' : 'Audio'} setup
              </Button>
            </div>

            <AvatarStage spec={character.avatarSpec} engine={sessionRef.current?.avatar} height={480} quality="high" mode="full" />

            {/* level meter: real measured mic/output level */}
            <div className="flex items-center gap-2 px-6 pb-4">
              <AudioLines className={cn('h-3.5 w-3.5', level > 0.05 ? 'text-holo-400' : 'text-slate-600')} />
              <div className="flex h-5 flex-1 items-center gap-[2px]" aria-hidden>
                {Array.from({ length: 48 }).map((_, i) => (
                  <span
                    key={i}
                    className={cn('flex-1 rounded-sm transition-all duration-75', (i / 48) < level ? (level > 0.8 ? 'bg-rose-400' : 'bg-holo-400') : 'bg-white/[0.07]')}
                    style={{ height: `${20 + Math.sin(i * 0.7) * 30 + (i / 48) * 40}%` }}
                  />
                ))}
              </div>
              <span className="w-16 text-right font-mono text-[10px] text-slate-500">{Math.round(level * 100)}%</span>
            </div>

            {showConfig ? (
              <div className="grid gap-4 border-t border-white/[0.06] p-5 sm:grid-cols-2">
                <label className="space-y-1.5">
                  <span className="label">Transport</span>
                  <select value={mode} onChange={(e) => setMode(e.target.value as VoiceMode)} className="input" disabled={active}>
                    <option value="gemini-live" disabled={!availability?.geminiLive}>
                      Gemini Live (real-time duplex){availability?.geminiLive ? '' : ' — needs Google key'}
                    </option>
                    <option value="browser">Browser speech (dictation + TTS)</option>
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className="label">Microphone</span>
                  <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} className="input" disabled={active}>
                    <option value="">System default</option>
                    {devices.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className="label">Browser voice (fallback)</span>
                  <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)} className="input" disabled={active}>
                    <option value="">Automatic</option>
                    {voices.map((v) => (
                      <option key={v.name} value={v.name}>
                        {v.name} ({v.lang})
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex items-end">
                  <Toggle checked={autoSpeak} onChange={setAutoSpeak} label="Speak replies aloud" description="Uses provider TTS when a key exists, otherwise the browser voice." />
                </div>
                <p className="sm:col-span-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-3 text-[11px] leading-relaxed text-amber-200/80">
                  <AlertTriangle className="mr-1 inline h-3 w-3" />
                  {availability?.note ?? 'Reading voice capabilities from the local server…'}
                </p>
              </div>
            ) : null}
          </Panel>

          <div className="flex flex-wrap items-center justify-center gap-3">
            {!active ? (
              <Button variant="primary" size="lg" onClick={() => void start()} disabled={!mode}>
                <PhoneCall className="h-4 w-4" /> Start session
              </Button>
            ) : (
              <>
                <Button variant="danger" size="lg" onClick={stop}>
                  <PhoneOff className="h-4 w-4" /> End session
                </Button>
                <Button variant="ghost" size="lg" onClick={interrupt} title="Cut the character off mid-sentence">
                  <CircleStop className="h-4 w-4" /> Interrupt
                </Button>
              </>
            )}
            <Button variant="ghost" size="lg" onClick={() => { stop(); setTranscript([]); }}>
              Clear transcript
            </Button>
          </div>

          <div className="flex justify-center">
            <p className="flex items-center gap-2 text-xs text-slate-500">
              <span className={cn('dot', active ? STATE_TONE[state] : 'bg-slate-600', active && 'animate-pulse')} />
              {status}
            </p>
          </div>

          {error ? (
            <div className="mx-auto max-w-2xl">
              <ErrorState message={error} onRetry={() => void load()} />
            </div>
          ) : null}
          {availabilityError ? <ErrorState message={availabilityError} onRetry={() => void load()} /> : null}
        </div>

        {/* transcript + state machine */}
        <div className="space-y-4">
          <Panel className="flex h-[480px] flex-col">
            <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Live transcript</h2>
              <span className="text-[10px] text-slate-600">{transcript.length} turns</span>
            </div>
            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
              {transcript.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                  <Ear className="h-6 w-6 text-slate-700" />
                  <p className="text-xs text-slate-500">Nothing yet.</p>
                  <p className="max-w-[240px] text-[11px] leading-relaxed text-slate-600">Start a session and speak. Both sides of the conversation appear here in real time.</p>
                </div>
              ) : (
                transcript.map((t) => (
                  <div key={t.id} className={cn('rounded-xl p-3', t.role === 'user' ? 'bg-white/[0.03]' : 'border border-holo-500/15 bg-holo-500/[0.06]')}>
                    <div className="mb-1 flex items-center gap-2">
                      {t.role === 'user' ? <Mic className="h-3 w-3 text-slate-500" /> : <Sparkles className="h-3 w-3 text-holo-400" />}
                      <span className="text-[10px] uppercase tracking-wider text-slate-500">{t.role === 'user' ? 'You' : character.name}</span>
                      <span className="ml-auto text-[9px] text-slate-600">{relativeTime(new Date(t.at).toISOString())}</span>
                    </div>
                    <p className={cn('text-xs leading-relaxed', t.partial ? 'text-slate-400' : 'text-slate-200')}>{t.text}</p>
                  </div>
                ))
              )}
            </div>
          </Panel>

          <Panel className="p-4">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">State machine</h2>
            <div className="space-y-1.5">
              {(['IDLE', 'LISTENING', 'THINKING', 'PROCESSING', 'SPEAKING', 'INTERRUPTED', 'ERROR'] as AvatarState[]).map((s) => (
                <div key={s} className={cn('flex items-center gap-2 rounded-lg px-2 py-1 text-[11px] transition-colors', state === s && active ? 'bg-white/[0.05] text-slate-200' : 'text-slate-600')}>
                  <span className={cn('h-1.5 w-1.5 rounded-full', state === s && active ? STATE_TONE[s].replace('text-', 'bg-') : 'bg-slate-700')} />
                  <span className="font-mono">{s}</span>
                  {state === s && active ? <Check className="ml-auto h-3 w-3 text-holo-400" /> : null}
                </div>
              ))}
            </div>
          </Panel>

          <Panel className="p-4">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Availability</h2>
            {!availability ? (
              <Skeleton className="h-16" />
            ) : (
              <ul className="space-y-1.5 text-[11px]">
                <AvailRow label="Gemini Live (duplex)" on={availability.geminiLive} />
                <AvailRow label="OpenAI Realtime (referenced)" on={availability.openaiRealtime} note="not wired as a transport; see docs" />
                <AvailRow label="OpenAI TTS + visemes" on={availability.tts.openai} />
                <AvailRow label="Browser speech synthesis" on={availability.tts.browser} />
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function AvailRow({ label, on, note }: { label: string; on: boolean; note?: string }) {
  return (
    <li className="flex items-start justify-between gap-2">
      <span className="text-slate-400">
        {label}
        {note ? <span className="block text-[10px] text-slate-600">{note}</span> : null}
      </span>
      <span className={cn('shrink-0 font-medium', on ? 'text-emerald-300' : 'text-slate-600')}>{on ? 'ready' : 'not configured'}</span>
    </li>
  );
}
