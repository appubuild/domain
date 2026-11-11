import { lerp } from './expressions.js';

/**
 * Viseme + lip-sync engine.
 *
 * Two honest modes:
 *  - `phoneme`: provider supplied viseme/phoneme timing (or our own text→phoneme
 *    estimate) drives exact mouth shapes at exact times.
 *  - `amplitude`: real-time RMS of the playing audio drives open/closed mouth.
 *
 * The engine always reports which mode is active so the UI can label it truthfully.
 * Amplitude mode is *not* phoneme-level lip sync and is never presented as such.
 */
export const VISEMES = ['sil', 'AA', 'E', 'IH', 'O', 'U', 'MBP', 'FV', 'L', 'WQ', 'TH', 'S'] as const;
export type Viseme = (typeof VISEMES)[number];

/** Blend-shape weights for each viseme. VRM preset names; procedural renderer maps these too. */
export type MouthShape = {
  aa: number;
  ih: number;
  ou: number;
  ee: number;
  oh: number;
  /** closure for bilabials (m/b/p) */
  closed: number;
  wide: number;
  round: number;
  /** teeth visible */
  teeth: number;
};

export const VISEME_SHAPES: Record<Viseme, MouthShape> = {
  sil: { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0, closed: 1, wide: 0, round: 0, teeth: 0 },
  AA: { aa: 1, ih: 0, ou: 0, ee: 0, oh: 0.2, closed: 0, wide: 0.35, round: 0, teeth: 0.7 },
  E: { aa: 0.2, ih: 0.2, ou: 0, ee: 0.9, oh: 0, closed: 0, wide: 0.6, round: 0, teeth: 0.5 },
  IH: { aa: 0.15, ih: 0.85, ou: 0, ee: 0.25, oh: 0, closed: 0, wide: 0.4, round: 0, teeth: 0.35 },
  O: { aa: 0.3, ih: 0, ou: 0, ee: 0, oh: 0.9, closed: 0, wide: 0, round: 0.9, teeth: 0.15 },
  U: { aa: 0, ih: 0, ou: 0.95, ee: 0, oh: 0.2, closed: 0, wide: 0, round: 1, teeth: 0 },
  MBP: { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0, closed: 1, wide: 0, round: 0.1, teeth: 0 },
  FV: { aa: 0.1, ih: 0.1, ou: 0, ee: 0.15, oh: 0, closed: 0.15, wide: 0.2, round: 0, teeth: 0.8 },
  L: { aa: 0.35, ih: 0.1, ou: 0, ee: 0, oh: 0.1, closed: 0.05, wide: 0.2, round: 0, teeth: 0.45 },
  WQ: { aa: 0, ih: 0, ou: 0.7, ee: 0, oh: 0, closed: 0, wide: 0, round: 1, teeth: 0 },
  TH: { aa: 0.25, ih: 0.15, ou: 0, ee: 0.2, oh: 0, closed: 0, wide: 0.3, round: 0, teeth: 0.9 },
  S: { aa: 0.1, ih: 0.3, ou: 0, ee: 0.5, oh: 0, closed: 0.05, wide: 0.7, round: 0, teeth: 0.75 },
};

export type VisemeFrame = { viseme: Viseme; atMs: number; durationMs: number };
export type LipSyncMode = 'phoneme' | 'amplitude';

/** English grapheme→viseme heuristic. Documented as an estimate, not a phonemizer. */
const LETTER_VISEMES: Array<[RegExp, Viseme]> = [
  [/^(?:ch|sh|j|zh)/, 'S'],
  [/^(?:th)/, 'TH'],
  [/^(?:ph|f|v)/, 'FV'],
  [/^(?:m|b|p)/, 'MBP'],
  [/^(?:w|q|oo)/, 'WQ'],
  [/^(?:a)/, 'AA'],
  [/^(?:e)/, 'E'],
  [/^(?:i|y)/, 'IH'],
  [/^(?:o)/, 'O'],
  [/^(?:u)/, 'U'],
  [/^(?:l|r|n|d|t)/, 'L'],
  [/^(?:s|z|c|x)/, 'S'],
  [/^(?:k|g|h)/, 'E'],
];

