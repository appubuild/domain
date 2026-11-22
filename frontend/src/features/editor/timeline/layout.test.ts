/** The timeline's geometry: frames ↔ pixels, and what a pixel landed on.
 *
 *  What is pinned is the part a hand-rolled canvas gets wrong and a test can
 *  catch: the rounding at a boundary, the grab width at the end of a clip, the
 *  gap between two tracks, and the two ends of the zoom ladder.
 */

import { describe, expect, it } from 'vitest';

import type { ClipSummary, TrackSummary } from '../../../core/api/contract';
import { DEFAULT_TIMEBASE } from '../../../core/timecode/timebase';
import {
  EDGE_GRAB_PX,
  GUTTER_WIDTH,
  MAX_PX_PER_FRAME,
  MIN_PX_PER_FRAME,
  RULER_HEIGHT,
  TRACK_GAP,
  TRACK_HEIGHT,
  ZOOM_LEVELS,
  clampScroll,
  clampZoom,
  clipRect,
  contentHeight,
  contentOffsetX,
  contentX,
  contentWidth,
  fitPxPerFrame,
  frameToX,
  hitTest,
  maxScrollFrames,
  rowAt,
  scrollForZoom,
  scrollFrameIntoView,
  trackTop,
  visibleRange,
  xToFrame,
  zoomStep,
  type TimelineLayout,
} from './layout';

function clip(clipId: string, start: number, duration: number): ClipSummary {
  return {
    clip_id: clipId,
    asset_id: 'a1',
    kind: 'video',
    name: clipId,
    start_frame: start,
    end_frame: start + duration,
    duration_frames: duration,
    in_frame: 0,
    out_frame: duration,
    speed: 1,
    speed_rational: '1/1',
    frame_interpolation: 'nearest',
    enabled: true,
  };
}

function track(trackId: string, clips: readonly ClipSummary[]): TrackSummary {
  return {
    track_id: trackId,
    kind: 'video',
    name: trackId,
    index: 0,
    muted: false,
    locked: false,
    hidden: false,
    clip_count: clips.length,
    duration_frames: clips.reduce((longest, item) => Math.max(longest, item.end_frame), 0),
    clips: [...clips],
  };
}

function layout(over: Partial<TimelineLayout> = {}): TimelineLayout {
  return {
    width: 800,
    height: 400,
    pxPerFrame: 1,
    scrollFrames: 0,
    trackCount: 3,
    timebase: DEFAULT_TIMEBASE,
    durationFrames: 600,
    ...over,
  };
}

describe('frames and pixels', () => {
  it('puts a frame after the gutter', () => {
    expect(frameToX(layout(), 0)).toBe(GUTTER_WIDTH);
    expect(frameToX(layout({ pxPerFrame: 2 }), 10)).toBe(GUTTER_WIDTH + 20);
  });

  it('scrolls the frame left', () => {
    expect(frameToX(layout({ scrollFrames: 10 }), 10)).toBe(GUTTER_WIDTH);
  });

  it('reads a pixel back to the frame it is nearest', () => {
    expect(xToFrame(layout(), GUTTER_WIDTH)).toBe(0);
    expect(xToFrame(layout({ pxPerFrame: 2 }), GUTTER_WIDTH + 10)).toBe(5);
  });

  it('rounds to the nearest frame, not down', () => {
    // The half of a pixel that belongs to the next frame: flooring here would
    // make every click land a frame early for the right half of every pixel.
    const at = layout({ pxPerFrame: 1 });
    expect(xToFrame(at, GUTTER_WIDTH + 4.6)).toBe(5);
    expect(xToFrame(at, GUTTER_WIDTH + 4.4)).toBe(4);
  });

  it('never answers with a frame before the start', () => {
    expect(xToFrame(layout(), 0)).toBe(0);
    expect(xToFrame(layout({ scrollFrames: 5 }), GUTTER_WIDTH - 40)).toBe(0);
  });

  it('is the exact inverse of itself', () => {
    const at = layout({ pxPerFrame: 0.5, scrollFrames: 100 });
    for (const frame of [0, 1, 37, 128, 599]) {
      expect(xToFrame(at, frameToX(at, frame))).toBe(frame);
    }
  });
});

