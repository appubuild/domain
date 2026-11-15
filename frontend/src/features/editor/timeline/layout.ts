/** Where everything on the timeline is drawn, and what a pixel means.
 *
 *  **Pure.** No React, no store, no canvas — numbers in, numbers out. That is
 *  what makes the two things a timeline gets wrong testable: the mapping between
 *  frames and pixels, and the answer to "what did the user just click on".
 *
 *  Three decisions are worth naming:
 *
 *  * **A frame is an integer, a pixel is not.** `xToFrame` rounds to the
 *    *nearest* frame for a click and floors for a scroll offset, because those
 *    are different questions: clicking between two frames means the nearer one
 *    (a user aiming at a boundary expects to hit it), while the left edge of the
 *    viewport is the frame it is showing the whole of.
 *  * **Nothing derived is stored.** `trackTop`, `contentHeight` and the visible
 *    range are functions of the layout, not fields on it, because a field is a
 *    second copy that can disagree after the tracks change.
 *  * **Hit-testing lives with the geometry.** "Is this pixel the edge of a clip"
 *    is a question about where the clip was drawn, and a second module that
 *    re-derived the rectangle would be a second place the grab width is defined.
 */

import type { ClipSummary, TrackSummary } from '../../../core/api/contract';
import type { Timebase } from '../../../core/timecode/timebase';

/** The ruler band at the top: the only part of the canvas that is not a track. */
export const RULER_HEIGHT = 26;

/** One track. Tall enough for a name and a thumbnail strip, short enough that
 *  eight of them fit without scrolling — a timeline you have to scroll
 *  vertically is a timeline you cannot see. */
export const TRACK_HEIGHT = 54;

/** The hairline between two tracks. Not zero: two clips that touch must read as
 *  two clips. */
export const TRACK_GAP = 2;

/** The left gutter: track names, mute and lock. Outside the scrolled area,
 *  because a name that scrolled away is a name that stopped identifying. */
export const GUTTER_WIDTH = 128;

/** How close to an end of a clip the pointer must be to trim rather than move.
 *  Six pixels, which is the width a thumb can find without a magnifier and the
 *  width that still leaves the middle of a one-second clip grabbable. */
export const EDGE_GRAB_PX = 6;

/** The zoom ladder, in pixels per frame. A ladder and not a multiplier, for the
 *  same reason the preview's is: `1.37 px/frame` is not a thing a user can ask
 *  for again, and Ctrl+= and the menu would otherwise disagree about where they
 *  are. Ends are a whole project in one screen and one frame under four
 *  hundred pixels. */
export const ZOOM_LEVELS: readonly number[] = [
  0.02, 0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32,
];

export const MIN_PX_PER_FRAME: number = ZOOM_LEVELS[0] ?? 0.02;
export const MAX_PX_PER_FRAME: number = ZOOM_LEVELS[ZOOM_LEVELS.length - 1] ?? 32;

/** Everything the canvas needs to know to place one pixel. */
export interface TimelineLayout {
  /** Canvas width in CSS pixels. */
  readonly width: number;
  /** Canvas height in CSS pixels. */
  readonly height: number;
  /** Zoom: how wide one frame is drawn. */
  readonly pxPerFrame: number;
  /** The frame at the left edge of the scrolled area. */
  readonly scrollFrames: number;
  readonly trackCount: number;
  readonly timebase: Timebase;
  /** How long the project is. Content width comes from this, not from the last
   *  clip: a timeline whose content ended at its last clip would have nowhere
   *  to drop a new one. */
  readonly durationFrames: number;
}

