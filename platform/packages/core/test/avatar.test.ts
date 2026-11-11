import { describe, expect, it } from 'vitest';
import { AvatarEngine } from '../src/avatar/engine.js';
import { CharacterStateMachine } from '../src/avatar/state.js';
import { ExpressionController, FACE_PRESETS, blendFace, inferExpressionFromText } from '../src/avatar/expressions.js';
import { LipSyncEngine, VISEME_SHAPES, rmsFromFrequencyData, textToVisemeFrames } from '../src/avatar/visemes.js';
import { EnergyVad } from '../src/avatar/vad.js';
import { CHARACTER_TEMPLATES } from '../src/characters/templates.js';

function step(engine: AvatarEngine, seconds: number, fps = 60): ReturnType<AvatarEngine['frame']> {
  let pose = engine.frame(0);
  for (let i = 0; i < seconds * fps; i++) pose = engine.frame(1 / fps);
  return pose;
}

describe('character state machine', () => {
  it('enforces valid transitions and announces changes', () => {
    const sm = new CharacterStateMachine();
    const seen: string[] = [];
    sm.subscribe((c) => seen.push(`${c.from}->${c.to}`));
    expect(sm.current).toBe('IDLE');
    expect(sm.set('SPEAKING')).toBe(true);
    expect(sm.set('THINKING')).toBe(false); // SPEAKING cannot go to THINKING
    expect(sm.set('IDLE')).toBe(true);
    expect(sm.set('LISTENING')).toBe(true);
    expect(sm.set('PROCESSING')).toBe(true);
    expect(sm.set('THINKING')).toBe(true);
    expect(sm.set('SPEAKING')).toBe(true);
    expect(seen).toContain('IDLE->SPEAKING');
    expect(sm.recentChanges().length).toBe(6);
  });

  it('recovers to IDLE from every state', () => {
    const paths: Record<string, string[]> = {
      IDLE: [],
      LISTENING: ['LISTENING'],
      PROCESSING: ['PROCESSING'],
      THINKING: ['PROCESSING', 'THINKING'],
      SPEAKING: ['PROCESSING', 'SPEAKING'],
      INTERRUPTED: ['LISTENING', 'INTERRUPTED'],
      ERROR: ['ERROR'],
    };
    for (const [target, path] of Object.entries(paths)) {
      const sm = new CharacterStateMachine();
      for (const step of path) expect(sm.set(step as never)).toBe(true);
      expect(sm.current).toBe(target);
      sm.reset();
      expect(sm.current).toBe('IDLE');
    }
  });
});

describe('expressions', () => {
  it('blends smoothly instead of snapping', () => {
    const c = new ExpressionController({ transitionSeconds: 0.5 });
    c.set('happy');
    const first = c.update(0.016);
    expect(first.mouthSmile).toBeLessThan(0.3);
    const mid = c.update(0.25);
    expect(mid.mouthSmile).toBeGreaterThan(first.mouthSmile);
    const end = c.update(0.5);
    expect(end.mouthSmile).toBeCloseTo(FACE_PRESETS.happy.mouthSmile, 3);
  });

  it('keeps every preset bounded in [0, 1.4]', () => {
    for (const [name, p] of Object.entries(FACE_PRESETS)) {
      for (const [k, v] of Object.entries(p)) {
        expect(v, `${name}.${k}`).toBeGreaterThanOrEqual(-0.5);
        expect(v, `${name}.${k}`).toBeLessThanOrEqual(1.4);
      }
    }
  });

  it('infers expressions only from strong cues', () => {
    expect(inferExpressionFromText('I am sorry, that failed.')).toBe('concerned');
    expect(inferExpressionFromText('Congratulations on shipping!')).toBe('happy');
    expect(inferExpressionFromText('The file is 4 KB.')).toBeNull();
  });

  it('blends two faces by fraction', () => {
    const half = blendFace(FACE_PRESETS.neutral, FACE_PRESETS.surprised, 0.5);
    expect(half.browRaise).toBeGreaterThan(FACE_PRESETS.neutral.browRaise);
    expect(half.browRaise).toBeLessThan(FACE_PRESETS.surprised.browRaise);
  });
});

