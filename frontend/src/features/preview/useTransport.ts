/** The transport: the playhead, and the six ways a user moves it.
 *
 *  This is the view-model the preview panel and the keyboard both drive, and it
 *  exists because **clamping needs two stores and neither should hold both**.
 *  The playhead lives in the playback slice; how long the project is lives in the
 *  timeline slice. A playback store that imported the timeline store to clamp a
 *  number would be two slices wearing one hat, and a component that clamped
 *  without asking would be a place where "past the end" means two different
 *  things.
 *
 *  What it decides:
 *
 *  * **The playhead stops at the last frame, and never goes below zero.** The
 *    last frame of a 300-frame project is 299; a transport that let you seek to
 *    300 would be showing a frame that does not exist and an edit that applies
 *    to nothing.
 *  * **A seek while playing restarts the clock from where you landed.** Not
 *    "continues from where it was", which is a playhead that jumps back.
 *  * **Stepping past the end stops playback.** A user who holds the right arrow
 *    at the end of a project is telling you they have arrived, not asking for
 *    the transport to keep a playhead off the end of the timeline.
 */

import { useCallback, useMemo, useState } from 'react';

import { usePlaybackStore, usePlaybackStoreApi, type PreviewZoom } from '../../stores/playback';
import { useDurationFrames } from '../../stores/timeline';
import type { Timebase } from '../../core/timecode/timebase';
import { usePlaybackClock } from './usePlaybackClock';

export interface Transport {
  /** The frame on screen. */
  readonly frame: number;
  readonly playing: boolean;
  readonly rate: number;
  readonly loop: boolean;
  readonly zoom: PreviewZoom;
  /** How long the project is, in frames. `0` before the edit has been read. */
  readonly durationFrames: number;
  /** The last frame there is to show: one before the end, or `0`. */
  readonly lastFrame: number;

  /** Put the playhead on a frame, clamped to the project. */
  readonly seek: (frame: number) => void;
  /** Move by a whole number of frames, clamped. */
  readonly step: (delta: number) => void;
  readonly toStart: () => void;
  readonly toEnd: () => void;
  readonly play: () => void;
  readonly pause: () => void;
  readonly togglePlay: () => void;
  readonly setRate: (rate: number) => void;
  readonly setLoop: (loop: boolean) => void;
  readonly setZoom: (zoom: PreviewZoom) => void;
}

export function useTransport(timebase: Timebase): Transport {
  const store = usePlaybackStoreApi();
  const frame = usePlaybackStore((state) => state.frame);
  const playing = usePlaybackStore((state) => state.playing);
  const rate = usePlaybackStore((state) => state.rate);
  const loop = usePlaybackStore((state) => state.loop);
  const zoom = usePlaybackStore((state) => state.zoom);
  const durationFrames = useDurationFrames();

  // Where the clock started counting. Held in state rather than read from the
  // playhead, because the playhead changes on every tick and a clock that
  // restarted on every tick would never advance past its first frame.
  const [startedFrom, setStartedFrom] = useState(0);

  const lastFrame = Math.max(0, durationFrames - 1);

  const clamp = useCallback(
    (candidate: number): number => {
      const at = Number.isFinite(candidate) ? Math.floor(candidate) : 0;
      if (at < 0) return 0;
      // An empty project has no last frame to clamp to; any other has exactly
      // `durationFrames - 1`, and frame `durationFrames` does not exist.
      return durationFrames > 0 ? Math.min(at, lastFrame) : at;
    },
    [durationFrames, lastFrame],
  );

  const seek = useCallback(
    (candidate: number) => {
      const at = clamp(candidate);
      store.getState().seek(at);
      if (store.getState().playing) setStartedFrom(at);
    },
    [clamp, store],
  );

  const step = useCallback(
    (delta: number) => {
      const at = clamp(store.getState().frame + delta);
      store.getState().seek(at);
      // Stepped onto the end: arriving is not the same as playing off it.
      if (store.getState().playing && at === lastFrame && delta > 0) store.getState().pause();
      else if (store.getState().playing) setStartedFrom(at);
    },
    [clamp, lastFrame, store],
  );

  const pause = useCallback(() => {
    store.getState().pause();
  }, [store]);

  const play = useCallback(() => {
    const at = clamp(store.getState().frame);
    store.getState().seek(at);
    setStartedFrom(at);
    store.getState().play();
  }, [clamp, store]);

  const togglePlay = useCallback(() => {
    if (store.getState().playing) {
      pause();
      return;
    }
    play();
  }, [pause, play, store]);

  usePlaybackClock({
    playing,
    timebase,
    fromFrame: startedFrom,
    durationFrames,
    rate,
    loop,
    onFrame: (next) => {
      store.getState().advance(clamp(next));
    },
    onEnded: pause,
  });

  return useMemo(
    () => ({
      frame,
      playing,
      rate,
      loop,
      zoom,
      durationFrames,
      lastFrame,
      seek,
      step,
      toStart: () => {
        seek(0);
      },
      toEnd: () => {
        seek(lastFrame);
      },
      play,
      pause,
      togglePlay,
      setRate: (next: number) => {
        store.getState().setRate(next);
      },
      setLoop: (next: boolean) => {
        store.getState().setLoop(next);
      },
      setZoom: (next: PreviewZoom) => {
        store.getState().setZoom(next);
      },
    }),
    [
      durationFrames,
      frame,
      lastFrame,
      loop,
      pause,
      playing,
      play,
      rate,
      seek,
      step,
      store,
      togglePlay,
      zoom,
    ],
  );
}