/** A rectangle in CSS pixels. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** What a pointer landed on. */
export type TimelineHit =
  /** The ruler: clicking it scrubs. */
  | { readonly kind: 'ruler' }
  /** A track's name and controls, in the gutter. */
  | { readonly kind: 'gutter'; readonly trackIndex: number }
  /** A clip. `edge` is set when the pointer is on an end of it, which is the
   *  difference between a move and a trim. */
  | {
      readonly kind: 'clip';
      readonly clipId: string;
      readonly trackIndex: number;
      readonly edge: 'start' | 'end' | null;
    }
  /** Empty space on a track: clicking it deselects and seeks. */
  | { readonly kind: 'track'; readonly trackIndex: number }
  /** Below the tracks, or off the right of the content. */
  | { readonly kind: 'empty' };

// -- the mapping -------------------------------------------------------------

/** The x of a frame, in canvas pixels. */
export function frameToX(layout: TimelineLayout, frame: number): number {
  return GUTTER_WIDTH + (frame - layout.scrollFrames) * layout.pxPerFrame;
}

/** The frame under an x, to the nearest whole frame.
 *
 *  Nearest and not floored: a user aiming at the boundary between two frames
 *  expects the nearer one, and flooring would make every click land a frame
 *  early for the right half of every pixel. */
export function xToFrame(layout: TimelineLayout, x: number): number {
  const frames = layout.scrollFrames + (x - GUTTER_WIDTH) / layout.pxPerFrame;
  return Math.max(0, Math.round(frames));
}

// -- painting ----------------------------------------------------------------

/** Where a frame sits **in the content**, before the scroll is applied.
 *
 *  Painting and hit testing are different sums, and mixing them is the bug where
 *  a timeline looks right until it is scrolled. A clip is painted at its
 *  position in the content and the whole content is then moved by one
 *  transform; a click is measured against the *viewport*, scroll and all. So
 *  this is the painting half, `frameToX` is the measuring half, and the
 *  difference between them is exactly `contentOffsetX`.
 */
export function contentX(layout: TimelineLayout, frame: number): number {
  return GUTTER_WIDTH + frame * layout.pxPerFrame;
}

/** How far the content is moved to put `scrollFrames` at the left edge.
 *
 *  One transform for the whole content rather than a position per clip: a
 *  scroll then costs the browser one composited layer instead of a layout pass
 *  over every clip on the screen.
 */
export function contentOffsetX(layout: TimelineLayout): number {
  // Negated the long way round so the answer is `0` and not `-0`: a transform
  // of `-0px` is the same transform, but a test that compares offsets is not
  // the only reader, and a negative zero in a diff is a reader's distraction.
  return -(layout.scrollFrames * layout.pxPerFrame) || 0;
}

/** The top of a track's row, in canvas pixels. */
export function trackTop(trackIndex: number): number {
  return RULER_HEIGHT + trackIndex * (TRACK_HEIGHT + TRACK_GAP);
}

/** How wide the content is, gutter included. */
export function contentWidth(layout: TimelineLayout): number {
  return GUTTER_WIDTH + Math.max(layout.durationFrames, 0) * layout.pxPerFrame;
}

/** The frames the viewport is showing, as a half-open range.
 *
 *  Widened by one frame at each end: a clip that starts just off the left edge
 *  is partly on screen, and a painter that asked for exactly the visible range
 *  would clip it. */
export function visibleRange(layout: TimelineLayout): {
  readonly firstFrame: number;
  readonly lastFrame: number;
} {
  const viewWidth = Math.max(0, layout.width - GUTTER_WIDTH);
  const firstFrame = Math.max(0, Math.floor(layout.scrollFrames));
  const lastFrame = Math.ceil(layout.scrollFrames + viewWidth / layout.pxPerFrame) + 1;
  return { firstFrame, lastFrame };
}

// -- the rows ----------------------------------------------------------------

/** Which row a y belongs to, or `null` below the tracks. */
export function rowAt(layout: TimelineLayout, y: number): number | null {
  if (y < RULER_HEIGHT) return null;
  const index = Math.floor((y - RULER_HEIGHT) / (TRACK_HEIGHT + TRACK_GAP));
  if (index < 0 || index >= layout.trackCount) return null;
  // Inside the gap between two tracks: not a row, and a clip dropped there has
  // nowhere to go.
  const within = y - trackTop(index);
  return within <= TRACK_HEIGHT ? index : null;
}