describe('lip sync', () => {
  it('produces real viseme timings from text', () => {
    const frames = textToVisemeFrames('Hello there, this is a lip sync test.');
    expect(frames.length).toBeGreaterThan(10);
    const monos = new Set(frames.map((f) => f.viseme));
    expect(monos.size).toBeGreaterThan(3);
    // strictly increasing times
    for (let i = 1; i < frames.length; i++) expect(frames[i]!.atMs).toBeGreaterThanOrEqual(frames[i - 1]!.atMs);
  });

  it('phoneme mode follows the timeline and closes the mouth at the end', () => {
    const lip = new LipSyncEngine();
    lip.loadVisemes([
      { viseme: 'AA', atMs: 0, durationMs: 200 },
      { viseme: 'MBP', atMs: 200, durationMs: 120 },
      { viseme: 'sil', atMs: 320, durationMs: 400 },
    ]);
    expect(lip.activeMode).toBe('phoneme');
    let mouth = lip.advance(0.1);
    expect(mouth.aa).toBeGreaterThan(0.2);
    for (let i = 0; i < 60; i++) mouth = lip.advance(1 / 60);
    expect(mouth.closed).toBeGreaterThan(0.8);
    expect(mouth.openness).toBeLessThan(0.1);
    expect(lip.isIdle).toBe(true);
  });

  it('amplitude mode only opens the mouth for real signal', () => {
    const lip = new LipSyncEngine();
    lip.useAmplitudeMode();
    let mouth = lip.feedAmplitude(0, 1 / 60);
    expect(mouth.openness).toBe(0);
    for (let i = 0; i < 30; i++) mouth = lip.feedAmplitude(0.4, 1 / 60);
    expect(mouth.openness).toBeGreaterThan(0.2);
    for (let i = 0; i < 60; i++) mouth = lip.feedAmplitude(0, 1 / 60);
    expect(mouth.openness).toBeLessThan(0.05);
  });

  it('maps visemes to distinct mouth shapes covering all required classes', () => {
    const closed = VISEME_SHAPES.MBP;
    const open = VISEME_SHAPES.AA;
    const wide = VISEME_SHAPES.E;
    const rounded = VISEME_SHAPES.U;
    const teeth = VISEME_SHAPES.TH;
    expect(closed.closed).toBeGreaterThan(0.9);
    expect(open.aa).toBeGreaterThan(0.9);
    expect(wide.ee).toBeGreaterThan(0.8);
    expect(rounded.round).toBeGreaterThan(0.9);
    expect(teeth.teeth).toBeGreaterThan(0.8);
  });

  it('reads RMS from frequency data honestly', () => {
    expect(rmsFromFrequencyData(new Uint8Array([]))).toBe(0);
    const loud = rmsFromFrequencyData(new Uint8Array(64).fill(255));
    expect(loud).toBeCloseTo(1, 2);
  });
});