export function textToVisemeFrames(text: string, charsPerSecond = 13.5): VisemeFrame[] {
  const frames: VisemeFrame[] = [];
  const clean = text.replace(/```[\s\S]*?```/g, ' code ').replace(/[*_#>~`]/g, ' ');
  let cursor = 0;
  const chunk = clean.toLowerCase().match(/(?:[a-z]{1,4}|[0-9]+|[.!?,;:—–\s]+)/g) ?? [];
  for (const part of chunk) {
    if (/^[\s]+$/.test(part)) {
      const dur = (part.length / charsPerSecond) * 1000;
      if (dur > 90) frames.push({ viseme: 'sil', atMs: cursor, durationMs: Math.min(dur, 320) });
      cursor += dur;
      continue;
    }
    if (/^[.!?,;:—–]+$/.test(part)) {
      const dur = 140;
      frames.push({ viseme: 'sil', atMs: cursor, durationMs: dur });
      cursor += dur;
      continue;
    }
    let rest = part;
    while (rest.length > 0) {
      const match = LETTER_VISEMES.find(([re]) => re.test(rest));
      const viseme: Viseme = match ? match[1] : 'E';
      const consumed = match ? Math.min(rest.length, rest.match(/^(?:ch|sh|th|ph|oo|[a-z])/) ?. [0].length ?? 1) : 1;
      const dur = Math.max(55, (consumed / charsPerSecond) * 1000);
      frames.push({ viseme, atMs: cursor, durationMs: dur });
      cursor += dur;
      rest = rest.slice(consumed);
    }
  }
  return frames;
}

export type MouthFrame = MouthShape & { openness: number };

const ZERO: MouthShape = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0, closed: 1, wide: 0, round: 0, teeth: 0 };

export function shapeToMouth(shape: MouthShape, intensity = 1): MouthFrame {
  const k = Math.min(1, Math.max(0, intensity));
  const scaled: MouthShape = {
    aa: shape.aa * k,
    ih: shape.ih * k,
    ou: shape.ou * k,
    ee: shape.ee * k,
    oh: shape.oh * k,
    closed: 1 - (1 - shape.closed) * k,
    wide: shape.wide * k,
    round: shape.round * k,
    teeth: shape.teeth * k,
  };
  return { ...scaled, openness: Math.max(scaled.aa, scaled.oh * 0.8, scaled.ou * 0.7, scaled.ih * 0.5, scaled.ee * 0.35) };
}

export class LipSyncEngine {
  private mode: LipSyncMode = 'amplitude';
  private frames: VisemeFrame[] = [];
  private tMs = 0;
  private current: MouthFrame = { ...ZERO, openness: 0 };
  private smoothing = 14;

  get activeMode(): LipSyncMode {
    return this.mode;
  }

  get isIdle(): boolean {
    if (this.frames.length === 0) return this.current.openness < 0.015;
    // Idle when the timeline has run past its last frame and the mouth has closed.
    const last = this.frames[this.frames.length - 1];
    const past = last ? this.tMs >= last.atMs + last.durationMs : true;
    return past && this.current.openness < 0.015;
  }

  /** Load phoneme-level timing (from provider viseme events, or local text estimate). */
  loadVisemes(frames: VisemeFrame[]): void {
    this.frames = [...frames].sort((a, b) => a.atMs - b.atMs);
    this.mode = 'phoneme';
    this.tMs = 0;
  }

  useAmplitudeMode(): void {
    this.mode = 'amplitude';
    this.frames = [];
  }

  reset(): void {
    this.frames = [];
    this.tMs = 0;
    this.current = { ...ZERO, openness: 0 };
  }

  /** Phoneme mode: advance clock, get target mouth shape (sample-and-hold with crossfade). */
  advance(dtSeconds: number): MouthFrame {
    if (this.mode !== 'phoneme') return this.current;
    this.tMs += dtSeconds * 1000;
    const frame = this.frames.find((f) => this.tMs >= f.atMs && this.tMs < f.atMs + f.durationMs);
    const target = frame ? VISEME_SHAPES[frame.viseme] : ZERO;
    // Viseme end: mouth closes naturally.
    const fade = frame ? Math.min(1, (frame.durationMs - (this.tMs - frame.atMs)) / 40) : 0;
    this.current = smoothMouth(this.current, shapeToMouth(target, Math.max(0.15, fade)), dtSeconds, this.smoothing);
    return this.current;
  }

  /** Amplitude mode: feed real audio RMS in [0,1]. Never pretends to be phoneme-level. */
  feedAmplitude(rms: number, dtSeconds: number): MouthFrame {
    if (this.mode !== 'amplitude') return this.current;
    const energy = Math.min(1, Math.max(0, (rms - 0.015) * 9));
    const target = shapeToMouth({ ...VISEME_SHAPES.AA, aa: 0.75, oh: 0.15 }, energy);
    this.current = smoothMouth(this.current, target, dtSeconds, this.smoothing * 1.4);
    return this.current;
  }

  stop(): void {
    const target = shapeToMouth(ZERO, 1);
    this.current = target;
    this.frames = [];
  }

  currentMouth(): MouthFrame {
    return this.current;
  }
}

export function smoothMouth(from: MouthFrame, to: MouthFrame, dt: number, rate = 14): MouthFrame {
  const k = 1 - Math.exp(-rate * dt);
  return {
    aa: lerp(from.aa, to.aa, k),
    ih: lerp(from.ih, to.ih, k),
    ou: lerp(from.ou, to.ou, k),
    ee: lerp(from.ee, to.ee, k),
    oh: lerp(from.oh, to.oh, k),
    closed: lerp(from.closed, to.closed, k),
    wide: lerp(from.wide, to.wide, k),
    round: lerp(from.round, to.round, k),
    teeth: lerp(from.teeth, to.teeth, k),
    openness: lerp(from.openness, to.openness, k),
  };
}

/** Amplitude analysis from an AnalyserNode-style frequency buffer. Real signal, no fakes. */
export function rmsFromFrequencyData(data: Uint8Array | Float32Array): number {
  if (data.length === 0) return 0;
  let sum = 0;
  for (const v of data) {
    const n = typeof v === 'number' ? (data instanceof Uint8Array ? v / 255 : v) : 0;
    sum += n * n;
  }
  return Math.sqrt(sum / data.length);
}
