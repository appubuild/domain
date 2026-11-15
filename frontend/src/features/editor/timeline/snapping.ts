/** Snapping: the frame a drag wants to land on, and why.
 *
 *  Snapping is a **view** decision and it lives here, in the window, for one
 *  reason: the threshold is measured in *pixels*. Twelve pixels is a snap a
 *  thumb can feel at any zoom, and twelve *frames* is a snap that drags clips
 *  halfway across the screen when the project is zoomed out and does nothing at
 *  all when it is zoomed in. The service cannot know the zoom, so the service
 *  cannot own this.
 *
 *  What it does own is whether the resulting edit is allowed — a snapping
 *  module that refused an overlap would be a second place the rule lives, and
 *  the second place is the one that is wrong after ripple delete changes.
 *
 *  Two rules inside:
 *
 *  * **A clip does not snap to itself.** Every edge of the clip being dragged is
 *    excluded, because a clip whose start snapped to its own start is a clip
 *    that cannot be moved by less than its own length.
 *  * **The nearest target wins, and a tie goes to the earlier frame.** A drag
 *    that lands exactly between two targets has to land somewhere, and "the one
 *    on the left" is the one a user reading left to right expects.
 */

import type { ClipSummary, TrackSummary } from '../../../core/api/contract';

/** How close, in pixels, a drag has to get before it snaps. */
export const SNAP_PIXELS = 8;

/** What a target is the edge of. */
export type SnapKind = 'clip-start' | 'clip-end' | 'playhead' | 'zero';

export interface SnapTarget {
  readonly frame: number;
  readonly kind: SnapKind;
}

export interface SnapResult {
  /** Where the drag should land. */
  readonly frame: number;
  /** What it snapped to, or `null` when it did not snap. */
  readonly target: SnapTarget | null;
}

/** The threshold in frames, for a zoom. One pixel at 32 px/frame is a
 *  thirty-second of a frame, so the answer is rounded up to at least one: a
 *  snap window of zero frames is a snap that never fires. */
export function snapThresholdFrames(pxPerFrame: number, pixels = SNAP_PIXELS): number {
  if (!Number.isFinite(pxPerFrame) || pxPerFrame <= 0) return 1;
  return Math.max(1, Math.ceil(pixels / pxPerFrame));
}

/** Every frame a drag might want to land on.
 *
 *  `ignoreClipId` is the clip being dragged: every one of its own edges is
 *  excluded, along with its other end — a clip whose tail snapped to its own
 *  head would refuse to move at all.
 */
export function collectSnapTargets(
  tracks: readonly TrackSummary[],
  playhead: number,
  ignoreClipId: string | null = null,
): SnapTarget[] {
  const targets: SnapTarget[] = [{ frame: 0, kind: 'zero' }];
  if (playhead > 0) targets.push({ frame: playhead, kind: 'playhead' });

  const seen = new Set<number>([0, playhead]);
  for (const track of tracks) {
    for (const clip of track.clips) {
      if (clip.clip_id === ignoreClipId) continue;
      for (const frame of edgesOf(clip)) {
        if (seen.has(frame)) continue;
        seen.add(frame);
        targets.push({ frame, kind: frame === clip.start_frame ? 'clip-start' : 'clip-end' });
      }
    }
  }
  return targets;
}

/** The two edges a clip offers: where it starts, and where it ends.
 *
 *  The end is exclusive in the domain (`end_frame` is the first frame the clip
 *  does not cover), and that is the right thing to snap to: two clips that abut
 *  share a boundary, and the boundary is `end_frame`, not `end_frame - 1`.
 */
export function edgesOf(clip: ClipSummary): readonly [number, number] {
  return [clip.start_frame, clip.end_frame];
}

/** Where a drag should land. */
export function snapFrame(
  candidate: number,
  targets: readonly SnapTarget[],
  thresholdFrames: number,
): SnapResult {
  let best: SnapTarget | null = null;
  let bestDistance = thresholdFrames + 1;

  for (const target of targets) {
    const distance = Math.abs(target.frame - candidate);
    if (distance > thresholdFrames) continue;
    // Strictly closer, so an earlier target wins a tie: a drag landing exactly
    // between two of them goes to the one on the left.
    if (distance >= bestDistance) continue;
    bestDistance = distance;
    best = target;
  }

  return best === null ? { frame: candidate, target: null } : { frame: best.frame, target: best };
}

/** Where a dragged clip should land, given where the pointer wants it.
 *
 *  A clip has two ends and either one may be the one that matters: butting a
 *  clip up against the one before it means its *start* finds a target, and
 *  butting it up against the one after it means its *end* does. Snapping only
 *  the start is an editor where half the alignments are impossible.
 *
 *  A tie goes to the start, which is the earlier of the two landings and the one
 *  a user dragging rightwards is aiming at.
 */
export function snapMove(
  candidateStart: number,
  durationFrames: number,
  targets: readonly SnapTarget[],
  thresholdFrames: number,
): SnapResult {
  const byStart = snapFrame(candidateStart, targets, thresholdFrames);
  const byEnd = snapFrame(candidateStart + durationFrames, targets, thresholdFrames);

  if (byStart.target === null && byEnd.target === null) {
    return { frame: Math.max(0, candidateStart), target: null };
  }
  if (byEnd.target === null) return { frame: Math.max(0, byStart.frame), target: byStart.target };
  if (byStart.target === null) {
    return { frame: Math.max(0, byEnd.frame - durationFrames), target: byEnd.target };
  }

  const fromStart = Math.max(0, byStart.frame);
  const fromEnd = Math.max(0, byEnd.frame - durationFrames);
  const distanceStart = Math.abs(byStart.frame - candidateStart);
  const distanceEnd = Math.abs(byEnd.frame - (candidateStart + durationFrames));
  // Ties keep the start: between landing here and landing a clip-length later,
  // the one the pointer is nearer the beginning of is the one that was meant.
  return distanceEnd < distanceStart
    ? { frame: fromEnd, target: byEnd.target }
    : { frame: fromStart, target: byStart.target };
}

/** Where a clip's *other* end is, so a trim can be told not to drag it past
 *  itself. The trim command clamps on the service; this is what keeps the drag
 *  from showing a clip turned inside out before the answer comes back. */
export function otherEdge(clip: ClipSummary, edge: 'start' | 'end'): number {
  return edge === 'start' ? clip.end_frame : clip.start_frame;
}

/** A trim, kept legal at this end: a clip is at least one frame long, and a
 *  start cannot pass its own end. */
export function clampTrim(clip: ClipSummary, edge: 'start' | 'end', wanted: number): number {
  if (edge === 'start') {
    // One frame before the end: a clip of zero frames is not a clip.
    return Math.min(Math.max(wanted, 0), clip.end_frame - 1);
  }
  return Math.max(wanted, clip.start_frame + 1);
}
