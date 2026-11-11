/**
 * Provider-independent voice conversation state.
 *
 * The transport (Gemini Live websocket, OpenAI Realtime, or browser TTS + STT) is a
 * thin adapter that pushes audio/transcript events here. Turn-taking, interruption and
 * transcript bookkeeping live in this pure class so they are testable without devices.
 */
export type VoicePhase = 'idle' | 'connecting' | 'listening' | 'user-speaking' | 'thinking' | 'assistant-speaking' | 'interrupted' | 'error' | 'closed';

export type TranscriptLine = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  final: boolean;
  at: number;
};

export type VoiceSessionEvents = {
  onPhase?: (phase: VoicePhase, reason?: string) => void;
  onTranscript?: (line: TranscriptLine) => void;
  onError?: (message: string) => void;
  onAssistantAudioStart?: () => void;
  onAssistantAudioEnd?: () => void;
  /** Called when we must cancel/clear queued audio playback right now. */
  onInterruptPlayback?: () => void;
};

export type VoiceProviderKind = 'gemini-live' | 'openai-realtime' | 'browser' | 'none';

export class VoiceSession {
  private phaseValue: VoicePhase = 'idle';
  private lines: TranscriptLine[] = [];
  private seq = 0;
  private interruptedAt: number | null = null;
  private userSpeakingSince: number | null = null;

  constructor(
    readonly provider: VoiceProviderKind,
    private readonly events: VoiceSessionEvents = {},
  ) {}

  get phase(): VoicePhase {
    return this.phaseValue;
  }

  get transcript(): readonly TranscriptLine[] {
    return this.lines;
  }

  private setPhase(p: VoicePhase, reason?: string): void {
    if (this.phaseValue === p) return;
    this.phaseValue = p;
    this.events.onPhase?.(p, reason);
  }

  connect(): void {
    this.setPhase('connecting');
  }

  connected(): void {
    this.setPhase(this.provider === 'none' ? 'error' : 'listening');
    if (this.provider === 'none') this.events.onError?.('No voice provider is configured. Add a Gemini or OpenAI key, or enable browser speech.');
  }

  /** Real mic signal from the VAD layer. */
  micLevel(speaking: boolean): void {
    if (this.phaseValue === 'assistant-speaking' && speaking) {
      // Barge-in: user spoke over the assistant.
      this.interrupt('user-barge-in');
      return;
    }
    if (this.phaseValue === 'listening' || this.phaseValue === 'user-speaking') {
      if (speaking && this.phaseValue === 'listening') {
        this.userSpeakingSince = Date.now();
        this.setPhase('user-speaking');
      } else if (!speaking && this.phaseValue === 'user-speaking') {
        this.userSpeakingSince = null;
        this.setPhase('thinking', 'turn-committed');
      }
    }
  }

  userTranscript(text: string, final: boolean): void {
    const existing = this.lines.find((l) => l.role === 'user' && !l.final && l.id.startsWith('u-'));
    if (existing && !final) {
      existing.text = text;
      this.events.onTranscript?.(existing);
      return;
    }
    const line: TranscriptLine = { id: `u-${++this.seq}`, role: 'user', text, final, at: Date.now() };
    this.lines.push(line);
    this.events.onTranscript?.(line);
    if (final && this.phaseValue === 'user-speaking') this.setPhase('thinking', 'final-transcript');
  }

  assistantTranscriptDelta(text: string): void {
    const last = this.lines[this.lines.length - 1];
    if (last && last.role === 'assistant' && !last.final) {
      last.text += text;
      this.events.onTranscript?.(last);
      return;
    }
    const line: TranscriptLine = { id: `a-${++this.seq}`, role: 'assistant', text, final: false, at: Date.now() };
    this.lines.push(line);
    this.events.onTranscript?.(line);
  }

  /** Starts assistant speech (audio or text-driven TTS). Kept separate from audio
   *  start so adapters that begin speaking from a transcript still allow barge-in. */
  beginAssistantSpeech(): void {
    if (this.phaseValue !== 'assistant-speaking' && this.phaseValue !== 'interrupted') {
      this.setPhase('assistant-speaking');
      this.events.onAssistantAudioStart?.();
    }
  }

  assistantAudioStart(): void {
    this.finalizeAssistantLine();
    this.beginAssistantSpeech();
  }

  assistantAudioEnd(): void {
    this.finalizeAssistantLine();
    this.events.onAssistantAudioEnd?.();
    if (this.phaseValue === 'assistant-speaking') this.setPhase('listening', 'playback-ended');
  }

  interrupt(reason = 'user-interrupt'): void {
    this.interruptedAt = Date.now();
    this.events.onInterruptPlayback?.();
    this.finalizeAssistantLine(true);
    this.setPhase('interrupted', reason);
    // Immediately re-open the mic path.
    setTimeout(() => {
      if (this.phaseValue === 'interrupted') this.setPhase('listening', 'resume-after-interrupt');
    }, 120);
  }

  private finalizeAssistantLine(truncateAtInterrupt = false): void {
    const last = this.lines[this.lines.length - 1];
    if (last && last.role === 'assistant' && !last.final) {
      last.final = true;
      if (truncateAtInterrupt) last.text = `${last.text} …[interrupted]`;
      this.events.onTranscript?.(last);
    }
  }

  fail(message: string): void {
    this.setPhase('error', message);
    this.events.onError?.(message);
  }

  /** Connection dropped: distinguishable from user error, with explicit resume path. */
  connectionLost(message: string): void {
    this.setPhase('error', `connection-lost: ${message}`);
    this.events.onError?.(`Voice connection lost: ${message}. Attempting to reconnect…`);
  }

  close(): void {
    this.finalizeAssistantLine();
    this.setPhase('closed');
  }

  get lastInterruptedAt(): number | null {
    return this.interruptedAt;
  }

  get userSpeakingMs(): number {
    return this.userSpeakingSince ? Date.now() - this.userSpeakingSince : 0;
  }
}