/** One clip's rectangle. Never narrower than two pixels: a clip a tenth of a
 *  pixel wide is still a clip the user has to be able to hit. */
export function clipRect(layout: TimelineLayout, trackIndex: number, clip: ClipSummary): Rect {
  const left = frameToX(layout, clip.start_frame);
  const right = frameToX(layout, clip.end_frame);
  return {
    x: left,
    y: trackTop(trackIndex),
    width: Math.max(2, right - left),
    height: TRACK_HEIGHT,
  };
}

// -- hit testing -------------------------------------------------------------

/** What is under this pixel. */
export function hitTest(
  layout: TimelineLayout,
  tracks: readonly TrackSummary[],
  x: number,
  y: number,
): TimelineHit {
  if (y >= 0 && y < RULER_HEIGHT) return { kind: 'ruler' };
  if (x >= 0 && x < GUTTER_WIDTH) {
    const trackIndex = rowAt(layout, y);
    return trackIndex === null ? { kind: 'empty' } : { kind: 'gutter', trackIndex };
  }
  const trackIndex = rowAt(layout, y);
  if (trackIndex === null) return { kind: 'empty' };

  const track = tracks[trackIndex];
  if (track === undefined) return { kind: 'track', trackIndex };

  // Nearest first, so a click where two clips abut picks the one on top of the
  // pixel rather than the one earlier in the list.
  for (const clip of track.clips) {
    const rect = clipRect(layout, trackIndex, clip);
    if (x < rect.x || x > rect.x + rect.width) continue;
    const fromStart = x - rect.x;
    const fromEnd = rect.x + rect.width - x;
    if (fromStart <= EDGE_GRAB_PX && fromStart <= fromEnd) {
      return { kind: 'clip', clipId: clip.clip_id, trackIndex, edge: 'start' };
    }
    if (fromEnd <= EDGE_GRAB_PX) {
      return { kind: 'clip', clipId: clip.clip_id, trackIndex, edge: 'end' };
    }
    return { kind: 'clip', clipId: clip.clip_id, trackIndex, edge: null };
  }
  return { kind: 'track', trackIndex };
}

// -- zoom and scroll ---------------------------------------------------------

/** The zoom that fits a project into a viewport, rounded onto the ladder.
 *
 *  A little headroom past the end, because a timeline that ended exactly at the
 *  right edge gives the user nowhere to park the playhead after the last clip.
 */
export function fitPxPerFrame(durationFrames: number, viewportWidth: number): number {
  const usable = Math.max(1, viewportWidth - GUTTER_WIDTH);
  const wanted = usable / Math.max(durationFrames + 24, 24);
  return clampZoom(wanted);
}

/** One step along the ladder, staying on it. */
export function zoomStep(current: number, direction: 1 | -1): number {
  const index = ZOOM_LEVELS.indexOf(current);
  if (index === -1) {
    // Not on the ladder (a zoom restored from a saved layout): step to the
    // nearest rung in the direction asked for, rather than snapping, which
    // would move the zoom backwards when the user asked for forwards.
    const above = ZOOM_LEVELS.findIndex((level) => level > current);
    const target = direction === 1 ? above : above - 1;
    return ZOOM_LEVELS[Math.min(Math.max(target, 0), ZOOM_LEVELS.length - 1)] ?? current;
  }
  const next = ZOOM_LEVELS[Math.min(Math.max(index + direction, 0), ZOOM_LEVELS.length - 1)];
  return next ?? current;
}