describe('painting against measuring', () => {
  it('puts a frame in the content where the transform can move it', () => {
    const at = layout({ pxPerFrame: 2 });
    // Painting is unscrolled; the scroll is one transform on the content.
    expect(contentX(at, 10)).toBe(GUTTER_WIDTH + 20);
    expect(contentX(at, 10)).toBe(frameToX({ ...at, scrollFrames: 0 }, 10));
  });

  it('is the scroll that separates them, and only the scroll', () => {
    // The one relation that has to hold: a frame painted at `contentX`, moved
    // by `contentOffsetX`, lands where `frameToX` says it is.
    const at = layout({ pxPerFrame: 1.5, scrollFrames: 40 });
    for (const frame of [0, 12, 300, 599]) {
      expect(contentX(at, frame) + contentOffsetX(at)).toBeCloseTo(frameToX(at, frame), 6);
    }
  });

  it('does not move the content when there is nothing to scroll', () => {
    expect(contentOffsetX(layout({ scrollFrames: 0 }))).toBe(0);
  });
});

describe('the rows', () => {
  it('puts the first row under the ruler', () => {
    expect(trackTop(0)).toBe(RULER_HEIGHT);
  });

  it('stacks them with a gap between', () => {
    expect(trackTop(1)).toBe(RULER_HEIGHT + TRACK_HEIGHT + TRACK_GAP);
  });

  it('sizes the content to the tracks there are', () => {
    expect(contentHeight(layout({ trackCount: 3 }))).toBe(trackTop(3));
    expect(contentHeight(layout({ trackCount: 0 }))).toBe(RULER_HEIGHT);
  });

  it('sizes the width to the project, not to the last clip', () => {
    // A timeline whose content ended at its last clip would have nowhere to
    // drop a new one.
    expect(contentWidth(layout({ durationFrames: 600 }))).toBe(GUTTER_WIDTH + 600);
  });

  it('finds which row a pixel is in', () => {
    const at = layout();
    expect(rowAt(at, trackTop(0) + 5)).toBe(0);
    expect(rowAt(at, trackTop(2) + TRACK_HEIGHT - 1)).toBe(2);
  });

  it('says no in the gap between two rows', () => {
    const at = layout();
    expect(rowAt(at, trackTop(0) + TRACK_HEIGHT + 1)).toBeNull();
  });

  it('says no on the ruler and below the last row', () => {
    const at = layout({ trackCount: 3 });
    expect(rowAt(at, RULER_HEIGHT - 1)).toBeNull();
    expect(rowAt(at, trackTop(3) + 1)).toBeNull();
  });
});

describe('a clip rectangle', () => {
  it('spans the frames the clip plays over', () => {
    const rect = clipRect(layout(), 0, clip('c1', 10, 20));
    expect(rect.x).toBe(frameToX(layout(), 10));
    expect(rect.width).toBe(20);
    expect(rect.y).toBe(trackTop(0));
    expect(rect.height).toBe(TRACK_HEIGHT);
  });

  it('is never too narrow to hit', () => {
    // A clip a tenth of a pixel wide is still a clip the user has to grab.
    expect(clipRect(layout({ pxPerFrame: 0.02 }), 0, clip('c1', 10, 1)).width).toBe(2);
  });
});

