/** The playhead, as a field a professional can type into.
 *
 *  An editor's most-used control is not a button, it is "go to 01:23:45:12",
 *  and that is a text field with rules. Four of them:
 *
 *  * **The text is the user's while they are typing.** A field that reformatted
 *    on every keystroke would move the caret and eat the next digit, so what is
 *    shown is what was typed until the field is committed or abandoned.
 *  * **Commit is Enter or leaving the field; Escape abandons.** No seeking on
 *    every keystroke: a half-typed `00:0` is not a request to go to frame zero.
 *  * **A timecode that does not exist is refused, not snapped.** At 29.97 the
 *    counter skips `00:01:00;00`, and a field that quietly moved the playhead
 *    to the nearest real frame would be a field that goes somewhere the user
 *    did not ask for. It says so instead (§`timecode.parseTimecode`).
 *  * **Follows the playhead when it is not being edited.** Scrub the timeline
 *    and the number tracks it; start typing and it stops, or the user would be
 *    fighting the transport for the caret.
 */

import { useEffect, useRef, useState } from 'react';

import { formatTimecode, parseTimecode } from '../../core/timecode/timecode';
import type { Timebase } from '../../core/timecode/timebase';
import { TextField } from '../../ui/TextField';

export interface TimecodeFieldProps {
  /** The frame to show when the field is not being edited. */
  readonly frame: number;
  readonly timebase: Timebase;
  readonly label: string;
  /** A frame the user committed. Not called for a frame that does not exist. */
  readonly onSeek: (frame: number) => void;
  readonly hint?: string;
  /** "That is not a timecode", already translated. */
  readonly invalidMessage: string;
  readonly disabled?: boolean;
}

export function TimecodeField({
  frame,
  timebase,
  label,
  onSeek,
  hint,
  invalidMessage,
  disabled = false,
}: TimecodeFieldProps): React.JSX.Element {
  const written = formatTimecode(frame, timebase);
  const [text, setText] = useState(written);
  const [error, setError] = useState<string | null>(null);
  const editing = useRef(false);

  // Follow the playhead — but only while the user is not in the middle of
  // typing, or a scrub would overwrite what they have half written.
  useEffect(() => {
    if (!editing.current) {
      setText(written);
      setError(null);
    }
  }, [written]);

  function commit(): void {
    editing.current = false;
    const parsed = parseTimecode(text, timebase);
    if (parsed === null) {
      // Kept as typed: throwing the user's text away because one digit was
      // wrong means retyping all twelve.
      setError(invalidMessage);
      return;
    }
    setError(null);
    setText(formatTimecode(parsed, timebase));
    onSeek(parsed);
  }

  return (
    <TextField
      label={label}
      value={text}
      // Spread rather than passed: `exactOptionalPropertyTypes` is on, and a
      // prop given as `undefined` is not the same thing as a prop not given.
      {...(hint === undefined ? {} : { hint })}
      {...(error === null ? {} : { error })}
      disabled={disabled}
      inputMode="numeric"
      autoComplete="off"
      spellCheck={false}
      aria-invalid={error !== null || undefined}
      // Monospaced, because a timecode is read by shape: the digits must not
      // move as they change, the way a proportional `1` would make them.
      className="w-[9.5rem] font-mono tabular-nums"
      onValueChange={(next) => {
        editing.current = true;
        setText(next);
        if (error !== null) setError(null);
      }}
      onFocus={() => {
        editing.current = true;
      }}
      onBlur={() => {
        commit();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
          return;
        }
        if (event.key === 'Escape') {
          // Abandon: put back the frame that is actually on screen.
          editing.current = false;
          setText(written);
          setError(null);
        }
      }}
    />
  );
}
