/** Snapping: the frame a drag wants to land on.
 *
 *  The threshold is in pixels and the targets are in frames, so what is pinned
 *  here is the conversion and the two rules that make a snap usable: a clip
 *  never snaps to itself, and a tie goes to the earlier frame.
 */

import { describe, expect, it } from 'vitest';

import type { ClipSummary, TrackSummary } from '../../../core/api/contract';
import {
  SNAP_PIXELS,
  clampTrim,
  collectSnapTargets,
  edgesOf,
  otherEdge,
  snapFrame,
  snapMove,
  snapThresholdFrames,
} from './snapping';

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

function track(clips: readonly ClipSummary[]): TrackSummary {
  return {
    track_id: 'v1',
    kind: 'video',
    name: 'v1',
    index: 0,
    muted: false,
    locked: false,
    hidden: false,
    clip_count: clips.length,
    duration_frames: clips.reduce((longest, item) => Math.max(longest, item.end_frame), 0),
    clips: [...clips],
  };
}

describe('the threshold', () => {
  it('is measured in pixels and answered in frames', () => {
    expect(snapThresholdFrames(1, 8)).toBe(8);
    expect(snapThresholdFrames(8, 8)).toBe(1);
  });

  it('widens as the zoom narrows', () => {
    // The whole point: twelve frames is a snap that drags clips across the
    // screen when zoomed out and does nothing when zoomed in. Twelve pixels is
    // the same gesture at both.
    expect(snapThresholdFrames(0.05, SNAP_PIXELS)).toBeGreaterThan(
      snapThresholdFrames(4, SNAP_PIXELS),
    );
  });

  it('is never zero, because a snap window of zero never fires', () => {
    expect(snapThresholdFrames(1000, SNAP_PIXELS)).toBe(1);
  });

  it('survives a zoom that is not a number', () => {
    expect(snapThresholdFrames(0)).toBe(1);
    expect(snapThresholdFrames(Number.NaN)).toBe(1);
  });
});

describe('the targets', () => {
  const tracks = [track([clip('c1', 10, 20), clip('c2', 60, 20)])];

  it('offers both edges of every clip', () => {
    const frames = collectSnapTargets(tracks, 0).map((target) => target.frame);
    expect(frames).toContain(10);
    expect(frames).toContain(30);
    expect(frames).toContain(60);
    expect(frames).toContain(80);
  });

  it('offers the start even for a clip that starts there', () => {
    // Frame 0 is always a target: the beginning of the project is the one edge
    // no clip owns.
    expect(collectSnapTargets([], 0).map((target) => target.frame)).toEqual([0]);
  });

  it('offers the playhead', () => {
    expect(collectSnapTargets(tracks, 45).map((target) => target.kind)).toContain('playhead');
  });

  it('does not offer the playhead twice when it is also frame zero', () => {
    const kinds = collectSnapTargets(tracks, 0).map((target) => target.kind);
    expect(kinds.filter((kind) => kind === 'playhead')).toHaveLength(0);
  });

  it('lists each frame once, however many clips share it', () => {
    // Two clips that abut share a boundary; offering it twice would make a tie
    // that the "earlier wins" rule had to break arbitrarily.
    const abutting = [track([clip('c1', 0, 20), clip('c2', 20, 20)])];
    const frames = collectSnapTargets(abutting, 0).map((target) => target.frame);
    expect(frames.filter((frame) => frame === 20)).toHaveLength(1);
  });

  it('excludes every edge of the clip being dragged', () => {
    const frames = collectSnapTargets(tracks, 0, 'c1').map((target) => target.frame);
    expect(frames).not.toContain(10);
    expect(frames).not.toContain(30);
    // The other clip's edges are still there.
    expect(frames).toContain(60);
  });

  it('says what kind of edge each one is', () => {
    const kinds = collectSnapTargets(tracks, 0).map((target) => target.kind);
    expect(kinds).toContain('clip-start');
    expect(kinds).toContain('clip-end');
  });
});

describe('a clip edge', () => {
  it('is the start and the exclusive end', () => {
    // Two clips that abut share `end_frame`, not `end_frame - 1`.
    expect(edgesOf(clip('c1', 10, 20))).toEqual([10, 30]);
  });

  it('knows which end it is not', () => {
    const c1 = clip('c1', 10, 20);
    expect(otherEdge(c1, 'start')).toBe(30);
    expect(otherEdge(c1, 'end')).toBe(10);
  });
});