describe('hit testing', () => {
  const tracks = [track('v1', [clip('c1', 10, 20), clip('c2', 40, 20)])];
  // Three rows, so "below the last track" is a row that exists in the layout
  // but has no track behind it — the case a lazy `tracks.length` would miss.
  const at = layout({ trackCount: 3 });

  it('finds the ruler above the tracks', () => {
    expect(hitTest(at, tracks, GUTTER_WIDTH + 100, 4)).toEqual({ kind: 'ruler' });
  });

  it('finds the gutter left of the tracks', () => {
    expect(hitTest(at, tracks, 10, trackTop(0) + 5)).toEqual({ kind: 'gutter', trackIndex: 0 });
  });

  it('finds a clip in its middle as a move', () => {
    expect(hitTest(at, tracks, GUTTER_WIDTH + 20, trackTop(0) + 10)).toEqual({
      kind: 'clip',
      clipId: 'c1',
      trackIndex: 0,
      edge: null,
    });
  });

  it('finds the start of a clip as a trim', () => {
    const x = frameToX(at, 10) + 2;
    expect(hitTest(at, tracks, x, trackTop(0) + 10).kind === 'clip').toBe(true);
    const hit = hitTest(at, tracks, x, trackTop(0) + 10);
    expect(hit).toEqual({ kind: 'clip', clipId: 'c1', trackIndex: 0, edge: 'start' });
  });

  it('finds the end of a clip as a trim', () => {
    const hit = hitTest(at, tracks, frameToX(at, 30) - 2, trackTop(0) + 10);
    expect(hit).toEqual({ kind: 'clip', clipId: 'c1', trackIndex: 0, edge: 'end' });
  });

  it('prefers the start when the pointer is inside both grab widths', () => {
    // A clip too short to have a middle: the nearer end wins, or the clip could
    // not be trimmed at all.
    const tiny = [track('v1', [clip('c1', 10, 4)])];
    const hit = hitTest(at, tiny, frameToX(at, 10) + 1, trackTop(0) + 10);
    expect(hit).toEqual({ kind: 'clip', clipId: 'c1', trackIndex: 0, edge: 'start' });
  });

  it('finds empty track when the row has no clip there', () => {
    expect(hitTest(at, tracks, GUTTER_WIDTH + 35, trackTop(0) + 10)).toEqual({
      kind: 'track',
      trackIndex: 0,
    });
  });

  it('finds nothing below the last row', () => {
    expect(hitTest(at, tracks, GUTTER_WIDTH + 100, trackTop(3) + 10)).toEqual({ kind: 'empty' });
  });

  it('uses the grab width, and only the grab width', () => {
    const inside = hitTest(at, tracks, frameToX(at, 10) + EDGE_GRAB_PX, trackTop(0) + 10);
    const outside = hitTest(at, tracks, frameToX(at, 10) + EDGE_GRAB_PX + 1, trackTop(0) + 10);
    expect(inside).toEqual({ kind: 'clip', clipId: 'c1', trackIndex: 0, edge: 'start' });
    expect(outside).toEqual({ kind: 'clip', clipId: 'c1', trackIndex: 0, edge: null });
  });
});

describe('the visible range', () => {
  it('covers the viewport', () => {
    const at = layout({ pxPerFrame: 1 });
    const { firstFrame, lastFrame } = visibleRange(at);
    expect(firstFrame).toBe(0);
    expect(lastFrame).toBeGreaterThanOrEqual(at.width - GUTTER_WIDTH);
  });

  it('moves with the scroll', () => {
    const at = layout({ pxPerFrame: 1, scrollFrames: 100 });
    expect(visibleRange(at).firstFrame).toBe(100);
  });

  it('widens by a frame at each end so a partly-visible clip is drawn', () => {
    // A clip starting one pixel off the left edge is on screen.
    const at = layout({ pxPerFrame: 2, scrollFrames: 10.5 });
    const { firstFrame } = visibleRange(at);
    expect(firstFrame).toBe(10);
  });
});