/** Any zoom to a rung on the ladder. */
export function clampZoom(pxPerFrame: number): number {
  if (!Number.isFinite(pxPerFrame) || pxPerFrame <= MIN_PX_PER_FRAME) return MIN_PX_PER_FRAME;
  if (pxPerFrame >= MAX_PX_PER_FRAME) return MAX_PX_PER_FRAME;
  // The nearest rung *below*, so fitting a project always shows all of it
  // rather than almost all of it.
  let chosen = MIN_PX_PER_FRAME;
  for (const level of ZOOM_LEVELS) {
    if (level <= pxPerFrame) chosen = level;
    else break;
  }
  return chosen;
}

/** Where the scroll must be, after a zoom, for `anchorFrame` to stay under
 *  `anchorPx`.
 *
 *  Zooming without an anchor is the one thing everybody notices: whatever you
 *  were looking at slides off the screen, and zooming back does not bring it
 *  back. The anchor is a pixel rather than the playhead or the centre because
 *  all three are the same calculation — Ctrl+= keeps the playhead put, a pinch
 *  keeps the finger put, and a menu command keeps the middle put.
 *
 *  Called with the *wanted* zoom rather than a rung, so a caller may ask for
 *  `pxPerFrame * 1.2` and get the nearest rung's answer.
 */
export function scrollForZoom(
  at: TimelineLayout,
  pxPerFrame: number,
  anchorFrame: number,
  anchorPx: number,
): number {
  const zoom = clampZoom(pxPerFrame);
  const insideViewport = anchorPx - GUTTER_WIDTH;
  const wanted = anchorFrame - insideViewport / zoom;
  return clampScroll({ ...at, pxPerFrame: zoom }, wanted);
}

/** How far right the content may be scrolled. Never negative: a project
 *  narrower than its viewport has nowhere to scroll to. */
export function maxScrollFrames(layout: TimelineLayout): number {
  const viewWidth = Math.max(0, layout.width - GUTTER_WIDTH);
  const span = Math.max(layout.durationFrames, 0) * layout.pxPerFrame;
  return Math.max(0, Math.ceil(span - viewWidth + 8 / layout.pxPerFrame));
}

/** A scroll offset that keeps the content on screen. */
export function clampScroll(layout: TimelineLayout, scrollFrames: number): number {
  return Math.min(Math.max(0, scrollFrames), maxScrollFrames(layout));
}

/** A scroll offset that brings a frame into view, changing it as little as
 *  possible — a timeline that jumped on every seek would be unusable while
 *  playing. */
export function scrollFrameIntoView(
  layout: TimelineLayout,
  frame: number,
  marginFrames = 12,
): number {
  const viewFrames = Math.max(1, (layout.width - GUTTER_WIDTH) / layout.pxPerFrame);
  const first = layout.scrollFrames;
  const last = first + viewFrames;
  if (frame >= first + marginFrames && frame <= last - marginFrames) return first;
  // Centring only when it is off screen: a playhead that sat in the middle of
  // the viewport during playback would make the picture appear to scroll
  // backwards under it.
  return clampScroll(layout, frame - viewFrames / 2);
}

// -- the vertical axis -------------------------------------------------------

/** How tall the rows are, all of them: the height the content needs before it
 *  starts to scroll. */
export function contentHeight(layout: TimelineLayout): number {
  return trackTop(layout.trackCount);
}

/** How far down the rows may be scrolled. Zero when they all fit, which they
 *  usually do: a timeline with a permanent vertical scrollbar is a timeline
 *  that looks like it is hiding something. */
export function maxScrollTop(layout: TimelineLayout): number {
  const viewport = Math.max(0, layout.height - RULER_HEIGHT);
  return Math.max(0, contentHeight(layout) - viewport);
}

/** A vertical scroll offset, inside what there is to scroll. */
export function clampScrollTop(layout: TimelineLayout, pixels: number): number {
  if (!Number.isFinite(pixels)) return 0;
  return Math.min(Math.max(pixels, 0), maxScrollTop(layout));
}

/** How tall one row is, gap included — what the gutter and the lanes both space
 *  themselves by, so a track head can never disagree with its clips. */
export const ROW_HEIGHT = TRACK_HEIGHT + TRACK_GAP;
