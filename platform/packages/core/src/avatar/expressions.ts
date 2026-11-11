/**
 * Expression controller. Targets are blended over time with critically-damped
 * smoothing so the face never snaps between emotions. Expressions are driven by
 * explicit cues (not random noise): the orchestrator decides what the character feels.
 */
export const EXPRESSIONS = ['neutral', 'happy', 'curious', 'thinking', 'listening', 'surprised', 'concerned', 'confident'] as const;
export type Expression = (typeof EXPRESSIONS)[number];

export type EmotionCue =
  | { type: 'expression'; expression: Expression }
  | { type: 'mood'; valence: number; arousal: number }
  | { type: 'clear' };

/** Per-expression facial parameters, all 0..1, driving morph targets / procedural blends. */
export type FaceParams = {
  mouthSmile: number;
  browRaise: number;
  browTilt: number;
  eyeOpen: number;
  eyeSquint: number;
  headTilt: number;
  blush: number;
};

export const FACE_PRESETS: Record<Expression, FaceParams> = {
  neutral: { mouthSmile: 0.12, browRaise: 0.1, browTilt: 0, eyeOpen: 1, eyeSquint: 0.05, headTilt: 0, blush: 0 },
  happy: { mouthSmile: 0.85, browRaise: 0.25, browTilt: -0.05, eyeOpen: 0.92, eyeSquint: 0.4, headTilt: 0.04, blush: 0.2 },
  curious: { mouthSmile: 0.3, browRaise: 0.7, browTilt: 0.15, eyeOpen: 1.1, eyeSquint: 0, headTilt: 0.12, blush: 0.02 },
  thinking: { mouthSmile: 0.02, browRaise: 0.05, browTilt: 0.45, eyeOpen: 0.85, eyeSquint: 0.2, headTilt: -0.08, blush: 0 },
  listening: { mouthSmile: 0.22, browRaise: 0.3, browTilt: 0, eyeOpen: 1.05, eyeSquint: 0, headTilt: 0.05, blush: 0 },
  surprised: { mouthSmile: 0.15, browRaise: 0.95, browTilt: -0.1, eyeOpen: 1.35, eyeSquint: 0, headTilt: 0.02, blush: 0.05 },
  concerned: { mouthSmile: 0, browRaise: 0.2, browTilt: -0.45, eyeOpen: 0.9, eyeSquint: 0.25, headTilt: -0.02, blush: 0 },
  confident: { mouthSmile: 0.5, browRaise: 0.12, browTilt: -0.18, eyeOpen: 1, eyeSquint: 0.22, headTilt: 0.03, blush: 0 },
};

export const STATE_EXPRESSION: Record<string, Expression> = {
  IDLE: 'neutral',
  LISTENING: 'listening',
  PROCESSING: 'thinking',
  THINKING: 'thinking',
  SPEAKING: 'happy',
  INTERRUPTED: 'surprised',
  ERROR: 'concerned',
};

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.min(1, Math.max(0, t));
}

export function blendFace(a: FaceParams, b: FaceParams, t: number): FaceParams {
  const k = Math.min(1, Math.max(0, t));
  return {
    mouthSmile: lerp(a.mouthSmile, b.mouthSmile, k),
    browRaise: lerp(a.browRaise, b.browRaise, k),
    browTilt: lerp(a.browTilt, b.browTilt, k),
    eyeOpen: lerp(a.eyeOpen, b.eyeOpen, k),
    eyeSquint: lerp(a.eyeSquint, b.eyeSquint, k),
    headTilt: lerp(a.headTilt, b.headTilt, k),
    blush: lerp(a.blush, b.blush, k),
  };
}

export class ExpressionController {
  private target: Expression = 'neutral';
  private from: FaceParams = { ...FACE_PRESETS.neutral };
  private to: FaceParams = { ...FACE_PRESETS.neutral };
  private t = 1;
  private readonly speed: number;

  constructor(opts: { transitionSeconds?: number } = {}) {
    this.speed = 1 / (opts.transitionSeconds ?? 0.45);
  }

  get expression(): Expression {
    return this.target;
  }

  set(expression: Expression): void {
    if (expression === this.target) return;
    this.from = this.currentFace();
    this.target = expression;
    this.to = { ...FACE_PRESETS[expression] };
    this.t = 0;
  }

  currentFace(): FaceParams {
    if (this.t >= 1) return { ...this.to };
    return blendFace(this.from, this.to, easeOutCubic(this.t));
  }

  /** Advance the blend. `dt` seconds. Returns the face parameters to apply this frame. */
  update(dt: number): FaceParams {
    if (this.t < 1) this.t = Math.min(1, this.t + dt * this.speed);
    return this.currentFace();
  }

  /** Maps a valence/arousal mood pair onto the nearest expressive preset. */
  static cueToExpression(cue: EmotionCue, currentState: string): Expression {
    if (cue.type === 'clear') return STATE_EXPRESSION[currentState] ?? 'neutral';
    if (cue.type === 'expression') return cue.expression;
    const { valence, arousal } = cue;
    if (arousal > 0.75 && valence < -0.2) return 'surprised';
    if (valence > 0.55 && arousal > 0.45) return 'happy';
    if (valence < -0.45) return 'concerned';
    if (arousal < 0.3 && valence > 0.2) return 'confident';
    return 'neutral';
  }
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Emotion inference from assistant text. Intentionally conservative: only strong lexical
 * cues trigger an expression, so the face does not twitch on every sentence.
 */
export function inferExpressionFromText(text: string): Expression | null {
  const t = text.toLowerCase();
  if (/\b(i'?m sorry|unfortunately|i can'?t|that'?s concerning|warning|danger|failed)\b/.test(t)) return 'concerned';
  if (/\b(great question|interesting|curious|i wonder|let'?s explore)\b/.test(t)) return 'curious';
  if (/\b(congratulations|well done|nice work|great job|excellent|love that)\b/.test(t)) return 'happy';
  if (/\b(here'?s the plan|i'?ve got this|certainly|confident|recommend)\b/.test(t)) return 'confident';
  if (/\b(wow|surprising|unexpected|whoa)\b/.test(t)) return 'surprised';
  return null;
}
