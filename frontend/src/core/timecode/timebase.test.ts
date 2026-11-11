import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TIMEBASE,
  dropFramesPerMinute,
  formatFps,
  framesToSeconds,
  isDropFrame,
  nominalFps,
  parseTimebase,
  reduceTimebase,
  sameTimebase,
  secondsToFrames,
  Rounding,
  type Timebase,
} from './timebase';

const NTSC: Timebase = { num: 30_000, den: 1_001 };

describe('a rate that is a fraction', () => {
  it('converts frames to seconds through the denominator, not through a float', () => {
    // Drop-frame timecode reads 01:00:00;00 at 107,892 frames, and that is
    // 3,599.9964 seconds of media — the 3.6 ms it is short of an hour is the
    // error drop-frame exists to keep from accumulating. Counting an hour as
    // 108,000 frames instead — what a rate rounded to 29.97 would do — is
    // 3,603.6 seconds, and nearly four seconds of drift in one hour.
    expect(framesToSeconds(107_892, NTSC)).toBeCloseTo(3599.9964, 4);
    expect(framesToSeconds(108_000, NTSC)).toBeCloseTo(3603.6, 4);
    expect(framesToSeconds(30, DEFAULT_TIMEBASE)).toBe(1);
  });

  it('lands a time on the frame that is showing', () => {
    expect(secondsToFrames(1, DEFAULT_TIMEBASE)).toBe(30);
    expect(secondsToFrames(0.99, DEFAULT_TIMEBASE)).toBe(29);
    expect(secondsToFrames(0.99, DEFAULT_TIMEBASE, Rounding.NEAREST)).toBe(30);
    expect(secondsToFrames(0.01, DEFAULT_TIMEBASE, Rounding.CEIL)).toBe(1);
  });

  it('rounds a caption cue to the nearest frame, not down', () => {
    expect(secondsToFrames(1.5, DEFAULT_TIMEBASE, Rounding.NEAREST)).toBe(45);
  });

  it('names the rate a label would print', () => {
    expect(formatFps(DEFAULT_TIMEBASE)).toBe('30');
    expect(formatFps(NTSC)).toBe('29.97');
    expect(formatFps({ num: 24_000, den: 1_001 })).toBe('23.98');
  });
});

describe('which rates drop frames', () => {
  it('names the two NTSC rates, and only those', () => {
    expect(isDropFrame(NTSC)).toBe(true);
    expect(isDropFrame({ num: 60_000, den: 1_001 })).toBe(true);
    expect(isDropFrame({ num: 30, den: 1 })).toBe(false);
    expect(isDropFrame({ num: 24_000, den: 1_001 })).toBe(false);
  });

  it('counts two skips at 29.97 and four at 59.94', () => {
    expect(dropFramesPerMinute(NTSC)).toBe(2);
    expect(dropFramesPerMinute({ num: 60_000, den: 1_001 })).toBe(4);
  });

  it('counts the whole number, which is what a drop-frame counter runs on', () => {
    expect(nominalFps(NTSC)).toBe(30);
    expect(nominalFps({ num: 60_000, den: 1_001 })).toBe(60);
    expect(nominalFps({ num: 24_000, den: 1_001 })).toBe(24);
  });
});

describe('a rate written as text', () => {
  it('reads the two spellings the service uses', () => {
    expect(parseTimebase('30000/1001')).toEqual({ num: 30_000, den: 1_001 });
    expect(parseTimebase('25')).toEqual({ num: 25, den: 1 });
  });

  it('refuses a rate that does not exist, rather than defaulting to 30', () => {
    expect(parseTimebase('')).toBeNull();
    expect(parseTimebase('30/0')).toBeNull();
    expect(parseTimebase('-30/1')).toBeNull();
    expect(parseTimebase('30/1/1')).toBeNull();
    expect(parseTimebase('twenty-five')).toBeNull();
  });

  it('reduces, so two spellings of one rate are one rate', () => {
    expect(reduceTimebase({ num: 60, den: 2 })).toEqual({ num: 30, den: 1 });
    expect(sameTimebase({ num: 60_000, den: 2_002 }, NTSC)).toBe(true);
    expect(sameTimebase({ num: 30, den: 1 }, NTSC)).toBe(false);
  });
});
