/** A length of media, as a person reads it.
 *
 *  Seconds as `m:ss`, which is all a bin row needs: a frame-accurate timecode
 *  belongs on the timeline (stage 7), and reading `01:04:12:07` in a list of
 *  four hundred is slower than reading `64:12`.
 */

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    // A file that reported no length is not "zero seconds long".
    return '\u2014';
  }
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}
