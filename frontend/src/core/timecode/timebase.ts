/** Frame rates, as exact rationals.
 *
 *  A frame rate is a **fraction, never a float**, and that is the whole of this
 *  module. `29.97` is not a rate — it is a rounding of `30000/1001`, and an
 *  editor that multiplied by it drifts: one hour of timeline is 107,892 frames,
 *  which the float puts at 3,600.36 seconds, three and a half seconds past the
 *  hour. Every cut made from that number is late, and the drift is worst
 *  exactly where a project is longest.
 *
 *  The rule this module exists to keep: **frames are the integer truth and
 *  seconds are the presentation.** A playhead, a clip boundary and a caption cue
 *  are all whole frames; seconds are what a human reads, and they are derived.
 *  A UI that let a user type `1.5` seconds and stored it would have invented a
 *  frame between two frames.
 *
 *  The vocabulary matches `nova_studio.core.temporal` on the backend — `num`,
 *  `den`, `frames_to_seconds` — because a number that means one thing in Python
 *  and another in TypeScript is a bug report that takes a week to write up.
 */

/** A frame rate: `num` frames per `den` seconds, in lowest terms.
 *
 *  `30000/1001` is NTSC 29.97; `24/1` is film; `25/1` is PAL. A rate with a
 *  denominator of 1 is the common case and needs no special handling anywhere
 *  — the arithmetic is the same. */
export interface Timebase {
  readonly num: number;
  readonly den: number;
}

/** The rate a fresh project gets. 30, whole, because it is the one rate every
 *  conversion in the pipeline can express exactly. */
export const DEFAULT_TIMEBASE: Timebase = { num: 30, den: 1 };

/** What a rate works out as, for a label and for nothing else.
 *
 *  Deliberately *not* used in any conversion here: a display number rounded to
 *  two decimals is not a number to multiply by. */
export function fpsOf(timebase: Timebase): number {
  return timebase.num / timebase.den;
}

/** Whether this rate is one of the two NTSC rates whose timecode drops frames.
 *
 *  Only `30000/1001` and `60000/1001` qualify; `30000/1000` (30 exactly) does
 *  not, and neither does `24000/1001`. Guessing from the rounded rate — "it says
 *  29.97 so it must drop" — is how an editor ends up dropping frames on a rate
 *  that never asked it to. */
export function isDropFrame(timebase: Timebase): boolean {
  return (
    (timebase.num === 30_000 && timebase.den === 1_001) ||
    (timebase.num === 60_000 && timebase.den === 1_001)
  );
}

/** The integer rate a timecode counter counts in: 30 for 29.97, 60 for 59.94.
 *
 *  Drop-frame timecode is counted on the whole number and corrected by
 *  skipping, which is why the nominal rate is needed as an integer. */
export function nominalFps(timebase: Timebase): number {
  return Math.round(fpsOf(timebase));
}

/** How many frames a drop-frame counter skips at each minute that is not a
 *  tenth: 2 at 29.97, 4 at 59.94. */
export function dropFramesPerMinute(timebase: Timebase): number {
  return Math.round(nominalFps(timebase) / 15);
}

/** Seconds at a frame, exactly enough for a label.
 *
 *  `(frames * den) / num` rather than `frames / (num / den)`: the second divides
 *  by a rounded quotient, and at 29.97 the two disagree before the end of a
 *  feature. */
export function framesToSeconds(frames: number, timebase: Timebase): number {
  return (frames * timebase.den) / timebase.num;
}

/** Which way a time that lands between two frames is resolved. The same three
 *  names as `nova_studio.core.temporal.Rounding`, for the same reason as the
 *  field names: one vocabulary across the wire. */
export const Rounding = {
  FLOOR: 'floor',
  NEAREST: 'nearest',
  CEIL: 'ceil',
} as const;

export type Rounding = (typeof Rounding)[keyof typeof Rounding];

/** The frame a time lands on.
 *
 *  Rounded **down**, which is what a playhead means: the frame being shown at
 *  0.99 of a second is frame 29 at 30fps, not frame 30 — frame 30 has not
 *  started. A caller that wants the nearest frame (a caption cue the user
 *  nudged) asks for `Rounding.NEAREST`. */
export function secondsToFrames(
  seconds: number,
  timebase: Timebase,
  rounding: Rounding = Rounding.FLOOR,
): number {
  const exact = (seconds * timebase.num) / timebase.den;
  switch (rounding) {
    case Rounding.NEAREST:
      return Math.round(exact);
    case Rounding.CEIL:
      return Math.ceil(exact);
    case Rounding.FLOOR:
      return Math.floor(exact);
  }
}

/** A rate the service wrote as a string (`"30000/1001"`, or `"25"`).
 *
 *  Parsed rather than evaluated: `eval` on a wire value is not a parser, and a
 *  fraction written with a zero denominator is a rate that does not exist.
 *  `null` rather than a default, because a project at an unknown rate must not
 *  silently become a project at 30. */
export function parseTimebase(text: string): Timebase | null {
  const parts = text.split('/');
  if (parts.length > 2) return null;
  const num = Number(parts[0]);
  const den = parts.length === 2 ? Number(parts[1]) : 1;
  if (!Number.isInteger(num) || !Number.isInteger(den)) return null;
  if (num <= 0 || den <= 0) return null;
  return reduceTimebase({ num, den });
}

/** A rate in lowest terms, so two spellings of one rate compare equal.
 *
 *  `60000/1001` and `30000/1001` are different rates; `60000/2002` and
 *  `30000/1001` are the same one, and a cache keyed on the unreduced pair would
 *  hold two entries for it. */
export function reduceTimebase(timebase: Timebase): Timebase {
  const divisor = gcd(timebase.num, timebase.den);
  return { num: timebase.num / divisor, den: timebase.den / divisor };
}

export function sameTimebase(a: Timebase, b: Timebase): boolean {
  const left = reduceTimebase(a);
  const right = reduceTimebase(b);
  return left.num === right.num && left.den === right.den;
}

/** A rate, for a status line: `29.97`, `25`, `24`, `59.94`.
 *
 *  Two decimals, trailing zeros dropped: a counter that said `30.00 fps` next
 *  to a timecode separated by a colon would be the only number in the window
 *  formatted like that. */
export function formatFps(timebase: Timebase): string {
  const fps = fpsOf(timebase);
  const rounded = Math.round(fps * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

function gcd(a: number, b: number): number {
  let left = Math.abs(a);
  let right = Math.abs(b);
  while (right !== 0) {
    const next = left % right;
    left = right;
    right = next;
  }
  return left === 0 ? 1 : left;
}
