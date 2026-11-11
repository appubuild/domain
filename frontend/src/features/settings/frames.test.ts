/** The frame arithmetic, and the one rule it exists to keep true.
 *
 *  `3840 × 2160` and `1920 × 1080` are the same shape, and a panel that did not
 *  reduce them would tell the user they are not. The cap at 64 is the other
 *  half: `1000:563` is arithmetic, not a shape, and a panel that rounded it to
 *  "16:9" would be telling the user their frame is something it is not.
 */

import { describe, expect, it } from 'vitest';

import { FRAME_PRESETS, aspectDecimal, aspectLabel, gcd, presetFor } from './frames';

describe('the presets', () => {
  it('are found by their dimensions, not by an id', () => {
    // The service does not store an id: a preset is a shortcut for typing two
    // numbers, so a project saved with 3840×2160 has to come back as "4K"
    // whether it was typed or chosen.
    expect(presetFor(3840, 2160)?.id).toBe('3840x2160');
    expect(presetFor(1920, 1080)?.id).toBe('1920x1080');
  });

  it("say no when the frame is one of the user's own", () => {
    expect(presetFor(1440, 1080)).toBeNull();
  });

  it('include a vertical frame, because vertical video is a thing', () => {
    expect(FRAME_PRESETS.some((preset) => preset.width < preset.height)).toBe(true);
  });

  it('are all even, because the export is 4:2:0', () => {
    for (const preset of FRAME_PRESETS) {
      expect(preset.width % 2).toBe(0);
      expect(preset.height % 2).toBe(0);
    }
  });
});

describe('an aspect ratio', () => {
  it('is reduced to the shape a user names', () => {
    expect(aspectLabel(1920, 1080)).toBe('16:9');
    expect(aspectLabel(3840, 2160)).toBe('16:9');
    expect(aspectLabel(1080, 1920)).toBe('9:16');
    expect(aspectLabel(1080, 1080)).toBe('1:1');
  });

  it('is the same shape at every size', () => {
    // The rule this module exists to keep true.
    expect(aspectLabel(3840, 2160)).toBe(aspectLabel(1280, 720));
  });

  it('is shown as a decimal when it is not a shape anybody names', () => {
    // 1000:563 is true and useless; 1.776 is what an editor compares. Note
    // that 16:9 would have been 1.778 — the decimal is what shows the two are
    // not the same frame, which is exactly the comparison the user is making.
    expect(aspectLabel(1000, 563)).toBe('1.776:1');
    expect(aspectLabel(1000, 563)).not.toBe(aspectDecimal(1920, 1080) + ':1');
  });

  it('has a decimal beside it, because 16:9 and 1.778 are both useful', () => {
    expect(aspectDecimal(1920, 1080)).toBe('1.778');
    expect(aspectDecimal(1080, 1080)).toBe('1.000');
  });

  it('says nothing rather than dividing by zero', () => {
    expect(aspectLabel(0, 1080)).toBe('—');
    expect(aspectDecimal(1920, 0)).toBe('—');
  });
});

describe('the greatest common divisor', () => {
  it('divides', () => {
    expect(gcd(1920, 1080)).toBe(120);
    expect(gcd(1080, 1080)).toBe(1080);
    expect(gcd(7, 3)).toBe(1);
  });

  it('does not care about the order or the sign', () => {
    expect(gcd(1080, 1920)).toBe(120);
    expect(gcd(-1920, 1080)).toBe(120);
  });

  it('answers for zero, because a frame of nothing is a state', () => {
    expect(gcd(0, 1080)).toBe(1080);
    expect(gcd(0, 0)).toBe(0);
  });
});
