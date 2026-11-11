/** Timecode: the number an editor reads, written the way an editor writes it.
 *
 *  `01:23:45:12` is hours, minutes, seconds and frames, and it is the one
 *  number in this application that a professional will check by hand — which is
 *  why it is a module and not a `padStart`. Three rules:
 *
 *  1. **A separator is a statement.** `:` between seconds and frames means
 *     non-drop; `;` means drop-frame. Mixing them up is not a formatting bug,
 *     it is a claim about the timeline that is false, and SMPTE 12M is why the
 *     two exist as different characters at all.
 *  2. **Drop-frame is counted, not rounded.** At 29.97 the counter skips the
 *     first two frame numbers of every minute that is not a tenth minute — so
 *     `00:01:00;00` is not a frame, and a formatter that ran the ordinary
 *     division would print timecodes an hour a day out of step with wall clock.
 *  3. **Parsing is the inverse of formatting, exactly.** `parseTimecode` returns
 *     `null` for any string no frame formats to (including `00:01:00;00` at
 *     29.97), because a timecode that never appears on the counter is not a
 *     timecode — it is a typo, and a field that silently snapped it to the
 *     nearest real frame would be a field that moves the playhead to somewhere
 *     the user did not ask for.
 *
 *  Nothing here knows about a project, a clip or a UI: frames and rates in,
 *  text out, and back again.
 */

import { dropFramesPerMinute, isDropFrame, nominalFps, type Timebase } from './timebase';

/** One timecode, as its parts. Exposed so a panel can render a field per part
 *  without parsing a string it just formatted. */
export interface TimecodeParts {
  readonly hours: number;
  readonly minutes: number;
  readonly seconds: number;
  readonly frames: number;
  /** Whether the frame numbers are being skipped. */
  readonly dropFrame: boolean;
}

/** A frame as timecode: `01:23:45:12`, or `01:23:45;12` when the rate drops
 *  frames.
 *
 *  Negative frames and non-integers are clamped to zero rather than formatted
 *  as nonsense: a playhead is never at `-1`, and a panel that showed
 *  `00:00:00:-1` would be reporting a state the model cannot hold. Hours are
 *  **not** wrapped at 24 — a 26-hour timeline is unusual and still has to be
 *  readable, and a counter that wrapped would show two different frames as the
 *  same timecode. */
export function formatTimecode(frame: number, timebase: Timebase): string {
  const drop = isDropFrame(timebase);
  const fps = nominalFps(timebase);
  const dropFrames = dropFramesPerMinute(timebase);

  let counted = Number.isFinite(frame) ? Math.max(0, Math.floor(frame)) : 0;
  if (drop && dropFrames > 0) {
    // The counter has skipped `dropFrames` numbers at the top of every minute
    // it has passed that was not a tenth minute, so the number it *shows* runs
    // ahead of the frame it *is*. Ten minutes is the cycle the rule repeats on
    // — nine skipped minutes and one that is not — and the whole correction is
    // integer arithmetic on that cycle.
    const perTenMinutes = fps * 600 - dropFrames * 9;
    const tens = Math.floor(counted / perTenMinutes);
    const remainder = counted - tens * perTenMinutes;
    const skipped =
      dropFrames * 9 * tens +
      (remainder > dropFrames
        ? dropFrames * Math.floor((remainder - dropFrames) / (fps * 60 - dropFrames))
        : 0);
    counted += skipped;
  }

  const frames = counted % fps;
  const totalSeconds = Math.floor(counted / fps);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);

  const separator = drop ? ';' : ':';
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}${separator}${pad(frames)}`;
}

/** The parts of a frame's timecode, for a caller that wants to render them
 *  separately. */
export function timecodeParts(frame: number, timebase: Timebase): TimecodeParts {
  const text = formatTimecode(frame, timebase);
  const [hours = '0', minutes = '0', seconds = '0', frames = '0'] = text.split(/[:;]/);
  return {
    hours: Number(hours),
    minutes: Number(minutes),
    seconds: Number(seconds),
    frames: Number(frames),
    dropFrame: isDropFrame(timebase),
  };
}

/** The frame a timecode names, or `null` when it names none.
 *
 *  `null` covers three different mistakes and reports them the same way,
 *  because the remedy is the same for all three: the user typed something that
 *  is not a frame, and the field should say so rather than guess.
 *
 *  * not shaped like a timecode (`1:23`, `abc`, an empty string);
 *  * a part out of range (`:75` seconds, `:30` frames at 29.97);
 *  * drop-frame, naming one of the frame numbers the counter skips — at 29.97
 *    that is `;00` and `;01` at the top of any minute that is not a tenth.
 *
 *  The last case is checked by formatting the answer back and comparing, which
 *  is the definition rather than a table: if no frame formats to this string,
 *  this string is not a frame. */
export function parseTimecode(text: string, timebase: Timebase): number | null {
  const trimmed = text.trim();
  const match = /^(\d{1,2}):(\d{1,2}):(\d{1,2})([:;.])(\d{1,3})$/.exec(trimmed);
  if (match === null) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const frames = Number(match[5]);
  const fps = nominalFps(timebase);

  if (minutes > 59 || seconds > 59 || frames >= fps) return null;

  const drop = isDropFrame(timebase);
  const dropFrames = dropFramesPerMinute(timebase);
  const totalMinutes = hours * 60 + minutes;
  let frame = (totalMinutes * 60 + seconds) * fps + frames;
  if (drop && dropFrames > 0) {
    // Undo the skipping: the counter is behind the number it shows by two (or
    // four) frames for every minute passed that was not a tenth minute.
    frame -= dropFrames * (totalMinutes - Math.floor(totalMinutes / 10));
  }

  if (frame < 0) return null;
  return formatTimecode(frame, timebase) === normalise(trimmed, drop) ? frame : null;
}

/** Whether text is *shaped* like a timecode, separator and all — for a field
 *  that wants to say "keep typing" without claiming the frame exists yet. */
export function isTimecodeShaped(text: string): boolean {
  return /^\d{1,2}:\d{1,2}:\d{1,2}[:;.]\d{1,3}$/.test(text.trim());
}

/** How long a stretch is, as timecode. Zero-based and never negative: a
 *  duration is a length, not a position. */
export function formatDurationTimecode(frames: number, timebase: Timebase): string {
  return formatTimecode(Math.max(0, Math.floor(frames)), timebase);
}

/** The same string a formatter would have written, so a comparison is not at
 *  the mercy of how the user separated the parts. `.` is accepted for a
 *  timecode typed on a numeric keypad, where `.` is next to the digits and `:`
 *  is not. */
function normalise(text: string, dropFrame: boolean): string {
  const separator = dropFrame ? ';' : ':';
  const match = /^(\d{1,2}):(\d{1,2}):(\d{1,2})([:;.])(\d{1,3})$/.exec(text);
  if (match === null) return text;
  return `${pad(Number(match[1]))}:${pad(Number(match[2]))}:${pad(Number(match[3]))}${separator}${pad(Number(match[5]))}`;
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}
