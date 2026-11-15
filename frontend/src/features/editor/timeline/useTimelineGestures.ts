/** The timeline's gestures: what a drag is, and what it becomes.
 *
 *  A timeline is not drawn with clicks, it is drawn with drags — and a drag is
 *  the hardest thing in an editor to get right, because three different things
 *  have to be true at once:
 *
 *  1. **It feels immediate.** The clip moves under the pointer on the same
 *     frame the pointer moves.
 *  2. **It is one undo.** A drag that posts a command per pointer event would
 *     put a hundred entries in the history for one gesture — and a hundred
 *     round trips on the wire.
 *  3. **It is not a lie.** The clip's real position is whatever the service
 *     said, and a drag that did not land is a clip that goes back.
 *
 *  The resolution is that a drag is **view state until it is dropped**. The
 *  moving clip is drawn from `drag`, which lives here; the edit itself is one
 *  command, posted on release, carrying the gesture id it was minted at the
 *  start. Nothing is written optimistically, so there is nothing to reconcile:
 *  if the service refuses the drop, the clip simply returns to where it was,
 *  because that is the only place it ever was.
 *
 *  The other half is snapping, which belongs to the window and not to the
 *  service for the reason written in `snapping.ts`: the threshold is measured in
 *  pixels, and the service does not know the zoom.
 */

import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react';

import type { ClipSummary, TrackSummary } from '../../../core/api/contract';
import {
  clampTrim,
  collectSnapTargets,
  snapFrame,
  snapMove,
  snapThresholdFrames,
  type SnapTarget,
} from './snapping';
import { rowAt, xToFrame, type TimelineLayout } from './layout';

/** How far a pointer may travel and still have been a click.
 *
 *  Three pixels, which is less than a hand-held mouse trembles and less than a
 *  trackpad reports for a firm tap: below it, a drag is a mis-click, and a
 *  mis-click that moved a clip by one frame is the bug users report as "the
 *  timeline keeps moving my clips". */
export const CLICK_SLOP_PX = 3;

export interface MoveDrag {
  readonly kind: 'move';
  /** One id for the whole gesture: what makes it one undo. */
  readonly gesture: string;
  readonly clip: ClipSummary;
  /** The track the clip is on, and the row it is being dragged to. */
  readonly fromTrackIndex: number;
  readonly trackIndex: number;
  /** Where the pointer grabbed it, as `clip.start − frameAt(pointer)`. Held so
   *  the clip does not jump its own width when the drag begins. */
  readonly grabOffsetFrames: number;
  /** Where it would land: snapped, and clamped to the beginning of the project. */
  readonly startFrame: number;
  readonly snap: SnapTarget | null;
}

export interface TrimDrag {
  readonly kind: 'trim';
  readonly gesture: string;
  readonly clip: ClipSummary;
  readonly edge: 'start' | 'end';
  readonly toFrame: number;
  readonly snap: SnapTarget | null;
}

/** Scrubbing the ruler, which is the one drag that is not an edit. */
export interface ScrubDrag {
  readonly kind: 'scrub';
}

export type TimelineDrag = MoveDrag | TrimDrag | ScrubDrag;

/** Where the pointer went down, so a click can be told from a drag. */
interface Origin {
  readonly x: number;
  readonly y: number;
  readonly moved: boolean;
}

export interface GestureOptions {
  readonly layout: TimelineLayout;
  readonly tracks: readonly TrackSummary[];
  readonly scrollTop: number;
  readonly snapEnabled: boolean;
  /** Where the playhead is: a snap target, and the frame a split uses. */
  readonly playhead: number;
  readonly seek: (frame: number) => void;
  readonly onMove: (request: {
    clipId: string;
    toStartFrame: number;
    toTrackId?: string;
    gesture: string;
  }) => void;
  readonly onTrim: (request: {
    clipId: string;
    edge: 'start' | 'end';
    toFrame: number;
    gesture: string;
  }) => void;
  readonly onSelect: (clipId: string, additive: boolean) => void;
  /** Called the moment a clip is pressed, before anything has moved. Selecting
   *  on the press and not on the release is what every editor does: a user who
   *  grabs a clip to drag it has already decided they are working on it, and a
   *  selection that arrived only after they let go would be too late for the
   *  Delete they press next. */
  readonly onPress: (clipId: string, additive: boolean) => void;
  readonly onClearSelection: () => void;
}

