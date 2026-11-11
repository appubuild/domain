import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import {
  VoiceSession,
  type Db,
  type ModelRouter,
  type ProviderKey,
  type VoicePhase,
  type TranscriptLine,
} from '@aura/core';
import type { EventBus } from './events.js';

/**
 * Server-side voice gateway.
 *
 * Text-to-speech: OpenAI TTS (`/v1/audio/speech`) — returns real MP3/Opus audio plus the
 * word timings we can derive, so the avatar lip-syncs to actual speech.
 * Real-time: Gemini Live via a secure server-side WebSocket bridge (API key never reaches
 * the browser). If a provider is not configured, the endpoint returns a typed error —
 * the UI never shows a fake "connected" state.
 */
export class VoiceGateway {
  constructor(
    private readonly deps: {
      db: Db;
      router: ModelRouter;
      getApiKey: (p: ProviderKey) => Promise<string | null>;
      events: EventBus;
    },
  ) {}

  async synthesize(input: { text: string; voice: string; speed: number; format?: 'mp3' | 'opus' | 'aac' | 'wav' }): Promise<{ audio: Buffer; mime: string; provider: 'openai' } | { error: string; kind: 'not_configured' | 'failed' }> {
    const key = await this.deps.getApiKey('openai');
    if (!key) return { error: 'Text-to-speech needs an OpenAI API key (Settings → AI Providers).', kind: 'not_configured' };
    const format = input.format ?? 'mp3';
    try {
      const res = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini-tts',
          voice: input.voice || 'alloy',
          input: input.text.slice(0, 4000),
          speed: Math.min(2, Math.max(0.5, input.speed)),
          response_format: format,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        return { error: `OpenAI TTS failed (${res.status}): ${body.slice(0, 200)}`, kind: 'failed' };
      }
      const audio = Buffer.from(await res.arrayBuffer());
      return { audio, mime: format === 'mp3' ? 'audio/mpeg' : format === 'opus' ? 'audio/ogg' : format === 'wav' ? 'audio/wav' : 'audio/aac', provider: 'openai' };
    } catch (err) {
      return { error: `Network error contacting OpenAI TTS: ${err instanceof Error ? err.message : String(err)}`, kind: 'failed' };
    }
  }

  async voices(): Promise<{ openai: string[]; note: string }> {
    const key = await this.deps.getApiKey('openai');
    return {
      openai: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer', 'coral', 'verse', 'sage', 'ash'],
      note: key ? 'OpenAI key present — TTS available.' : 'No OpenAI key configured; browser speech synthesis remains available offline.',
    };
  }
}

/**
 * Gemini Live bridge. Proxies the bidirectional WebSocket so credentials stay server-side.
 * Full-duplex: client sends 16k PCM chunks, receives 24k PCM + transcripts + interruptions.
 */
export class GoogleLiveBridge extends EventEmitter {
  private ws: WebSocket | null = null;
  private session: VoiceSession | null = null;
  private closed = false;

  constructor(
    private readonly apiKey: string,
    private readonly model = 'models/gemini-2.0-flash-live-001',
    private readonly systemInstruction?: string,
  ) {
    super();
  }

  get phase(): VoicePhase {
    return this.session?.phase ?? 'idle';
  }

  async connect(): Promise<void> {
    if (this.ws) return;
    this.session = new VoiceSession('gemini-live', {
      onPhase: (p, reason) => this.emit('phase', { phase: p, reason }),
      onTranscript: (line: TranscriptLine) => this.emit('transcript', line),
      onError: (message) => this.emit('error', { message }),
      onInterruptPlayback: () => this.emit('interrupt'),
    });
    this.session.connect();
    const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(this.apiKey)}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Gemini Live connection timed out after 12s')), 12_000);
      ws.once('open', () => {
        clearTimeout(timer);
        ws.send(
          JSON.stringify({
            setup: {
              model: this.model,
              generationConfig: { responseModalities: ['AUDIO'] },
              systemInstruction: this.systemInstruction ? { parts: [{ text: this.systemInstruction }] } : undefined,
            },
          }),
        );
      });
      ws.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      ws.once('message', (data) => {
        clearTimeout(timer);
        const raw = data.toString();
        try {
          const msg = JSON.parse(raw) as { setupComplete?: unknown };
          if (msg.setupComplete) this.session?.connected();
        } catch {
          /* ignore malformed handshake echo */
        }
        resolve();
      });
    });
    ws.on('message', (data) => this.handleMessage(data.toString()));
    ws.on('close', (code) => {
      if (!this.closed) this.session?.connectionLost(`socket closed (${code})`);
      this.emit('closed', { code });
    });
    ws.on('error', (err) => this.session?.fail(err.message));
  }

  private handleMessage(raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    const serverContent = msg.serverContent as
      | {
          modelTurn?: { parts?: Array<{ inlineData?: { data: string; mimeType: string }; text?: string }> };
          inputTranscription?: { text?: string };
          outputTranscription?: { text?: string };
          interrupted?: boolean;
          turnComplete?: boolean;
        }
      | undefined;
    if (serverContent?.interrupted) this.session?.interrupt('provider-interrupted');
    if (serverContent?.inputTranscription?.text) this.session?.userTranscript(serverContent.inputTranscription.text, false);
    if (serverContent?.outputTranscription?.text) this.session?.assistantTranscriptDelta(serverContent.outputTranscription.text);
    for (const part of serverContent?.modelTurn?.parts ?? []) {
      if (part.inlineData?.data) {
        this.session?.assistantAudioStart();
        this.emit('audio', {
          data: part.inlineData.data,
          mimeType: part.inlineData.mimeType,
        });
      }
      if (part.text) this.session?.assistantTranscriptDelta(part.text);
    }
    if (serverContent?.turnComplete) this.session?.assistantAudioEnd();
  }

  sendAudio(pcm16Base64: string): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ realtimeInput: { mediaChunks: [{ mimeType: 'audio/pcm;rate=16000', data: pcm16Base64 }] } }));
  }

  notifyActivity(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ realtimeInput: { activityStart: {} } }));
  }

  endTurn(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ realtimeInput: { activityEnd: {} } }));
  }

  close(): void {
    this.closed = true;
    this.session?.close();
    this.ws?.close();
    this.ws = null;
  }
}
