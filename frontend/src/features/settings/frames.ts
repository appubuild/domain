/** The frame presets the panel offers, and the arithmetic behind them.
 *
 *  Kept out of the component for two reasons: the list is data that a later
 *  stage reads from the service (a user's own presets, saved with the project),
 *  and the arithmetic below is the only place in the window that decides what
 *  "this frame is 16:9" means. A second copy of `gcd` in a panel is how two
 *  panels end up disagreeing about whether 3840×2160 and 1920×1080 are the same
 *  shape.
 */

/** One named frame. `null` dimensions mean "the user typed their own". */
export interface FramePreset {
  readonly id: string;
  readonly width: number;
  readonly height: number;
}

/** What the panel offers. A short list on purpose: a drop-down of forty sizes
 *  is a drop-down nobody reads, and a user with an unusual frame has the two
 *  number fields. */
export const FRAME_PRESETS: readonly FramePreset[] = [
  { id: '1920x1080', width: 1920, height: 1080 },
  { id: '1280x720', width: 1280, height: 720 },
  { id: '3840x2160', width: 3840, height: 2160 },
  { id: '1080x1920', width: 1080, height: 1920 },
  { id: '1080x1080', width: 1080, height: 1080 },
];

/** Which preset these dimensions are, or `null` for one of the user's own.
 *
 *  Compared as dimensions and not by id, because the service does not store an
 *  id: a preset is a shortcut for typing two numbers, and a project saved with
 *  3840×2160 has to come back as "4K" whether it was typed or chosen.
 */
export function presetFor(width: number, height: number): FramePreset | null {
  return FRAME_PRESETS.find((preset) => preset.width === width && preset.height === height) ?? null;
}

/** The aspect ratio in the form a user recognises.
 *
 *  Reduced by the greatest common divisor and capped, because 1.7777777778 is
 *  not a shape and 3840/2160 reduced *is* 16:9 — which is the sentence an
 *  editor says out loud. A ratio that does not reduce to anything a person
 *  names (`1000:563`) is shown as a decimal instead of as a lie: not every
 *  frame is a standard, and a panel that rounded 1.775 to "16:9" would be
 *  telling the user their frame is something it is not.
 */
export function aspectLabel(width: number, height: number): string {
  if (width <= 0 || height <= 0) return '—';
  const divisor = gcd(width, height);
  const w = width / divisor;
  const h = height / divisor;
  // Past this, the reduced ratio is arithmetic and not a shape: 1000:563 is
  // true and useless.
  if (w > 64 || h > 64) return `${(width / height).toFixed(3)}:1`;
  return `${w}:${h}`;
}

/** One decimal for the same reason: 16:9 and 1.778 are two ways of saying the
 *  same thing, and a panel that shows only one of them makes the user do the
 *  conversion in their head. */
export function aspectDecimal(width: number, height: number): string {
  if (width <= 0 || height <= 0) return '—';
  return (width / height).toFixed(3);
}

/** Euclid's, because it is four lines and it is right. */
export function gcd(a: number, b: number): number {
  let left = Math.abs(Math.trunc(a));
  let right = Math.abs(Math.trunc(b));
  while (right !== 0) {
    const next = left % right;
    left = right;
    right = next;
  }
  return left;
}
