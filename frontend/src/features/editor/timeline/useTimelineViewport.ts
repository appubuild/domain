/** The timeline's viewport: how wide a frame is, and which frames are on screen.
 *
 *  This is **window state, not edit state**. It is not in a store, it is not
 *  journalled, and it is not sent anywhere, because where the user has scrolled
 *  to is not part of the edit — a timeline that remembered its zoom and put it
 *  in the project file would be a timeline that opens on the wrong part of
 *  somebody else's screen. It lives here, in the pane that owns it, and dies
 *  with it.
 *
 *  Three decisions:
 *
 *  * **Fit is a mode, not a number.** Zooming to fit and then resizing the
 *    window keeps the whole project on screen; a `fit` that was a one-off
 *    calculation would have to be re-run by the user every time they dragged a
 *    splitter. The first paint is `fit` too, because a timeline opened at some
 *    arbitrary zoom looks empty when the project is short and endless when it is
 *    long.
 *  * **A zoom keeps what it was aimed at.** Ctrl+= holds the playhead still; a
 *    Ctrl+= that re-centred the project would have the user hunting for the
 *    frame they were cutting. The anchor is a pixel, so one call serves the
 *    playhead, the pointer, and the middle of the screen.
 *  * **The scroll is clamped when read, not only when written.** An edit that
 *    shortens the project can leave the viewport parked past its end; clamping
 *    on write alone would leave a blank timeline until the next scroll.
 */

import { useCallback, useMemo, useState } from 'react';

import { useDurationFrames, useTimebase } from '../../../stores/timeline';
import { useElementSize } from '../../../ui/useElementSize';
import {
  GUTTER_WIDTH,
  MAX_PX_PER_FRAME,
  MIN_PX_PER_FRAME,
  clampScroll,
  clampScrollTop,
  clampZoom,
  fitPxPerFrame,
  scrollForZoom,
  scrollFrameIntoView,
  xToFrame,
  zoomStep,
  type TimelineLayout,
} from './layout';

/** A zoom: a rung on the ladder, or `fit`, which is a promise to keep the whole
 *  project on screen whatever the window does. */
export type TimelineZoom = number | 'fit';

export interface TimelineViewport {
  /** Put on the element that *is* the viewport — the element whose width the
   *  tracks scroll inside. From `useElementSize`, so dragging a splitter
   *  re-measures instead of the pane keeping the number it was born with. */
  readonly ref: (element: HTMLDivElement | null) => void;
  /** Everything a painter or a hit test needs, with the scroll already clamped. */
  readonly layout: TimelineLayout;
  /** Pixels per frame, as drawn. */
  readonly zoom: number;
  readonly canZoomIn: boolean;
  readonly canZoomOut: boolean;

  readonly zoomIn: (anchorFrame?: number) => void;
  readonly zoomOut: (anchorFrame?: number) => void;
  /** Zoom to a rung. Asked for something between two rungs, takes the one in
   *  the direction of the zoom. */
  readonly zoomTo: (pxPerFrame: number, anchorFrame?: number) => void;
  readonly fit: () => void;

  readonly scrollByFrames: (delta: number) => void;
  readonly scrollToFrame: (frame: number) => void;
  /** How far the rows are scrolled down, in pixels. Zero until there are more
   *  of them than fit. */
  readonly scrollTop: number;
  readonly scrollByPixels: (delta: number) => void;
  /** Bring a frame into view, and leave the scroll alone when it already is.
   *  What following the playhead calls, so a playing timeline does not scroll
   *  on every frame. */
  readonly revealFrame: (frame: number) => void;
}

export interface ViewportOptions {
  /** How many rows the layout must make room for. */
  readonly trackCount: number;
}

export function useTimelineViewport({ trackCount }: ViewportOptions): TimelineViewport {
  const timebase = useTimebase();
  const durationFrames = useDurationFrames();
  const { ref, size } = useElementSize<HTMLDivElement>();

  const [mode, setMode] = useState<TimelineZoom>('fit');
  const [scrollFrames, setScrollFrames] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);

  const { width, height } = size;

  const zoom = useMemo(
    () => (mode === 'fit' ? fitPxPerFrame(durationFrames, width) : clampZoom(mode)),
    [mode, durationFrames, width],
  );

  const layout = useMemo<TimelineLayout>(() => {
    const at: TimelineLayout = {
      width,
      height,
      pxPerFrame: zoom,
      scrollFrames: 0,
      trackCount,
      timebase,
      durationFrames,
    };
    return { ...at, scrollFrames: clampScroll(at, scrollFrames) };
  }, [width, height, zoom, trackCount, timebase, durationFrames, scrollFrames]);

  /** Where a zoom holds still: the frame given, or the one under the middle of
   *  the viewport when the caller has no preference. */
  const anchorAt = useCallback(
    (frame: number | undefined): { frame: number; pixel: number } => {
      const pixel = GUTTER_WIDTH + Math.max(0, width - GUTTER_WIDTH) / 2;
      return { frame: frame ?? xToFrame(layout, pixel), pixel };
    },
    [layout, width],
  );

  const zoomTo = useCallback(
    (pxPerFrame: number, anchorFrame?: number) => {
      const anchor = anchorAt(anchorFrame);
      setMode(clampZoom(pxPerFrame));
      setScrollFrames(scrollForZoom(layout, pxPerFrame, anchor.frame, anchor.pixel));
    },
    [anchorAt, layout],
  );

  const zoomIn = useCallback(
    (anchorFrame?: number) => {
      const anchor = anchorAt(anchorFrame);
      const next = zoomStep(zoom, 1);
      setMode(next);
      setScrollFrames(scrollForZoom(layout, next, anchor.frame, anchor.pixel));
    },
    [anchorAt, layout, zoom],
  );

  const zoomOut = useCallback(
    (anchorFrame?: number) => {
      const anchor = anchorAt(anchorFrame);
      const next = zoomStep(zoom, -1);
      setMode(next);
      setScrollFrames(scrollForZoom(layout, next, anchor.frame, anchor.pixel));
    },
    [anchorAt, layout, zoom],
  );

  const scrollByPixels = useCallback(
    (delta: number) => {
      setScrollTop((current) => clampScrollTop(layout, current + delta));
    },
    [layout],
  );

  const fit = useCallback(() => {
    // Back to zero as well as back to `fit`: a fitted timeline scrolled to
    // anywhere but its beginning is not fitted.
    setMode('fit');
    setScrollFrames(0);
  }, []);

  const scrollByFrames = useCallback(
    (delta: number) => {
      setScrollFrames((current) => clampScroll(layout, current + delta));
    },
    [layout],
  );

  const scrollToFrame = useCallback(
    (frame: number) => {
      setScrollFrames(clampScroll(layout, frame));
    },
    [layout],
  );

  const revealFrame = useCallback(
    (frame: number) => {
      setScrollFrames((current) =>
        scrollFrameIntoView({ ...layout, scrollFrames: current }, frame),
      );
    },
    [layout],
  );

  return {
    ref,
    layout,
    zoom,
    canZoomIn: zoom < MAX_PX_PER_FRAME,
    canZoomOut: zoom > MIN_PX_PER_FRAME,
    zoomIn,
    zoomOut,
    zoomTo,
    fit,
    scrollByFrames,
    scrollToFrame,
    scrollTop: clampScrollTop(layout, scrollTop),
    scrollByPixels,
    revealFrame,
  };
}
