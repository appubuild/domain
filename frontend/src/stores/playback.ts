/** The playback slice: where the playhead is, and what the transport is doing.
 *
 *  Four fields and the rules that keep them honest:
 *
 *  * **The playhead is a whole number of frames.** Always. A playhead at frame
 *    12.4 is not a thing that exists — the frame is the atom of an edit, and a
 *    UI that could park between two of them could not tell you which one is on
 *    screen. `seek` floors and clamps at zero.
 *  * **The end of the timeline is not this store's to know.** Clamping to the
 *    duration belongs to whoever *has* the duration (the transport view-model,
 *    which reads the timeline slice). A store that imported the timeline slice
 *    to clamp a number would be two stores wearing one hat.
 *  * **`playing` is an intent, not a measurement.** It says the user asked for
 *    playback; it does not promise frames are arriving at that rate — that is
 *    the decoder's business, and stage 8 is where audio makes the promise real.
 *    A store that claimed otherwise would have to lie about a slow project.
 *  * **Zoom is display, and lives here rather than in the preview panel,**
 *    because it is one number the transport buttons, the frame request and the
 *    pane's status line all read — and a panel that kept its own would disagree
 *    with the button that set it.
 *
 *  The clock is deliberately **not** in this module: a store is state, and a
 *  `requestAnimationFrame` loop is a side effect that belongs to a hook (see
 *  `features/preview/usePlaybackClock.ts`).
 */

import { createContext, useContext } from 'react';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

/** How the picture is scaled: `fit` measures the panel, a number is a
 *  deliberate multiplier on that fit (§10.7 render: the service never scales
 *  up, so `2` asks for a bigger window onto the same pixels). */
export type PreviewZoom = number | 'fit';

export interface PlaybackState {
  /** The frame on screen, and the frame an edit would apply to. */
  readonly frame: number;
  /** Whether the user has asked for playback. */
  readonly playing: boolean;
  /** 1 is real time. Half and double are the useful ends of it; the sign is
   *  never negative because a project that plays backwards is a scrub. */
  readonly rate: number;
  readonly loop: boolean;
  readonly zoom: PreviewZoom;

  /** Put the playhead on a frame. Floored, and never below zero. */
  readonly seek: (frame: number) => void;
  /** Move the playhead by a whole number of frames, never below zero. */
  readonly step: (delta: number) => void;
  /** Written by the clock on every tick, and by nobody else. */
  readonly advance: (frame: number) => void;
  readonly play: () => void;
  readonly pause: () => void;
  readonly toggle: () => void;
  /** Stop: pause and go back to the start. What "stop" has meant since 1963. */
  readonly stop: () => void;
  readonly setRate: (rate: number) => void;
  readonly setLoop: (loop: boolean) => void;
  readonly setZoom: (zoom: PreviewZoom) => void;
}

export type PlaybackStore = StoreApi<PlaybackState>;

export function createPlaybackStore(): PlaybackStore {
  return createStore<PlaybackState>()((set, get) => ({
    frame: 0,
    playing: false,
    rate: 1,
    loop: false,
    zoom: 'fit',

    seek(frame) {
      // A frame is an integer: a playhead between two frames is a playhead that
      // cannot say which one is showing.
      const at = Number.isFinite(frame) ? Math.max(0, Math.floor(frame)) : 0;
      if (at !== get().frame) set({ frame: at });
    },

    step(delta) {
      get().seek(get().frame + delta);
    },

    advance(frame) {
      // The clock's write, and the clock is the only caller: it has already
      // decided what looping means, so this one just floors and clamps.
      const at = Number.isFinite(frame) ? Math.max(0, Math.floor(frame)) : 0;
      if (at !== get().frame) set({ frame: at });
    },

    play() {
      set({ playing: true });
    },

    pause() {
      set({ playing: false });
    },

    toggle() {
      set({ playing: !get().playing });
    },

    stop() {
      set({ playing: false, frame: 0 });
    },

    setRate(rate) {
      set({ rate: rate > 0 ? rate : 1 });
    },

    setLoop(loop) {
      set({ loop });
    },

    setZoom(zoom) {
      set({ zoom });
    },
  }));
}

// -- the tree's view of it ---------------------------------------------------

export const PlaybackStoreContext = createContext<PlaybackStore | undefined>(undefined);

function usePlaybackStoreInContext(): PlaybackStore {
  const store = useContext(PlaybackStoreContext);
  if (!store) {
    throw new Error(
      'no playback store in context — wrap this tree in <PlaybackStoreContext.Provider>',
    );
  }
  return store;
}

export function usePlaybackStore<T>(selector: (state: PlaybackState) => T): T {
  return useStore(usePlaybackStoreInContext(), selector);
}

export function usePlaybackStoreApi(): PlaybackStore {
  return usePlaybackStoreInContext();
}
