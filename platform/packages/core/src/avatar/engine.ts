import { CharacterStateMachine } from './state.js';
import type { AvatarState } from './state.js';
import { ExpressionController, STATE_EXPRESSION, inferExpressionFromText } from './expressions.js';
import type { Expression, FaceParams } from './expressions.js';
import { LipSyncEngine, rmsFromFrequencyData, textToVisemeFrames } from './visemes.js';
import type { LipSyncMode, MouthFrame } from './visemes.js';

/**
 * AvatarEngine is the single source of truth for what the character's body is doing.
 * The React renderer subscribes and reads `frame()` once per animation tick; the voice
 * and chat pipelines call the imperative methods. No rendering assumptions live here,
 * so the same engine drives 3D (R3F/VRM), 2D canvas and tests.
 */
export type AvatarPose = {
  state: AvatarState;
  expression: Expression;
  face: FaceParams;
  mouth: MouthFrame;
  /** Head rotation in radians (yaw, pitch, roll). */
  head: { yaw: number; pitch: number; roll: number };
  /** Eye look-at offset in [-1,1]. */
  gaze: { x: number; y: number };
  blink: number;
  breath: number;
  /** Emphasis pulse used by the renderer for scale/glow on stressed syllables. */
  emphasis: number;
  lipsyncMode: LipSyncMode;
  speaking: boolean;
};

export type AvatarEngineOptions = {
  reducedMotion?: boolean;
  random?: () => number;
};

export class AvatarEngine {
  readonly state = new CharacterStateMachine();
  readonly lipsync = new LipSyncEngine();
  private readonly expressions = new ExpressionController({ transitionSeconds: 0.42 });
  private readonly reducedMotion: boolean;
  private readonly random: () => number;

  private elapsed = 0;
  private nextBlinkAt = 2.5;
  private blinkPhase = -1; // -1 idle, else seconds into blink
  private moodExpression: Expression | null = null;
  private expressionExpiresAt = 0;
  private lastMouth = 0;
  private emphasis = 0;
  private unsubscribe: () => void;

  constructor(opts: AvatarEngineOptions = {}) {
    this.reducedMotion = opts.reducedMotion ?? false;
    this.random = opts.random ?? Math.random;
    this.unsubscribe = this.state.subscribe((change) => {
      if (this.moodExpression && Date.now() < this.expressionExpiresAt) return;
      const mapped = STATE_EXPRESSION[change.to] ?? 'neutral';
      this.expressions.set(mapped);
    });
  }

  dispose(): void {
    this.unsubscribe();
    this.lipsync.reset();
  }

  get currentState(): AvatarState {
    return this.state.current;
  }

  /** Voice/chat pipeline hooks */
  beginListening(): void {
    this.state.set('LISTENING', 'mic-open');
  }
  beginProcessing(): void {
    this.state.set('PROCESSING', 'request-sent');
  }
  beginThinking(): void {
    this.state.set('THINKING', 'tool-loop');
  }
  beginSpeaking(text?: string, visemesAvailable = false): void {
    this.state.set('SPEAKING', 'tts-start');
    if (text) {
      if (visemesAvailable) {
        // Provider gave us timing — but we only have text here, so estimate real visemes
        // from the text at the measured speech rate. Still phoneme-class driving.
        this.lipsync.loadVisemes(textToVisemeFrames(text));
      } else {
        this.lipsync.useAmplitudeMode();
      }
    }
    if (text) {
      const inferred = inferExpressionFromText(text);
      if (inferred) this.setExpression(inferred, 3200);
    }
  }
  userInterrupted(): void {
    this.state.set('INTERRUPTED', 'barge-in');
    this.lipsync.stop();
    setTimeout(() => {
      if (this.state.current === 'INTERRUPTED') this.state.set('LISTENING', 'resume-after-interrupt');
    }, 250);
  }
  endSpeaking(): void {
    this.lipsync.stop();
    if (this.state.current === 'SPEAKING') this.state.set('IDLE', 'tts-end');
  }
  fail(): void {
    this.lipsync.stop();
    this.state.set('ERROR', 'pipeline-error');
  }
  goIdle(): void {
    this.lipsync.stop();
    this.state.reset('idle');
  }

  setExpression(expression: Expression, holdMs = 0): void {
    this.expressions.set(expression);
    this.moodExpression = holdMs > 0 ? expression : null;
    this.expressionExpiresAt = holdMs > 0 ? Date.now() + holdMs : 0;
  }

