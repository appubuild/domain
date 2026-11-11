/** The clock that moves the playhead while the transport is playing.
 *
 *  Playback is **wall-clock time measured in frames**: on each animation frame
 *  the clock works out how many frames of the project have elapsed since it
 *  started and puts the playhead there. It is the only honest definition — a
 *  timer that ticked once per frame at `1000 / fps` milliseconds would drift a
 *  frame every few seconds, and at 29.97 it would drift a frame every second.
 *
 *  What it deliberately does **not** do is promise real-time playback. Whether
 *  the picture keeps up is the decoder's business: if frames take 40 ms to
 *  composite, the playhead keeps time and the picture follows as fast as it can,
 *  which is what every editor does and what a preview is for. The promise that
 *  frames arrive on the beat — with audio, and with a schedule — is the render
 *  engine's to make (stage 8), and a hook that pretended otherwise would be a
 *  hook that lies about a slow project.
 *
 *  At the end of the timeline the clock stops, or loops back to zero when the
 *  user asked it to. It never runs past the end: a playhead at frame 9,000 of a
 *  9,000-frame project is a playhead on a frame that does not exist.
 */

import { useEffect, useMemo, useRef } from 'react';

import { secondsToFrames, type Timebase } from '../../core/timecode/timebase';

export interface PlaybackClockOptions {
  readonly playing: boolean;
  readonly timebase: Timebase;
  /** Where the playhead was when playback started, in frames. */
  readonly fromFrame: number;
  /** How long the project is. The clock stops here, or loops. */
  readonly durationFrames: number;
  readonly rate: number;
  readonly loop: boolean;
  /** Where to put the playhead, every tick. */
  readonly onFrame: (frame: number) => void;
  /** Called once, when the playhead reaches the end and is not looping. */
  readonly onEnded?: () => void;
}

/** A monotonic clock, so a user who changes the system clock mid-playback does
 *  not jump the playhead. `performance.now` is the platform's; a test injects
 *  its own through `now`. */
export type Now = () => number;

export function usePlaybackClock(options: PlaybackClockOptions & { readonly now?: Now }): void {
  const { playing, timebase, fromFrame, durationFrames, rate, loop, onFrame, onEnded } = options;

  // The rate as two numbers, memoised: a caller that builds `{ num, den }` in
  // its render would otherwise restart the clock on every render, which is a
  // clock that never gets past its first tick.
  const frames = useMemo(
    () => ({ num: timebase.num, den: timebase.den }),
    [timebase.num, timebase.den],
  );

  // Handlers are held rather than depended upon: a callback recreated on every
  // render would restart the loop on every render, and a clock that restarts
  // never gets past its first tick.
  const latest = useRef({ onFrame, onEnded });
  latest.current = { onFrame, onEnded };

  useEffect(() => {
    if (!playing) return;

    const now = options.now ?? (() => performance.now());
    const startedAt = now();
    const startedFrom = fromFrame;
    let handle = 0;
    let ended = false;

    const tick = (): void => {
      const elapsedSeconds = ((now() - startedAt) / 1000) * rate;
      const reached = startedFrom + secondsToFrames(elapsedSeconds, frames);

      if (durationFrames > 0 && reached >= durationFrames - 1) {
        if (loop) {
          // Wrap on the same wall clock rather than restarting it: a loop that
          // restarted the timer would lose the remainder each time round, and a
          // ten-minute loop would end up measurably short of ten minutes.
          const length = Math.max(1, durationFrames);
          const wrapped = startedFrom + ((reached - startedFrom) % length);
          latest.current.onFrame(wrapped);
          handle = requestAnimationFrame(tick);
          return;
        }
        if (!ended) {
          ended = true;
          latest.current.onFrame(Math.max(0, durationFrames - 1));
          latest.current.onEnded?.();
        }
        return;
      }

      latest.current.onFrame(reached);
      handle = requestAnimationFrame(tick);
    };

    handle = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(handle);
    };
    // `fromFrame` is a dependency, and safely so: it is the playhead at the
    // moment playback *started* — set by `play`, and by a seek made while
    // playing — and not the playhead as it is now. A clock that was handed the
    // live frame and depended on it would restart on its own tick, which is a
    // clock that never advances.
  }, [playing, fromFrame, frames, durationFrames, rate, loop, options.now]);
}
