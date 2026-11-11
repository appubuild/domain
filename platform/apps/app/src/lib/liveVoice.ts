import { AvatarEngine, type AvatarState } from '@aura/core/avatar';
import { floatToPcm16Base64, openMicrophone, PcmPlayer, type MicStream } from './audio';

/**
 * Live voice client. Two genuinely different transports:
 *
 *  - `gemini-live`: server↔Google Live WebSocket (16 kHz PCM up, 24 kHz PCM down,
 *    server-side VAD/turn handling, interruption events).
 *  - `browser`: Web Speech dictation + server text streaming + browser/OpenAI TTS.
 *    This is a real fallback, but it is *not* the same latency/duplex quality as the
 *    provider bridge, and the UI labels it accordingly.
 *
 * In both modes the `AvatarEngine` is driven by actual audio activity and actual
 * response phases — never by a canned animation loop.
 */
export type VoiceMode = 'gemini-live' | 'browser';

export type TranscriptEntry = { id: string; role: 'user' | 'assistant'; text: string; at: number; partial?: boolean };

export type VoiceEvents = {
  onState: (state: AvatarState, reason: string) => void;
  onTranscript: (entry: TranscriptEntry) => void;
  onLevel: (level: number) => void;
  onStatus: (status: string) => void;
  onError: (message: string, fatal: boolean) => void;
  onClosed: (reason: string) => void;
};

export type VoiceAvailability = {
  geminiLive: boolean;
  openaiRealtime: boolean;
  tts: { openai: boolean; browser: boolean };
  note: string;
};

export async function fetchVoiceAvailability(): Promise<VoiceAvailability> {
  const res = await fetch('/api/voice/voices');
  if (!res.ok) throw new Error(`Voice availability failed (${res.status})`);
  return (await res.json()) as VoiceAvailability;
}

export class LiveVoiceSession {
  private ws: WebSocket | null = null;
  private mic: MicStream | null = null;
  private player = new PcmPlayer();
  private engine: AvatarEngine;
  private raf = 0;
  private closed = false;
  private speaking = false;
  private state: AvatarState = 'IDLE';
  private ttsAbort: AbortController | null = null;
  private audioEl: HTMLAudioElement | null = null;

  constructor(
    private readonly opts: { characterId: string; mode: VoiceMode; providerKeyPresent: boolean; voiceId: string; language: string; deviceId?: string },
    private readonly events: VoiceEvents,
  ) {
    this.engine = new AvatarEngine();
    // The engine's state machine is the single authority; mirror its changes to the UI.
    this.engine.state.subscribe((change) => {
      this.state = change.to;
      this.events.onState(change.to, change.reason ?? `voice:${change.to.toLowerCase()}`);
    });
  }

  get avatar(): AvatarEngine {
    return this.engine;
  }

  get currentState(): AvatarState {
    return this.state;
  }