  /** Provider viseme timing (e.g. Gemini/OpenAI audio alignment events). */
  loadProviderVisemes(frames: Array<{ viseme: string; atMs: number; durationMs: number }>): void {
    const valid = frames.filter((f) => /^(sil|AA|E|IH|O|U|MBP|FV|L|WQ|TH|S)$/.test(f.viseme));
    if (valid.length === 0) return;
    this.lipsync.loadVisemes(valid.map((f) => ({ viseme: f.viseme as never, atMs: f.atMs, durationMs: f.durationMs })));
  }

  /** Real audio spectrum for amplitude-mode lipsync + speaking glow. */
  feedAudioSpectrum(data: Uint8Array | Float32Array, dt: number): MouthFrame {
    const rms = rmsFromFrequencyData(data);
    const mouth = this.lipsync.feedAmplitude(rms, dt);
    this.emphasis = Math.min(1, rms * 3);
    return mouth;
  }

  /** Frame update. Call once per render tick with seconds elapsed. */
  frame(dt: number): AvatarPose {
    const safeDt = Math.min(0.1, Math.max(0, dt));
    this.elapsed += safeDt;

    if (this.moodExpression && Date.now() >= this.expressionExpiresAt) {
      this.moodExpression = null;
      this.expressions.set(STATE_EXPRESSION[this.state.current] ?? 'neutral');
    }

    const mouth = this.lipsync.advance(safeDt);
    if (this.state.current !== 'SPEAKING') {
      // Guarantee mouth closes when audio stops, even if a viseme stream is stale.
      this.lipsync.reset();
    }

    // Blink: randomised interval, 140ms close-open.
    this.nextBlinkAt -= safeDt;
    if (this.blinkPhase < 0 && this.nextBlinkAt <= 0) {
      this.blinkPhase = 0;
    }
    let blink = 0;
    if (this.blinkPhase >= 0) {
      this.blinkPhase += safeDt;
      const p = this.blinkPhase / 0.16;
      blink = p < 0.5 ? p * 2 : Math.max(0, 2 - p * 2);
      if (p >= 1) {
        this.blinkPhase = -1;
        this.nextBlinkAt = 2 + this.random() * 4.5;
      }
    }
    if (this.reducedMotion) blink = Math.min(blink, 0.3);

    const t = this.elapsed;
    const speaking = this.state.current === 'SPEAKING';
    const listening = this.state.current === 'LISTENING';

    // Idle motion: breathing + slow sway; nodding while listening, tilts while thinking.
    const motion = this.reducedMotion ? 0.25 : 1;
    const breath = Math.sin(t * 1.6) * 0.5 + 0.5;
    const sway = Math.sin(t * 0.55) * 0.06 * motion;
    const nod = listening ? Math.sin(t * 2.1) * 0.05 + Math.sin(t * 0.8) * 0.02 : 0;
    const think = this.state.current === 'THINKING' || this.state.current === 'PROCESSING' ? Math.sin(t * 0.9) * 0.05 : 0;
    const speakBob = speaking ? Math.sin(t * 7.5) * 0.018 * (0.4 + this.emphasis) : 0;

    const face = this.expressions.update(safeDt);
    const gazeX = (listening ? Math.sin(t * 0.7) * 0.18 : Math.sin(t * 0.33) * 0.09) * motion;
    const gazeY = (this.state.current === 'THINKING' ? 0.22 : Math.sin(t * 0.4) * 0.06) * motion;

    this.lastMouth = mouth.openness;
    return {
      state: this.state.current,
      expression: this.expressions.expression,
      face: { ...face, eyeOpen: face.eyeOpen * (1 - blink) },
      mouth,
      head: {
        yaw: sway + Math.sin(t * 0.31) * 0.02 * motion,
        pitch: nod + think + speakBob + Math.sin(t * 0.47) * 0.015 * motion,
        roll: face.headTilt + Math.sin(t * 0.62) * 0.012 * motion,
      },
      gaze: { x: gazeX, y: gazeY },
      blink,
      breath,
      emphasis: this.emphasis,
      lipsyncMode: this.lipsync.activeMode,
      speaking,
    };
  }

  get mouthOpenness(): number {
    return this.lastMouth;
  }
}
