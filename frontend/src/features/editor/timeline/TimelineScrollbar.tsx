/** The timeline's scrollbar: where the viewport is, and how to move it.
 *
 *  A custom thumb rather than a native `overflow-x: auto` container, for one
 *  reason: **there can only be one source of truth for the scroll**. A native
 *  container's `scrollLeft` and this module's `scrollFrames` would be two
 *  copies of one number, kept in step by an effect that writes to the DOM and
 *  an `onScroll` that writes to React — a loop that is stable right up to the
 *  day someone zooms while a scroll animation is in flight.
 *
 *  So the thumb is drawn from the number, and dragging the thumb writes the
 *  number. The ARIA `scrollbar` role is carried because a control that looks
 *  like a scrollbar and cannot be driven from the keyboard is a control only
 *  some users have.
 */

import { useCallback, useRef } from 'react';

import { cx, type ClassValue } from '../../../ui/cx';

export interface TimelineScrollbarProps {
  /** How far along the content the viewport is, in frames. */
  readonly scrollFrames: number;
  /** How far it may go. `0` when the whole edit fits. */
  readonly maxScrollFrames: number;
  /** How much of the edit the viewport shows, in frames. What makes the thumb
   *  the size of the view rather than an arbitrary sliver. */
  readonly visibleFrames: number;
  readonly onChange: (frames: number) => void;
  readonly label: string;
  readonly className?: ClassValue;
}

export function TimelineScrollbar({
  scrollFrames,
  maxScrollFrames,
  visibleFrames,
  onChange,
  label,
  className,
}: TimelineScrollbarProps): React.JSX.Element {
  const track = useRef<HTMLDivElement | null>(null);
  const dragging = useRef<{ pointerId: number; startX: number; startFrames: number } | null>(null);

  /** Frames per pixel of thumb travel: the whole content mapped onto the track.
   *  `1` when there is nothing to scroll, so a drag on a satisfied scrollbar
   *  cannot divide by zero and jump the viewport to the end. */
  const scale = maxScrollFrames > 0 ? maxScrollFrames : 1;
  const fraction = maxScrollFrames > 0 ? Math.min(1, scrollFrames / maxScrollFrames) : 0;
  const total = Math.max(visibleFrames + maxScrollFrames, 1);
  // Floored at eight per cent: a project a thousand times longer than its
  // viewport is still a thumb a hand can take hold of.
  const thumbPercent = Math.min(100, Math.max(8, (visibleFrames / total) * 100));

  const framesAt = useCallback(
    (clientX: number): number => {
      const box = track.current?.getBoundingClientRect();
      if (box === undefined || box.width === 0) return scrollFrames;
      const ratio = (clientX - box.left) / box.width;
      return Math.min(Math.max(ratio, 0), 1) * maxScrollFrames;
    },
    [maxScrollFrames, scrollFrames],
  );

  return (
    <div
      ref={track}
      role="scrollbar"
      aria-label={label}
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={Math.round(maxScrollFrames)}
      aria-valuenow={Math.round(scrollFrames)}
      tabIndex={maxScrollFrames > 0 ? 0 : -1}
      data-testid="timeline-scrollbar"
      className={cx(
        'relative h-2 shrink-0 touch-none select-none rounded-[3px] bg-surface-1',
        maxScrollFrames > 0 ? 'cursor-grab' : 'opacity-40',
        className,
      )}
      onKeyDown={(event) => {
        const step = event.shiftKey ? scale / 4 : scale / 20;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          onChange(Math.max(0, scrollFrames - step));
          event.preventDefault();
        } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          onChange(Math.min(maxScrollFrames, scrollFrames + step));
          event.preventDefault();
        } else if (event.key === 'Home') {
          onChange(0);
          event.preventDefault();
        } else if (event.key === 'End') {
          onChange(maxScrollFrames);
          event.preventDefault();
        }
      }}
      onPointerDown={(event) => {
        if (maxScrollFrames <= 0) return;
        if (typeof event.currentTarget.setPointerCapture === 'function') {
          event.currentTarget.setPointerCapture(event.pointerId);
        }
        event.preventDefault();
        dragging.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startFrames: scrollFrames,
        };
        // A press on the track itself jumps there; a press on the thumb is the
        // beginning of a drag, and jumping first would make the thumb move out
        // from under the pointer before it had gone anywhere.
        if (event.target === event.currentTarget) onChange(framesAt(event.clientX));
      }}
      onPointerMove={(event) => {
        const from = dragging.current;
        if (from === null || from.pointerId !== event.pointerId) return;
        const box = track.current?.getBoundingClientRect();
        if (box === undefined || box.width === 0) return;
        const travelled = ((event.clientX - from.startX) / box.width) * maxScrollFrames;
        onChange(Math.min(Math.max(from.startFrames + travelled, 0), maxScrollFrames));
      }}
      onPointerUp={() => {
        dragging.current = null;
      }}
      onPointerCancel={() => {
        dragging.current = null;
      }}
    >
      <div
        data-testid="timeline-scrollbar-thumb"
        className="absolute inset-y-0 rounded-[3px] bg-ink-faint"
        style={{
          left: `${fraction * (100 - thumbPercent)}%`,
          width: `${thumbPercent}%`,
        }}
      />
    </div>
  );
}