describe('snapping a frame', () => {
  it('moves a frame that got close enough', () => {
    const targets = collectSnapTargets([track([clip('c1', 100, 20)])], 0);
    const result = snapFrame(103, targets, 8);
    expect(result.frame).toBe(100);
    expect(result.target?.kind).toBe('clip-start');
  });

  it('leaves a frame that did not', () => {
    const targets = collectSnapTargets([track([clip('c1', 100, 20)])], 0);
    const result = snapFrame(150, targets, 8);
    expect(result.frame).toBe(150);
    expect(result.target).toBeNull();
  });

  it('takes the nearest of two targets in range', () => {
    const targets = collectSnapTargets([track([clip('c1', 100, 20), clip('c2', 200, 20)])], 0);
    expect(snapFrame(196, targets, 20).frame).toBe(200);
    expect(snapFrame(104, targets, 20).frame).toBe(100);
  });

  it('breaks a tie towards the earlier frame', () => {
    // A drag landing exactly between two targets has to land somewhere, and
    // "the one on the left" is the one a user reading left to right expects.
    const targets = collectSnapTargets([track([clip('c1', 100, 20), clip('c2', 120, 20)])], 0);
    expect(snapFrame(110, targets, 20).frame).toBe(100);
  });

  it('snaps to the start of the project when nothing else is near', () => {
    const targets = collectSnapTargets([], 0);
    expect(snapFrame(4, targets, 8).frame).toBe(0);
  });

  it('snaps to the playhead', () => {
    const targets = collectSnapTargets([], 300);
    expect(snapFrame(303, targets, 8).target?.kind).toBe('playhead');
  });
});

describe('snapping a whole clip', () => {
  const tracks = [track([clip('c1', 100, 20), clip('c2', 200, 20)])];
  const targets = collectSnapTargets(tracks, 0, 'dragged');

  it('lands a start on a start, when the start is what got close', () => {
    const result = snapMove(103, 20, targets, 8);
    expect(result.frame).toBe(100);
    expect(result.target?.kind).toBe('clip-start');
  });

  it('lands an end on a start, which is how a clip butts up against the next', () => {
    // The dragged clip is 20 long; putting its *end* on 200 means starting at
    // 180 — an alignment snapping only the start could never reach.
    const result = snapMove(183, 20, targets, 8);
    expect(result.frame).toBe(180);
    expect(result.target?.frame).toBe(200);
  });

  it('takes the nearer of the two ends', () => {
    const byStart = snapMove(102, 20, targets, 8);
    const byEnd = snapMove(178, 20, targets, 8);
    expect(byStart.frame).toBe(100);
    expect(byEnd.frame).toBe(180);
  });

  it('breaks a tie towards the start', () => {
    // A clip that could land its start on 100 or its end on 120 lands at 100:
    // the earlier landing, and the one a user dragging right is aiming at.
    const between = [track([clip('a', 100, 20)])];
    const result = snapMove(101, 20, collectSnapTargets(between, 0, 'dragged'), 30);
    expect(result.frame).toBe(100);
  });

  it('does not let a snap drag a clip before the beginning', () => {
    // Snapping an end to frame 0 would put the start at −20; there is no −20.
    const atZero = [track([clip('a', 0, 4)])];
    const result = snapMove(2, 20, collectSnapTargets(atZero, 0, 'dragged'), 30);
    expect(result.frame).toBe(0);
  });

  it('leaves a drag alone when nothing is near', () => {
    const result = snapMove(555, 20, targets, 8);
    expect(result.frame).toBe(555);
    expect(result.target).toBeNull();
  });
});

describe('keeping a trim legal', () => {
  const c1 = clip('c1', 10, 20);

  it('stops a start at one frame before its end', () => {
    expect(clampTrim(c1, 'start', 999)).toBe(29);
  });

  it('stops an end at one frame after its start', () => {
    expect(clampTrim(c1, 'end', -999)).toBe(11);
  });

  it('never puts a start before the beginning of the project', () => {
    expect(clampTrim(c1, 'start', -5)).toBe(0);
  });

  it('lets a trim that is legal through untouched', () => {
    expect(clampTrim(c1, 'start', 15)).toBe(15);
    expect(clampTrim(c1, 'end', 25)).toBe(25);
  });
});
