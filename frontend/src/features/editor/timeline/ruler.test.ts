/** The ruler's ladder.
 *
 *  What is pinned is the part a naive ruler gets wrong at the rates people
 *  actually cut: that a tick means a **second of the project**, not a round
 *  number of frames; that the ladder is quantised, so zooming by one pixel
 *  cannot change every label; and that ticks are aligned to frame zero rather
 *  than to wherever the viewport happens to be.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_TIMEBASE } from '../../../core/timecode/timebase';
import {
  LABEL_PIXELS,
  chooseTickInterval,
  minorInterval,
  rulerTicks,
  tickLabel,
  tickLadder,
} from './ruler';

const NTSC = { num: 30_000, den: 1_001 };
const FILM = { num: 24, den: 1 };

describe('the ladder', () => {
  it('starts in frames, for a project zoomed past its own seconds', () => {
    expect(tickLadder(DEFAULT_TIMEBASE)[0]).toBe(1);
  });

  it('counts in the project’s seconds, not in a round number of frames', () => {
    // 30 frames is a second at 30 fps and 1.001 seconds at 29.97 — which is
    // why the ladder is built from the rate instead of assuming one.
    expect(tickLadder(DEFAULT_TIMEBASE)).toContain(30);
    expect(tickLadder(NTSC)).toContain(30);
    expect(tickLadder(FILM)).toContain(24);
  });

  it('reaches minutes, because an edit is longer than a minute', () => {
    expect(tickLadder(DEFAULT_TIMEBASE)).toContain(60 * 30);
    expect(tickLadder(DEFAULT_TIMEBASE)).toContain(10 * 60 * 30);
  });

  it('is whole frames, ascending, with no rung twice', () => {
    const ladder = tickLadder(NTSC);
    expect(ladder.every((frame) => Number.isInteger(frame) && frame > 0)).toBe(true);
    for (let i = 1; i < ladder.length; i += 1) {
      expect(ladder[i] as number).toBeGreaterThan(ladder[i - 1] as number);
    }
    expect(new Set(ladder).size).toBe(ladder.length);
  });

  it('survives a rate that is not a number yet', () => {
    expect(tickLadder({ num: 0, den: 0 })).toEqual([1, 2, 5, 10, 15, 30]);
  });
});

describe('choosing an interval', () => {
  it('takes the smallest rung that leaves the label room', () => {
    // 1 px/frame: 30 frames is 30 px, too narrow for a label; 60 is 60 px,
    // still narrow; 150 (5 s) is the first that fits.
    expect(chooseTickInterval(1, DEFAULT_TIMEBASE)).toBe(150);
  });

  it('descends to bare frames when a second is wider than the label', () => {
    expect(chooseTickInterval(100, DEFAULT_TIMEBASE)).toBe(1);
  });

  it('climbs to minutes at the widest zoom', () => {
    const zoomedOut = 0.02;
    expect(chooseTickInterval(zoomedOut, DEFAULT_TIMEBASE)).toBeGreaterThan(30 * 60);
  });

  it('never picks a rung that is not on the ladder', () => {
    for (const zoom of [0.02, 0.1, 0.5, 1, 2, 4, 8, 16, 32]) {
      expect(tickLadder(DEFAULT_TIMEBASE)).toContain(chooseTickInterval(zoom, DEFAULT_TIMEBASE));
    }
  });

  it('gets wider as the zoom narrows, and never narrower', () => {
    let previous = 0;
    for (const zoom of [32, 16, 8, 4, 2, 1, 0.5, 0.1, 0.02]) {
      const interval = chooseTickInterval(zoom, DEFAULT_TIMEBASE);
      expect(interval).toBeGreaterThanOrEqual(previous);
      previous = interval;
    }
  });

  it('is quantised: one pixel of zoom cannot redraw every label', () => {
    // A continuously-computed interval would change on every wheel notch,
    // which reads as flicker.
    const labels = new Set<number>();
    for (let zoom = 0.5; zoom < 2; zoom += 0.01) {
      labels.add(chooseTickInterval(zoom, DEFAULT_TIMEBASE));
    }
    expect(labels.size).toBeLessThan(6);
  });

  it('leaves the label its room, or more', () => {
    const interval = chooseTickInterval(1, DEFAULT_TIMEBASE);
    expect(interval * 1).toBeGreaterThanOrEqual(LABEL_PIXELS);
  });

  it('answers with the top rung for a zoom that has not been measured', () => {
    const ladder = tickLadder(DEFAULT_TIMEBASE);
    expect(chooseTickInterval(0, DEFAULT_TIMEBASE)).toBe(ladder[ladder.length - 1]);
    expect(chooseTickInterval(Number.NaN, DEFAULT_TIMEBASE)).toBe(ladder[ladder.length - 1]);
  });
});

describe('the ticks between the ticks', () => {
  it('puts five under a major tick when it divides by five', () => {
    expect(minorInterval(150)).toBe(30);
  });

  it('falls back to four, then two', () => {
    // 24 frames is a second at 24 fps: not divisible by five, so four ticks;
    // 6 is divisible by neither five nor four, so two.
    expect(minorInterval(24)).toBe(6);
    expect(minorInterval(6)).toBe(3);
  });

  it('has none at all for an interval with no room', () => {
    // A 3-frame interval cannot be subdivided into whole frames, and a ruler
    // with a tick at 1.5 frames is a ruler lying about where frames are.
    expect(minorInterval(1)).toBe(0);
    expect(minorInterval(3)).toBe(0);
  });
});

describe('drawing them', () => {
  it('aligns to frame zero, not to the left edge of the viewport', () => {
    // A tick that moved with the scroll would slide under its own label.
    const scrolled = rulerTicks(97, 400, 150);
    expect(scrolled.major).toContain(150);
    expect(scrolled.major).not.toContain(97);
  });

  it('fills the visible range and no more', () => {
    const ticks = rulerTicks(0, 460, 150);
    expect(ticks.major).toEqual([0, 150, 300, 450]);
    expect(ticks.major.every((frame) => frame >= 0 && frame <= 460)).toBe(true);
  });

  it('puts the minor ticks between the major ones', () => {
    const ticks = rulerTicks(0, 150, 150);
    expect(ticks.minor).toEqual([30, 60, 90, 120]);
    expect(ticks.minor).not.toContain(150);
  });

  it('draws the minor ticks before the first major one, so the edge is not blank', () => {
    // Scrolled right: the lead-in to the first label is still on screen.
    const ticks = rulerTicks(120, 300, 150);
    expect(ticks.minor).toContain(120);
  });

  it('never draws before the beginning of the project', () => {
    expect(rulerTicks(0, 300, 150).minor.every((frame) => frame >= 0)).toBe(true);
  });

  it('draws nothing for an interval that is not one', () => {
    const ticks = rulerTicks(0, 300, 0);
    expect(ticks.major).toEqual([]);
    expect(ticks.minor).toEqual([]);
  });

  it('labels a tick as timecode, not as a frame count', () => {
    // 1800 frames at 30 fps is a minute, and a minute is what the user is
    // looking for.
    expect(tickLabel(1800, DEFAULT_TIMEBASE)).toBe('00:01:00:00');
  });
});
