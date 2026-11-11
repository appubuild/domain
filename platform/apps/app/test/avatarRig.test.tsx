import { describe, expect, it } from 'vitest';
import { AvatarEngine, AVATAR_STATES, VISEME_SHAPES } from '@aura/core/avatar';
import { CHARACTER_TEMPLATES } from '@aura/core/characters';

/**
 * The 3D rig is driven entirely by AvatarPose. These tests pin the contract between the
 * engine and the renderer: every template must produce a finite, bounded pose in every
 * state, and mouth openness must reflect the viseme stream rather than random motion.
 */
describe('avatar engine → rig contract', () => {
  it('rejects impossible transitions instead of animating them', () => {
    const engine = new AvatarEngine({ reducedMotion: true });
    // You cannot be interrupted before anything started; the machine refuses it.
    expect(engine.state.set('INTERRUPTED', 'nonsense')).toBe(false);
    expect(engine.currentState).toBe('IDLE');
    engine.beginSpeaking('x');
    expect(engine.state.set('INTERRUPTED', 'barge-in')).toBe(true);
  });

  it('produces a valid pose for every state via legal transitions', () => {
    for (const state of AVATAR_STATES) {
      const engine = new AvatarEngine({ reducedMotion: true, random: () => 0.5 });
      // Walk the documented graph so the pose is measured in a genuinely reachable state.
      if (state === 'INTERRUPTED') {
        engine.beginSpeaking('interrupt me');
        engine.userInterrupted();
      } else {
        engine.state.set(state, 'test');
      }
      if (state === 'ERROR') engine.state.set('ERROR', 'test');
      for (let i = 0; i < 12; i++) {
        const pose = engine.frame(1 / 30);
        expect(pose.state).toBe(state);
        expect(Number.isFinite(pose.head.yaw)).toBe(true);
        expect(Math.abs(pose.head.yaw)).toBeLessThan(0.5);
        expect(Number.isFinite(pose.breath)).toBe(true);
        expect(pose.breath).toBeGreaterThanOrEqual(0);
        expect(pose.breath).toBeLessThanOrEqual(1.0001);
        expect(pose.face.eyeOpen).toBeGreaterThanOrEqual(0);
        expect(pose.mouth.openness).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('closes the mouth when not speaking, even with a stale viseme stream loaded', () => {
    const engine = new AvatarEngine({ reducedMotion: true });
    engine.beginSpeaking('hello there', true);
    const speaking = engine.frame(0.05);
    expect(speaking.state).toBe('SPEAKING');
    engine.endSpeaking();
    for (let i = 0; i < 20; i++) engine.frame(0.05);
    const idle = engine.frame(0.05);
    expect(idle.mouth.openness).toBeLessThan(0.25);
  });

  it('drives amplitude lipsync from measured audio level', () => {
    const engine = new AvatarEngine({ reducedMotion: true });
    engine.beginSpeaking();
    const quiet = engine.lipsync.feedAmplitude(0, 1 / 60);
    const loud = engine.lipsync.feedAmplitude(0.9, 1 / 60);
    expect(loud.openness).toBeGreaterThan(quiet.openness);
  });

  it('moves through INTERRUPTED on barge-in and returns to LISTENING', async () => {
    const engine = new AvatarEngine();
    engine.beginSpeaking('a long sentence that is being interrupted');
    engine.userInterrupted();
    expect(engine.currentState).toBe('INTERRUPTED');
    await new Promise((r) => setTimeout(r, 300));
    expect(engine.currentState).toBe('LISTENING');
  });

  it('every template defines a complete, renderable avatar spec', () => {
    expect(CHARACTER_TEMPLATES).toHaveLength(7);
    const accents = new Set<string>();
    const families = new Set<string>();
    for (const t of CHARACTER_TEMPLATES) {
      const spec = t.avatar;
      accents.add(t.accent);
      families.add(t.renderFamily);
      expect(spec.palette.accent).toMatch(/^#[0-9a-f]{6}$/i);
      expect(spec.head.width).toBeGreaterThanOrEqual(0.6);
      expect(spec.body.shoulderWidth).toBeGreaterThan(0.7);
      expect(spec.hair.style).toBeTruthy();
      expect(['void', 'holo-room', 'gradient']).toContain(spec.background);
    }
    // Seven distinct characters must not collapse into one look.
    expect(accents.size).toBeGreaterThanOrEqual(6);
    expect(families.size).toBe(5);
  });

  it('viseme shapes stay in normalised 0..1 space for the rig to consume', () => {
    for (const [viseme, shape] of Object.entries(VISEME_SHAPES)) {
      expect(viseme.length).toBeGreaterThan(0);
      for (const key of ['aa', 'ih', 'ou', 'ee', 'oh', 'closed', 'wide', 'round', 'teeth'] as const) {
        const v = shape[key];
        if (v === undefined) continue;
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});
