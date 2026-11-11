import { describe, expect, it } from 'vitest';

import { DEFAULT_TIMEBASE, type Timebase } from './timebase';
import { formatTimecode, isTimecodeShaped, parseTimecode, timecodeParts } from './timecode';

const NTSC_30: Timebase = { num: 30_000, den: 1_001 }; // 29.97, drop-frame
const NTSC_60: Timebase = { num: 60_000, den: 1_001 }; // 59.94, drop-frame
const PAL: Timebase = { num: 25, den: 1 };
const FILM: Timebase = { num: 24, den: 1 };

describe('writing a frame as timecode', () => {
  it('writes zero and one frame', () => {
    expect(formatTimecode(0, PAL)).toBe('00:00:00:00');
    expect(formatTimecode(1, PAL)).toBe('00:00:00:01');
  });

  it('writes a minute and an hour at a whole rate', () => {
    expect(formatTimecode(25 * 60, PAL)).toBe('00:01:00:00');
    expect(formatTimecode(25 * 60 * 60, PAL)).toBe('01:00:00:00');
    expect(formatTimecode(24 * 60 * 60 * 2, FILM)).toBe('02:00:00:00');
  });

  it('does not wrap at 24 hours — a long timeline is still readable', () => {
    expect(formatTimecode(25 * 60 * 60 * 26, PAL)).toBe('26:00:00:00');
  });

  it('separates the frames with a colon when the rate drops none', () => {
    expect(formatTimecode(1799, PAL)).toBe('00:01:11:24');
  });

  // -- drop-frame ----------------------------------------------------------

  it('separates the frames with a semicolon when the rate drops frames', () => {
    expect(formatTimecode(0, NTSC_30)).toBe('00:00:00;00');
    expect(formatTimecode(1800, NTSC_30)).toBe('00:01:00;02');
  });

  it('skips the two frame numbers at the top of a minute that is not a tenth', () => {
    // 29.97: the last frames of the first minute are ;27 ;28 ;29, and the next
    // minute starts at ;02 — because ;00 and ;01 were dropped.
    expect(formatTimecode(1797, NTSC_30)).toBe('00:00:59;27');
    expect(formatTimecode(1798, NTSC_30)).toBe('00:00:59;28');
    expect(formatTimecode(1799, NTSC_30)).toBe('00:00:59;29');
    expect(formatTimecode(1800, NTSC_30)).toBe('00:01:00;02');
  });

  it('does not skip at a tenth minute', () => {
    expect(formatTimecode(17_982, NTSC_30)).toBe('00:10:00;00');
    expect(formatTimecode(35_964, NTSC_30)).toBe('00:20:00;00');
  });

  it('puts an hour of 29.97 at 107,892 frames and not at 108,000', () => {
    // The whole reason a rate is a fraction: 108,000 frames at 29.97 is
    // 3,603.6 seconds, and a counter that said 01:00:00;00 there would be
    // three and a half seconds later than the wall clock.
    expect(formatTimecode(107_892, NTSC_30)).toBe('01:00:00;00');
  });

  it('drops four, not two, at 59.94', () => {
    expect(formatTimecode(3599, NTSC_60)).toBe('00:00:59;59');
    expect(formatTimecode(3600, NTSC_60)).toBe('00:01:00;04');
    expect(formatTimecode(35_964, NTSC_60)).toBe('00:10:00;00');
  });

  it('treats 23.976 as non-drop', () => {
    expect(formatTimecode(24 * 60, { num: 24_000, den: 1_001 })).toBe('00:01:00:00');
  });

  it('clamps a frame that cannot exist rather than formatting nonsense', () => {
    expect(formatTimecode(-5, PAL)).toBe('00:00:00:00');
    expect(formatTimecode(Number.NaN, PAL)).toBe('00:00:00:00');
    expect(formatTimecode(1.9, PAL)).toBe('00:00:00:01');
  });
});

describe('reading a timecode back', () => {
  it('is the inverse of writing one, at every rate', () => {
    for (const timebase of [PAL, FILM, NTSC_30, NTSC_60]) {
      for (let frame = 0; frame < 2_000; frame += 1) {
        const text = formatTimecode(frame, timebase);
        expect(parseTimecode(text, timebase), `${text} at ${timebase.num}/${timebase.den}`).toBe(
          frame,
        );
      }
    }
  });

  it('is the inverse of writing one around an hour, where drift would show', () => {
    for (let frame = 107_000; frame < 108_500; frame += 1) {
      expect(parseTimecode(formatTimecode(frame, NTSC_30), NTSC_30)).toBe(frame);
    }
  });

  it('reads a timecode typed with a dot, because a keypad has one', () => {
    expect(parseTimecode('00:01:00.00', PAL)).toBe(1500);
  });

  it('refuses a frame number the counter never shows', () => {
    // At 29.97 the counter goes ;29 → next minute ;02. These two do not exist.
    expect(parseTimecode('00:01:00;00', NTSC_30)).toBeNull();
    expect(parseTimecode('00:01:00;01', NTSC_30)).toBeNull();
    expect(parseTimecode('00:01:00;02', NTSC_30)).toBe(1800);
  });

  it('accepts the same two numbers at a rate that does not drop', () => {
    expect(parseTimecode('00:01:00:00', PAL)).toBe(1500);
    expect(parseTimecode('00:01:00:01', PAL)).toBe(1501);
  });

  it('refuses a part that is out of range', () => {
    expect(parseTimecode('00:00:75:00', PAL)).toBeNull();
    expect(parseTimecode('00:99:00:00', PAL)).toBeNull();
    expect(parseTimecode('00:00:00:25', PAL)).toBeNull(); // 25 frames at 25fps
  });

  it('refuses text that is not shaped like a timecode', () => {
    expect(parseTimecode('', PAL)).toBeNull();
    expect(parseTimecode('1:23', PAL)).toBeNull();
    expect(parseTimecode('abc', PAL)).toBeNull();
    expect(parseTimecode('00-00-00-00', PAL)).toBeNull();
  });

  it('tolerates the spaces a hand types', () => {
    expect(parseTimecode('  00:00:10:00  ', PAL)).toBe(250);
  });
});

describe('the parts of a timecode', () => {
  it('splits what it formats', () => {
    expect(timecodeParts(107_892, NTSC_30)).toEqual({
      hours: 1,
      minutes: 0,
      seconds: 0,
      frames: 0,
      dropFrame: true,
    });
    expect(timecodeParts(1500, DEFAULT_TIMEBASE).dropFrame).toBe(false);
  });
});

describe('whether text is shaped like a timecode', () => {
  it('says yes before the frame count is complete', () => {
    expect(isTimecodeShaped('00:00:1')).toBe(false);
    expect(isTimecodeShaped('00:00:10:0')).toBe(true);
  });
});