  /** Frame loop: measures real mic level and feeds the engine. */
  private startAnalysis(): void {
    const loop = () => {
      if (this.closed) return;
      const mic = this.mic;
      if (mic) {
        const { rms } = mic.sample();
        const level = Math.min(1, rms * 9);
        this.events.onLevel(level);
        if (!this.speaking && this.state !== 'LISTENING' && level > 0.06) {
          this.engine.state.set('LISTENING', 'mic-activity');
        }
        if (this.speaking) this.engine.lipsync.feedAmplitude(level, 1 / 60);
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  async start(): Promise<void> {
    this.events.onStatus('Requesting microphone…');
    try {
      this.mic = await openMicrophone(this.opts.deviceId);
    } catch (err) {
      this.events.onError(err instanceof Error ? err.message : 'Microphone unavailable', true);
      this.events.onClosed('microphone-denied');
      return;
    }
    this.startAnalysis();
    if (this.opts.mode === 'gemini-live') await this.startGemini();
    else this.startBrowserMode();
  }

  private async startGemini(): Promise<void> {
    this.events.onStatus('Connecting to Gemini Live…');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws/live-voice`);
    this.ws = ws;
    await new Promise<void>((resolve) => {
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'start', characterId: this.opts.characterId }));
        resolve();
      };
      ws.onerror = () => resolve();
      setTimeout(resolve, 8000);
    });
    ws.onmessage = (ev) => this.handleServerMessage(JSON.parse(String(ev.data)) as { type: string; [k: string]: unknown });
    ws.onclose = (ev) => {
      this.events.onClosed(ev.reason || `connection closed (${ev.code})`);
      this.finish();
    };
    this.events.onStatus('Streaming microphone at 16 kHz…');
    const ctx = new AudioContext({ sampleRate: 16_000 });
    const src = ctx.createMediaStreamSource(this.mic!.stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    proc.onaudioprocess = (e) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: 'audio', data: floatToPcm16Base64(e.inputBuffer.getChannelData(0)), mimeType: 'audio/pcm;rate=16000' }));
    };
    src.connect(proc);
    proc.connect(ctx.destination);
  }

  private handleServerMessage(msg: { type: string; [k: string]: unknown }): void {
    switch (msg.type) {
      case 'phase': {
        const phase = String(msg.phase) as AvatarState;
        this.engine.state.set(phase, `gemini:${phase}`);
        this.speaking = phase === 'SPEAKING';
        break;
      }
      case 'transcript': {
        // Server sends { line: TranscriptLine } with `final` (see core/voice/session.ts).
        const line = msg.line as { id: string; role: 'user' | 'assistant'; text: string; final: boolean; at: number };
        if (!line) break;
        this.events.onTranscript({ id: line.id, role: line.role, text: line.text, at: line.at, partial: !line.final });
        break;
      }
      case 'ready': {
        this.events.onStatus('Live session ready — speak naturally.');
        break;
      }
      case 'audio': {
        // Provider streams 24 kHz PCM16; the mime type carries the rate when present.
        const mime = String(msg.mimeType ?? 'audio/pcm;rate=24000');
        const rate = Number(/rate=(\d+)/.exec(mime)?.[1] ?? 24_000);
        this.player.enqueueBase64(String(msg.data), rate);
        break;
      }
      case 'interrupt': {
        this.player.stop();
        this.engine.userInterrupted();
        break;
      }
      case 'error': {
        const code = String(msg.code ?? 'error');
        this.events.onError(String(msg.message ?? code), code === 'not_configured' || code === 'auth');
        if (code === 'not_configured') this.events.onClosed('not-configured');
        break;
      }
      case 'closed':
        this.events.onStatus('Session ended');
        break;
      case 'pong':
      case 'hello':
        break;
      default:
        break;
    }
  }

  /** Browser mode: dictation → server chat stream → TTS playback. */
  private startBrowserMode(): void {
    this.events.onStatus('Browser dictation active — click the mic to stop listening.');
    const rec = new RecognitionBridge(this.opts.language);
    if (!rec.supported) {
      this.events.onError('This browser does not implement the Web Speech API. Use Chrome/Edge, or add a Gemini/OpenAI key for the provider bridge.', true);
      return;
    }
    rec.onFinal = (text) => {
      if (!text.trim()) return;
      this.events.onTranscript({ id: `u${Date.now()}`, role: 'user', text, at: Date.now() });
      void this.requestReply(text);
    };
    rec.onInterim = (text) => {
      if (text.trim()) this.events.onStatus(`Hearing: ${text.slice(0, 60)}`);
    };
    this.recognition = rec;
    rec.start();
  }

  private async requestReply(text: string): Promise<void> {
    this.engine.state.set('THINKING', 'request');
    this.ttsAbort = new AbortController();
    try {
      const res = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          characterId: this.opts.characterId,
          message: text,
          mode: 'companion',
          voice: { enabled: true, provider: this.opts.providerKeyPresent ? 'openai' : 'browser', voiceId: this.opts.voiceId },
        }),
        signal: this.ttsAbort.signal,
      });
      if (!res.ok || !res.body) {
        const payload = await res.json().catch(() => ({ error: `Chat failed (${res.status})` }));
        throw new Error(String((payload as { error?: string }).error ?? 'Chat failed'));
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let full = '';
      let id = `a${Date.now()}`;
      this.engine.state.set('SPEAKING', 'assistant-streaming');
      this.speaking = true;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';
        for (const raw of events) {
          const line = raw.split('\n').find((l) => l.startsWith('data:'));
          if (!line) continue;
          let payload: { type?: string; delta?: string; text?: string; error?: string; message?: string };
          try {
            payload = JSON.parse(line.slice(5).trim());
          } catch {
            continue;
          }
          if (payload.type === 'delta' && payload.delta) {
            full += payload.delta;
            this.events.onTranscript({ id, role: 'assistant', text: full, at: Date.now(), partial: true });
          } else if (payload.type === 'error') {
            throw new Error(payload.message ?? payload.error ?? 'Provider error');
          }
        }
      }
      this.events.onTranscript({ id, role: 'assistant', text: full, at: Date.now() });
      this.speaking = false;
      this.engine.state.set('IDLE', 'response-complete');
      if (this.opts.providerKeyPresent) await this.speakWithProvider(full);
      else this.speakWithBrowser(full);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      this.engine.state.set('ERROR', 'chat-failed');
      this.events.onError(err instanceof Error ? err.message : 'Chat failed', false);
    }
  }

  private async speakWithProvider(text: string): Promise<void> {
    this.events.onStatus('Synthesizing speech…');
    this.engine.state.set('SPEAKING', 'tts');
    this.speaking = true;
    try {
      const res = await fetch('/api/voice/tts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, voice: this.opts.voiceId || 'alloy', withVisemes: true }),
      });
      if (!res.ok) throw new Error(`TTS failed (${res.status})`);
      const visemesHeader = res.headers.get('x-visemes');
      if (visemesHeader) {
        try {
          const raw = JSON.parse(atob(visemesHeader.replace(/-/g, '+').replace(/_/g, '/'))) as { frames?: Array<{ viseme: string; atMs: number; durationMs: number }> };
          this.engine.loadProviderVisemes(raw.frames ?? []);
        } catch {
          this.engine.lipsync.useAmplitudeMode();
        }
      } else {
        this.engine.lipsync.useAmplitudeMode();
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      this.audioEl = audio;
      audio.onended = () => {
        this.speaking = false;
        this.engine.state.set('IDLE', 'tts-complete');
        URL.revokeObjectURL(url);
      };
      const actx = new AudioContext();
      const source = actx.createMediaElementSource(audio);
      const analyser = actx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      analyser.connect(actx.destination);
      const buf = new Float32Array(analyser.fftSize);
      const meter = () => {
        if (!this.speaking) return;
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        this.engine.lipsync.feedAmplitude(Math.min(1, Math.sqrt(sum / buf.length) * 6), 1 / 60);
        requestAnimationFrame(meter);
      };
      void audio.play().then(() => meter());
    } catch (err) {
      this.engine.lipsync.useAmplitudeMode();
      this.speaking = false;
      this.events.onError(err instanceof Error ? err.message : 'Speech synthesis failed', false);
      this.speakWithBrowser(text);
    }
  }

  private speakWithBrowser(text: string): void {
    this.engine.state.set('SPEAKING', 'browser-tts');
    this.speaking = true;
    const handle = speakBrowser(text, { voiceName: this.opts.voiceId || undefined });
    void handle.promise.then(() => {
      this.speaking = false;
      this.engine.state.set('IDLE', 'speech-complete');
    });
    this.browserSpeak = handle;
  }

  private browserSpeak: { stop(): void } | null = null;
  private recognition: { stop(): void } | null = null;

  /** User interrupts: stop every audio source and move the state machine. */
  interrupt(): void {
    this.player.stop();
    this.browserSpeak?.stop();
    this.audioEl?.pause();
    this.engine.userInterrupted();
    this.speaking = false;
    this.ws?.send(JSON.stringify({ type: 'activity-end' }));
  }

  stop(): void {
    this.closed = true;
    cancelAnimationFrame(this.raf);
    this.recognition?.stop();
    this.browserSpeak?.stop();
    this.ttsAbort?.abort();
    this.audioEl?.pause();
    this.player.stop();
    this.mic?.stop();
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'stop' }));
      this.ws.close(1000, 'user-ended');
    }
    this.engine.goIdle();
  }

  private finish(): void {
    this.closed = true;
    cancelAnimationFrame(this.raf);
    this.mic?.stop();
    this.player.stop();
    this.engine.goIdle();
  }
}

/* Browser speech APIs are feature-detected at runtime, never polyfilled with fakes. */
import { speakBrowser } from './speech';
import { RecognitionBridge } from './speech';