describe('the zoom ladder', () => {
  it('keeps every step on it', () => {
    let zoom = 1;
    for (let i = 0; i < 40; i += 1) zoom = zoomStep(zoom, 1);
    expect(ZOOM_LEVELS).toContain(zoom);
  });

  it('stops at both ends rather than walking off', () => {
    expect(zoomStep(MAX_PX_PER_FRAME, 1)).toBe(MAX_PX_PER_FRAME);
    expect(zoomStep(MIN_PX_PER_FRAME, -1)).toBe(MIN_PX_PER_FRAME);
  });

  it('steps backwards the same way it steps forwards', () => {
    // A zoom that walked the ladder in one direction but snapped in the other
    // would disagree with its own Ctrl+- after a layout was restored.
    expect(zoomStep(zoomStep(4, 1), -1)).toBe(4);
  });

  it('steps onto the ladder from a zoom that was never on it', () => {
    // A zoom restored from a saved layout: step to the nearest rung in the
    // direction asked for, rather than snapping, which would move backwards
    // when the user asked for forwards.
    expect(ZOOM_LEVELS).toContain(zoomStep(1.37, 1));
    expect(zoomStep(1.37, 1)).toBeGreaterThan(1.37);
    expect(zoomStep(1.37, -1)).toBeLessThan(1.37);
  });

  it('fits a short project at a wide zoom and a long one at a narrow one', () => {
    expect(fitPxPerFrame(60, 800)).toBeGreaterThan(fitPxPerFrame(60_000, 800));
  });

  it('fits a whole project into the viewport', () => {
    const zoom = fitPxPerFrame(600, 800);
    expect(600 * zoom).toBeLessThanOrEqual(800 - GUTTER_WIDTH);
  });

  it('survives an empty project', () => {
    // An empty timeline is still 24 frames of headroom wide, so it gets a zoom
    // rather than a division by zero.
    const zoom = fitPxPerFrame(0, 800);
    expect(ZOOM_LEVELS).toContain(zoom);
    expect(zoom).toBeGreaterThan(0);
  });

  it('survives a viewport that has not been measured', () => {
    expect(fitPxPerFrame(600, 0)).toBe(MIN_PX_PER_FRAME);
  });

  it('clamps anything to a rung', () => {
    expect(clampZoom(0)).toBe(MIN_PX_PER_FRAME);
    expect(clampZoom(1000)).toBe(MAX_PX_PER_FRAME);
    expect(ZOOM_LEVELS).toContain(clampZoom(1.37));
  });

  it('rounds a fit down, so a project always fits rather than nearly fits', () => {
    expect(clampZoom(0.9)).toBeLessThanOrEqual(0.9);
  });
});

describe('scrolling', () => {
  it('cannot scroll a project narrower than its viewport', () => {
    expect(maxScrollFrames(layout({ durationFrames: 10 }))).toBe(0);
    expect(clampScroll(layout({ durationFrames: 10 }), 50)).toBe(0);
  });

  it('stops at the end of the content', () => {
    const at = layout({ durationFrames: 600 });
    expect(clampScroll(at, 10_000)).toBe(maxScrollFrames(at));
  });

  it('leaves a frame already on screen where it is', () => {
    // The playhead must not drag the viewport around while the project plays.
    const at = layout({ pxPerFrame: 1, scrollFrames: 0 });
    expect(scrollFrameIntoView(at, 200)).toBe(0);
  });

  it('brings a frame off screen into view', () => {
    // Zoomed in, so there is somewhere to scroll to: at 1 px/frame a 600-frame
    // project already fits, and a viewport that cannot scroll is not a bug.
    const at = layout({ pxPerFrame: 4, scrollFrames: 0 });
    expect(scrollFrameIntoView(at, 500)).toBeGreaterThan(0);
  });

  it('keeps the anchor frame under the anchor pixel across a zoom', () => {
    // Whatever the user was looking at stays where it is: zooming without an
    // anchor slides it off the screen, and zooming back does not bring it back.
    const at = layout({ pxPerFrame: 1, scrollFrames: 0 });
    const anchorPx = GUTTER_WIDTH + 200;
    const anchorFrame = 200;

    const scrolled = scrollForZoom(at, 4, anchorFrame, anchorPx);

    expect(frameToX({ ...at, pxPerFrame: 4, scrollFrames: scrolled }, anchorFrame)).toBeCloseTo(
      anchorPx,
      5,
    );
  });

  it('anchors on the playhead the same way it anchors on a finger', () => {
    // One calculation for Ctrl+= and for a pinch: the anchor is a pixel, and
    // the caller decides which pixel.
    const at = layout({ pxPerFrame: 2, scrollFrames: 100 });
    const playhead = 150;
    const atPlayhead = frameToX(at, playhead);

    const scrolled = scrollForZoom(at, 8, playhead, atPlayhead);

    expect(frameToX({ ...at, pxPerFrame: 8, scrollFrames: scrolled }, playhead)).toBeCloseTo(
      atPlayhead,
      5,
    );
  });

  it('does not scroll past the end while anchoring', () => {
    const at = layout({ pxPerFrame: 8, durationFrames: 600 });
    expect(scrollForZoom(at, 0.02, 599, GUTTER_WIDTH + 400)).toBe(0);
  });

  it('never scrolls past the end while doing it', () => {
    const at = layout({ pxPerFrame: 1, durationFrames: 600 });
    expect(clampScroll(at, scrollFrameIntoView(at, 599))).toBe(scrollFrameIntoView(at, 599));
  });
});