describe('avatar engine integration', () => {
  const text = 'Good evening. I have checked the build logs and everything passed.';

  it('runs the full speak cycle: state, visemes, mouth stops at end', () => {
    const engine = new AvatarEngine({ random: () => 0.5 });
    engine.goIdle();
    engine.beginSpeaking(text, true);
    expect(engine.currentState).toBe('SPEAKING');
    expect(engine.lipsync.activeMode).toBe('phoneme');
    let maxOpen = 0;
    for (let i = 0; i < 240; i++) {
      const pose = engine.frame(1 / 60);
      maxOpen = Math.max(maxOpen, pose.mouth.openness);
      expect(pose.speaking).toBe(true);
    }
    expect(maxOpen).toBeGreaterThan(0.15);
    engine.endSpeaking();
    expect(engine.currentState).toBe('IDLE');
    const after = step(engine, 0.5);
    expect(after.mouth.openness).toBeLessThan(0.05);
    engine.dispose();
  });

  it('guarantees the mouth closes when audio stops mid-sentence', () => {
    const engine = new AvatarEngine({ random: () => 0.5 });
    engine.beginSpeaking(text, true);
    for (let i = 0; i < 30; i++) engine.frame(1 / 60);
    engine.userInterrupted();
    const pose = step(engine, 0.4);
    expect(pose.mouth.openness).toBeLessThan(0.05);
    engine.dispose();
  });

  it('switches states through listening/thinking and maps expressions', () => {
    const engine = new AvatarEngine({ random: () => 0.5 });
    engine.beginListening();
    expect(engine.currentState).toBe('LISTENING');
    const listening = step(engine, 0.6);
    expect(listening.expression).toBe('listening');
    engine.beginThinking();
    const thinking = step(engine, 0.6);
    expect(thinking.expression).toBe('thinking');
    engine.fail();
    expect(engine.currentState).toBe('ERROR');
    const error = step(engine, 0.6);
    expect(error.expression).toBe('concerned');
    engine.goIdle();
    engine.dispose();
  });

  it('blinks periodically in idle but not while speaking-locked', () => {
    const engine = new AvatarEngine({ random: () => 0 });
    let blinks = 0;
    let prev = 0;
    for (let i = 0; i < 60 * 12; i++) {
      const pose = engine.frame(1 / 60);
      if (pose.blink > 0.6 && prev <= 0.6) blinks++;
      prev = pose.blink;
    }
    expect(blinks).toBeGreaterThanOrEqual(2);
    expect(blinks).toBeLessThanOrEqual(8);
    engine.dispose();
  });

  it('amplitude mode is used when no viseme timing exists (and labeled honestly)', () => {
    const engine = new AvatarEngine({ random: () => 0.5 });
    engine.beginSpeaking(text, false);
    expect(engine.lipsync.activeMode).toBe('amplitude');
    let maxOpen = 0;
    for (let i = 0; i < 90; i++) {
      engine.feedAudioSpectrum(new Uint8Array(128).fill(i % 5 === 0 ? 60 : 200), 1 / 60);
      maxOpen = Math.max(maxOpen, engine.frame(1 / 60).mouth.openness);
    }
    expect(maxOpen).toBeGreaterThan(0.1);
    engine.dispose();
  });

  it('keeps every frame finite and bounded for 7 characters over 10s', () => {
    for (const t of CHARACTER_TEMPLATES) {
      const engine = new AvatarEngine({ random: Math.random });
      engine.beginListening();
      engine.beginThinking();
      engine.beginSpeaking(t.config.personality.systemPrompt.slice(0, 120), true);
      for (let i = 0; i < 600; i++) {
        const p = engine.frame(1 / 60);
        expect(Number.isFinite(p.head.yaw + p.head.pitch + p.head.roll)).toBe(true);
        expect(Math.abs(p.head.yaw)).toBeLessThan(0.5);
        expect(p.face.eyeOpen).toBeGreaterThanOrEqual(0);
        expect(p.mouth.openness).toBeLessThanOrEqual(1);
        expect(p.breath).toBeGreaterThanOrEqual(0);
      }
      engine.dispose();
    }
  });
});

describe('VAD', () => {
  function frame(amplitude: number, length = 320): Float32Array {
    const a = new Float32Array(length);
    for (let i = 0; i < length; i++) a[i] = Math.sin((i / length) * Math.PI * 8) * amplitude;
    return a;
  }

  it('detects speech start and end with hysteresis', () => {
    const vad = new EnergyVad({ ...({} as never), threshold: 0.05, attackFrames: 3, releaseFrames: 6, sampleRate: 16000, frameMs: 20 });
    const events: string[] = [];
    for (let i = 0; i < 20; i++) {
      const d = vad.processFrame(frame(0.001));
      events.push(d);
    }
    for (let i = 0; i < 5; i++) events.push(vad.processFrame(frame(0.2)));
    for (let i = 0; i < 10; i++) events.push(vad.processFrame(frame(0.001)));
    expect(events).toContain('speech-start');
    expect(events).toContain('speech-end');
    expect(vad.isSpeaking).toBe(false);
  });

  it('ignores steady background noise after adapting', () => {
    const vad = new EnergyVad({ threshold: 0.05, attackFrames: 3, releaseFrames: 6, sampleRate: 16000, frameMs: 20 });
    for (let i = 0; i < 300; i++) vad.processFrame(frame(0.02));
    expect(vad.isSpeaking).toBe(false);
    let start = false;
    for (let i = 0; i < 6; i++) start = start || vad.processFrame(frame(0.25)) === 'speech-start';
    expect(start).toBe(true);
  });
});
