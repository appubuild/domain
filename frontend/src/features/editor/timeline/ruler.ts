/** The ruler: which frames get a tick, and which of those get a label.
 *
 *  A ruler is the one part of a timeline that cannot be drawn by dividing
 *  evenly. Ticks every 30 frames is a ruler that says "one second" at 30 fps and
 *  "1.001 seconds" at 29.97; ticks every 100 frames is a ruler that means
 *  nothing at any rate. So the ladder is built **from the project's timebase**,
 *  in seconds and minutes, and only descends to bare frames when a second is
 *  still wider than the label needs.
 *
 *  The other half is that the ladder is *quantised*: the interval is one of a
 *  fixed set of rungs rather than `pixels / frames`. A continuously-computed
 *  interval makes the labels change as you zoom by a single pixel, which reads
 *  as flicker — and makes two people looking at the same edit see different
 *  numbers.
 *
 *  Pure, and deliberately so: no canvas, no store, no clock. What a tick *is*
 *  belongs here; where it is drawn is `layout.frameToX`.
 */

import { fpsOf, type Timebase } from '../../../core/timecode/timebase';
import { formatTimecode } from '../../../core/timecode/timecode';

/** How much room a label needs before the next one may be drawn.
 *
 *  Wide enough for `01:02:03:04` — the longest label a ruler draws — and not
 *  for the label plus a comfortable margin, because a ruler with four ticks on
 *  it tells the user less than one with twelve. */
export const LABEL_PIXELS = 76;

/** The rungs, as seconds. Below them: frames, which is the only unit a project
 *  zoomed past its own second marks has left. */
const SECOND_RUNGS = [1, 2, 5, 10, 15, 30, 60] as const;
const MINUTE_RUNGS = [2, 5, 10, 15, 30, 60] as const;
const FRAME_RUNGS = [1, 2, 5, 10, 15, 30] as const;

export interface RulerTicks {
  /** Frames that get a line and a label. */
  readonly major: readonly number[];
  /** Frames that get a line and no label: the ticks between the ticks. */
  readonly minor: readonly number[];
  /** How many frames apart the labelled ticks are. */
  readonly interval: number;
  /** How many frames apart the unlabelled ones are; `0` when there are none. */
  readonly minorInterval: number;
}

/** Every rung, in frames, ascending, for one project's rate.
 *
 *  Built once per rate rather than per zoom, and rounded to whole frames: a tick
 *  at frame 29.97 is not a frame. Two rungs that round to the same frame count
 *  are one rung — at 29.97, "2 seconds" and "60 frames" are the same tick, and
 *  a ladder with the same number twice is a ladder that can pick a rung and get
 *  the spacing it just rejected. */
export function tickLadder(timebase: Timebase): readonly number[] {
  const frames: number[] = [...FRAME_RUNGS];
  const fps = fpsOf(timebase);
  if (!Number.isFinite(fps) || fps <= 0) return dedupe(frames);

  for (const seconds of SECOND_RUNGS) frames.push(Math.round(seconds * fps));
  for (const minutes of MINUTE_RUNGS) frames.push(Math.round(minutes * 60 * fps));
  return dedupe(frames);
}

function dedupe(frames: readonly number[]): readonly number[] {
  const unique = [...new Set(frames.filter((frame) => Number.isInteger(frame) && frame > 0))];
  return unique.sort((a, b) => a - b);
}

/** The interval to draw at: the smallest rung whose ticks are at least
 *  `minPixels` apart, and the widest one when even that is too tight.
 *
 *  Smallest-first, so the ruler is as informative as the zoom allows. The last
 *  rung is the answer when nothing fits — a zoomed-out ruler with one tick a
 *  minute is better than one with none, and at the widest zoom a project is
 *  hours long.
 */
export function chooseTickInterval(
  pxPerFrame: number,
  timebase: Timebase,
  minPixels = LABEL_PIXELS,
): number {
  const ladder = tickLadder(timebase);
  if (ladder.length === 0) return 1;
  if (!Number.isFinite(pxPerFrame) || pxPerFrame <= 0) return ladder[ladder.length - 1] as number;
  for (const rung of ladder) {
    if (rung * pxPerFrame >= minPixels) return rung;
  }
  return ladder[ladder.length - 1] as number;
}

/** How far apart the unlabelled ticks are.
 *
 *  Five to a major tick where the interval divides by five, then four, then
 *  two — because five-to-a-interval is what a ruler looks like, and an interval
 *  of 1 frame has no room for anything between. `0` means draw none.
 */
export function minorInterval(interval: number): number {
  for (const parts of [5, 4, 2]) {
    if (interval % parts === 0) return interval / parts;
  }
  return 0;
}

/** The ticks to draw: every interval inside `[firstFrame, lastFrame]`, aligned
 *  to frame zero rather than to the left edge of the viewport.
 *
 *  Alignment is why this is not `range / interval` from wherever the scroll
 *  happens to be: a tick that moved with the scroll would slide under the label
 *  next to it, and two rulers side by side would never agree.
 */
export function rulerTicks(firstFrame: number, lastFrame: number, interval: number): RulerTicks {
  if (!Number.isFinite(interval) || interval <= 0) {
    return { major: [], minor: [], interval: 0, minorInterval: 0 };
  }
  const step = minorInterval(interval);
  const major: number[] = [];
  const minor: number[] = [];

  const firstTick = Math.max(0, Math.ceil(firstFrame / interval) * interval);
  for (let frame = firstTick; frame <= lastFrame; frame += interval) {
    major.push(frame);
    if (step > 0) {
      for (
        let small = frame + step;
        small < frame + interval && small <= lastFrame;
        small += step
      ) {
        minor.push(small);
      }
    }
  }
  // The ticks before frame zero do not exist, but the gap between zero and the
  // first one does: without these, scrolling right leaves the left edge blank
  // until a whole interval has passed.
  if (step > 0 && firstTick > 0) {
    const before = firstTick - interval;
    for (let small = Math.max(0, before + step); small < firstTick; small += step) {
      minor.push(small);
    }
  }

  return { major, minor, interval, minorInterval: step };
}

/** One label. Timecode rather than a frame count, because a frame count is a
 *  number the user has to convert before it means anything. */
export function tickLabel(frame: number, timebase: Timebase): string {
  return formatTimecode(frame, timebase);
}
