/** One clip on a track: the block the user drags.
 *
 *  Presentational, and memoized: a timeline holds hundreds of these and
 *  re-renders on every scroll, and a clip that re-rendered when a *different*
 *  clip was selected would make a select-all feel like the window had hung.
 *
 *  Two things it is careful about:
 *
 *  * **The ends are grabbable even when the clip is not.** Below about twelve
 *    pixels wide a clip has no middle — so the nearer end wins, which is
 *    decided in `layout.hitTest`, not here. What is decided here is that the
 *    grab zones are *on top of* the clip, and swallow the pointer down: a trim
 *    that also started a move would be two drags fighting over one pointer.
 *  * **It says what it is.** A block with a number on it is not a clip; the
 *    accessible name carries the name, the in-point, the out-point and the
 *    duration, because those are the four things a user cannot see from a
 *    rectangle.
 */

import { memo } from 'react';

import type { ClipSummary } from '../../../core/api/contract';
import type { Timebase } from '../../../core/timecode/timebase';
import { formatTimecode } from '../../../core/timecode/timecode';
import { cx, type ClassValue } from '../../../ui/cx';
import type { Rect } from './layout';

export interface TimelineClipProps {
  readonly clip: ClipSummary;
  /** Where to draw it, in content pixels. */
  readonly rect: Rect;
  /** The accessible name: what it is, and where it is. */
  readonly label: string;
  readonly selected: boolean;
  /** Being dragged: drawn as lifted, so the eye can follow it. */
  readonly dragging: boolean;
  /** On a locked track, or disabled: still drawn, still selectable, not draggable. */
  readonly locked: boolean;
  readonly timebase: Timebase;
  readonly onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  readonly onTrimStart: (event: React.PointerEvent<HTMLDivElement>) => void;
  readonly onTrimEnd: (event: React.PointerEvent<HTMLDivElement>) => void;
  readonly className?: ClassValue;
}

function TimelineClipImpl({
  clip,
  rect,
  label,
  selected,
  dragging,
  locked,
  timebase,
  onPointerDown,
  onTrimStart,
  onTrimEnd,
  className,
}: TimelineClipProps): React.JSX.Element {
  const duration = formatTimecode(clip.duration_frames, timebase);

  return (
    <div
      role="button"
      tabIndex={-1}
      aria-label={label}
      aria-pressed={selected}
      data-clip-id={clip.clip_id}
      data-dragging={dragging ? 'true' : undefined}
      className={cx(
        'absolute select-none overflow-hidden rounded-[3px] border text-[11px] leading-none',
        'border-line bg-surface-3 text-ink',
        selected && !dragging && 'border-accent ring-1 ring-accent',
        dragging && 'z-10 border-accent opacity-90 shadow-overlay',
        locked && 'cursor-not-allowed opacity-70',
        !locked && 'cursor-grab',
        clip.enabled ? '' : 'opacity-60',
        className,
      )}
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
      onPointerDown={locked ? undefined : onPointerDown}
    >
      <div className="flex h-full flex-col justify-between px-1.5 py-1">
        <span className="truncate font-medium">{clip.name}</span>
        {/* The duration is the thing you cannot see from the width: two clips of
            the same length at two zooms are the same rectangle. */}
        <span className="truncate font-mono text-[10px] tabular-nums text-ink-faint">
          {duration}
        </span>
      </div>

      {/* The grab zones, last and therefore on top. They swallow the press,
          because a pointer that reached the end of a clip must not also start
          dragging its middle. */}
      <div
        role="presentation"
        aria-hidden="true"
        data-clip-edge="start"
        className="absolute inset-y-0 left-0 w-[6px] cursor-ew-resize"
        onPointerDown={
          locked
            ? undefined
            : (event) => {
                event.stopPropagation();
                onTrimStart(event);
              }
        }
      />
      <div
        role="presentation"
        aria-hidden="true"
        data-clip-edge="end"
        className="absolute inset-y-0 right-0 w-[6px] cursor-ew-resize"
        onPointerDown={
          locked
            ? undefined
            : (event) => {
                event.stopPropagation();
                onTrimEnd(event);
              }
        }
      />
    </div>
  );
}

export const TimelineClip = memo(TimelineClipImpl);