export interface TimelineGestures {
  readonly drag: TimelineDrag | null;
  /** The frame a snap guide should be drawn at, or `null` when nothing snapped. */
  readonly snapFrame: number | null;

  readonly onClipPointerDown: (
    event: ReactPointerEvent,
    clip: ClipSummary,
    trackIndex: number,
  ) => void;
  readonly onEdgePointerDown: (
    event: ReactPointerEvent,
    clip: ClipSummary,
    edge: 'start' | 'end',
  ) => void;
  readonly onRulerPointerDown: (event: ReactPointerEvent) => void;
  readonly onEmptyPointerDown: (event: ReactPointerEvent) => void;
  /** Put on the element that contains the tracks: with capture, a drag that
   *  outruns the clip still reports to it, and so does a test that fires on
   *  the clip, because the event bubbles. */
  readonly onPointerMove: (event: ReactPointerEvent) => void;
  readonly onPointerUp: (event: ReactPointerEvent) => void;
  readonly onPointerCancel: (event: ReactPointerEvent) => void;
}

export function useTimelineGestures(options: GestureOptions): TimelineGestures {
  const [drag, setDrag] = useState<TimelineDrag | null>(null);
  /** The latest options, for the duration of a drag: a pointer move handler
   *  that closed over the layout as it was when the drag began would drag
   *  against a stale zoom the moment the user scrolled. */
  const latest = useRef(options);
  latest.current = options;

  const origin = useRef<Origin | null>(null);
  /** The gesture id, kept outside the state so a re-render mid-drag does not
   *  mint a second one. */
  const gesture = useRef<string | null>(null);

  const begin = useCallback((event: ReactPointerEvent): string => {
    // Asked for by name and not called outright, because jsdom says it is not
    // there: without the check, a drag in a test throws before it starts.
    const target = event.currentTarget;
    if (typeof target.setPointerCapture === 'function') {
      target.setPointerCapture(event.pointerId);
    }
    event.preventDefault();
    origin.current = { x: event.clientX, y: event.clientY, moved: false };
    const id = newGestureId();
    gesture.current = id;
    return id;
  }, []);

  const done = useCallback(() => {
    gesture.current = null;
    origin.current = null;
    setDrag(null);
  }, []);

  /** The pixel the pointer is at, in the timeline's own coordinates. */
  const at = useCallback((event: ReactPointerEvent) => {
    const view = latest.current;
    const box = event.currentTarget.getBoundingClientRect();
    return {
      x: event.clientX - box.left,
      y: event.clientY - box.top,
      contentY: event.clientY - box.top + view.scrollTop,
      view,
    };
  }, []);

  const onClipPointerDown = useCallback(
    (event: ReactPointerEvent, clip: ClipSummary, trackIndex: number) => {
      const view = latest.current;
      const id = begin(event);
      const frame = xToFrame(view.layout, at(event).x);
      view.onPress(clip.clip_id, event.shiftKey || event.metaKey || event.ctrlKey);
      setDrag({
        kind: 'move',
        gesture: id,
        clip,
        fromTrackIndex: trackIndex,
        trackIndex,
        grabOffsetFrames: clip.start_frame - frame,
        startFrame: clip.start_frame,
        snap: null,
      });
    },
    [at, begin],
  );

  const onEdgePointerDown = useCallback(
    (event: ReactPointerEvent, clip: ClipSummary, edge: 'start' | 'end') => {
      const id = begin(event);
      latest.current.onPress(clip.clip_id, event.shiftKey || event.metaKey || event.ctrlKey);
      // Kept from the clip: an edge is part of the clip, and a pointerdown that
      // reached the clip as well would start a move behind the trim.
      event.stopPropagation();
      setDrag({
        kind: 'trim',
        gesture: id,
        clip,
        edge,
        toFrame: edge === 'start' ? clip.start_frame : clip.end_frame,
        snap: null,
      });
    },
    [begin],
  );

  const onRulerPointerDown = useCallback(
    (event: ReactPointerEvent) => {
      const view = latest.current;
      begin(event);
      setDrag({ kind: 'scrub' });
      view.seek(xToFrame(view.layout, at(event).x));
    },
    [at, begin],
  );

  const onEmptyPointerDown = useCallback(
    (event: ReactPointerEvent) => {
      begin(event);
      setDrag({ kind: 'scrub' });
      latest.current.onClearSelection();
    },
    [begin],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent) => {
      const current = drag;
      if (current === null) return;
      const from = origin.current;
      if (from !== null && !from.moved) {
        const far =
          Math.abs(event.clientX - from.x) > CLICK_SLOP_PX ||
          Math.abs(event.clientY - from.y) > CLICK_SLOP_PX;
        if (!far) return;
        origin.current = { ...from, moved: true };
      }

      const { x, contentY, view } = at(event);
      const threshold = view.snapEnabled ? snapThresholdFrames(view.layout.pxPerFrame) : 0;
      const targets = view.snapEnabled
        ? collectSnapTargets(
            view.tracks,
            view.playhead,
            current.kind === 'scrub' ? null : current.clip.clip_id,
          )
        : [];
      const frame = xToFrame(view.layout, x);

      if (current.kind === 'scrub') {
        view.seek(frame);
        return;
      }

      if (current.kind === 'move') {
        const wanted = Math.max(0, frame + current.grabOffsetFrames);
        const snapped =
          threshold > 0
            ? snapMove(wanted, current.clip.duration_frames, targets, threshold)
            : { frame: wanted, target: null };
        const row = rowAt(view.layout, contentY) ?? current.trackIndex;
        setDrag({
          ...current,
          startFrame: snapped.frame,
          trackIndex: Math.min(Math.max(row, 0), Math.max(0, view.tracks.length - 1)),
          snap: snapped.target,
        });
        return;
      }

      const wanted = frame;
      const snapped =
        threshold > 0 ? snapFrame(wanted, targets, threshold) : { frame: wanted, target: null };
      setDrag({
        ...current,
        toFrame: clampTrim(current.clip, current.edge, snapped.frame),
        snap: snapped.target,
      });
    },
    [at, drag],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent) => {
      const current = drag;
      if (current === null) return;
      const moved = origin.current?.moved ?? false;
      const id = gesture.current ?? (current.kind === 'scrub' ? '' : current.gesture);

      if (current.kind === 'scrub') {
        done();
        return;
      }

      if (!moved) {
        // A click, then: it selects, and it does not edit. A click that also
        // nudged the clip a frame is the complaint editors get most.
        latest.current.onSelect(
          current.clip.clip_id,
          event.shiftKey || event.metaKey || event.ctrlKey,
        );
        done();
        return;
      }

      if (current.kind === 'move') {
        const track = latest.current.tracks[current.trackIndex];
        const sameTrack = current.trackIndex === current.fromTrackIndex;
        latest.current.onMove({
          clipId: current.clip.clip_id,
          toStartFrame: current.startFrame,
          gesture: id,
          ...(sameTrack || track === undefined ? {} : { toTrackId: track.track_id }),
        });
      } else {
        latest.current.onTrim({
          clipId: current.clip.clip_id,
          edge: current.edge,
          toFrame: current.toFrame,
          gesture: id,
        });
      }
      done();
    },
    [done, drag],
  );

  const onPointerCancel = useCallback(() => {
    // A cancelled drag is not an edit and not a click: it is a pointer that
    // went away, and the clip goes back to where it was because that is the
    // only place it has been.
    done();
  }, [done]);

  const snappedAt = useMemo(() => {
    if (drag === null || drag.kind === 'scrub') return null;
    return drag.snap === null ? null : drag.snap.frame;
  }, [drag]);

  return {
    drag,
    snapFrame: snappedAt,
    onClipPointerDown,
    onEdgePointerDown,
    onRulerPointerDown,
    onEmptyPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
  };
}

/** A gesture id: random, not sequential, because two windows editing one
 *  project must not mint the same one — their drags would collapse into a
 *  single undo entry. */
function newGestureId(): string {
  return `g-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}
