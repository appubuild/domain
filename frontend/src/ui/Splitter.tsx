/** The handle between two panes.
 *
 *  A `separator` and not a `slider`, and the difference is the whole design:
 *  a slider has a value and no consequence, while this is a boundary two panes
 *  have agreed to share. Which is why
 *
 *  * **The value is a fraction, never a pixel count.** A layout saved in pixels
 *    is a layout that does not survive a resize, a second monitor, or a user
 *    who changed their display scaling — and a layout is saved, because a
 *    window that forgets where you put the inspector every time it opens is a
 *    window you rearrange every time it opens.
 *  * **It measures its own container once, when the drag starts.** Not on every
 *    move: a rect read per frame is a layout flush per frame, and the container
 *    cannot change size *while* the pointer is down.
 *  * **It is keyboard-operable** — arrows, Home, End, and a double-click to put
 *    it back. A pane that can only be resized with a mouse is a pane a
 *    trackpad user and a screen-reader user cannot resize at all.
 *  * **The caller owns the value.** A divider that kept its own position would
 *    be a divider the shell could not restore from a saved layout, and could
 *    not refuse — a pane that must not shrink past its toolbar has to be able
 *    to say so, which is what `min` is for.
 */

import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from 'react';

import { cx, type ClassValue } from './cx';

/** The direction the two panes are laid out in: `row` puts them side by side
 *  and the handle is a vertical bar; `column` stacks them and it is a
 *  horizontal one. Named for the layout and not for the handle, because that is
 *  what the flex container is told and the one thing that is easy to get wrong.
 */
export type SplitterDirection = 'row' | 'column';

export interface SplitterProps {
  /** Where the boundary sits, as a fraction of the container measured from its
   *  start edge. */
  readonly value: number;
  readonly onChange: (value: number) => void;
  readonly direction?: SplitterDirection;
  /** The bounds, as fractions. They are somebody else's decision: the pane
   *  minimums, turned into positions by whoever owns the layout. */
  readonly min?: number;
  readonly max?: number;
  /** How far one arrow key moves the boundary. A fraction and not a pixel
   *  count, for the reason above: a percentage point is the same gesture on a
   *  4 000 px timeline and on a 200 px inspector. */
  readonly step?: number;
  /** Where a double-click puts it. The midpoint of the bounds when omitted. */
  readonly resetTo?: number | undefined;
  /** Required. A separator with no name is announced as "splitter", and
   *  "splitter" does not say which two things it divides. */
  readonly label: string;
  /** The id of the pane whose size it changes, for the callers that have one. */
  readonly controls?: string | undefined;
  readonly className?: ClassValue;
}

/** Bounds for a caller who has not thought about it. A pane at 0 is a pane the
 *  user cannot find again, so the defaults say "some of it, most of it". */
const DEFAULT_MIN = 0.05;
const DEFAULT_MAX = 0.95;
const DEFAULT_STEP = 0.01;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function percentOf(value: number): number {
  return Math.round(value * 100);
}

export function Splitter({
  value,
  onChange,
  direction = 'row',
  min = DEFAULT_MIN,
  max = DEFAULT_MAX,
  step = DEFAULT_STEP,
  resetTo,
  label,
  controls,
  className,
}: SplitterProps): React.JSX.Element {
  const [dragging, setDragging] = useState(false);
  // The container as it was when the drag began: its start edge along the axis
  // and its length along it. Cached rather than re-read, see the header.
  const box = useRef({ start: 0, size: 0 });

  // The cursor belongs to the window while dragging, not to the 4 px under the
  // pointer: the pointer leaves the handle the moment the drag gets ahead of
  // it, and a cursor that flickers back to an arrow mid-drag reads as a drag
  // that stopped. Selection is switched off for the same reason — dragging a
  // boundary through two panes otherwise paints both of them blue.
  useEffect(() => {
    if (!dragging) return undefined;
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    document.body.style.cursor = direction === 'row' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
    };
  }, [direction, dragging]);

  function onPointerDown(event: PointerEvent<HTMLDivElement>): void {
    // `> 0` and not `!== 0`: an event with no button at all — a synthetic one in
    // a test — is a primary press, not a refusal.
    if (event.button > 0) return;
    const container = event.currentTarget.parentElement;
    if (container === null) return;
    const rect = container.getBoundingClientRect();
    box.current =
      direction === 'row'
        ? { start: rect.left, size: rect.width }
        : { start: rect.top, size: rect.height };
    // Pointer capture is what keeps the drag alive when the pointer races ahead
    // of the handle. Asked for by name and not called outright, because the
    // type says it is always there and jsdom says it never is: without the
    // check, a drag in a test throws before it starts.
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    event.preventDefault();
    setDragging(true);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>): void {
    if (!dragging) return;
    const { start, size } = box.current;
    // A container that measures zero has no layout, which is jsdom and not a
    // window. Dividing by it would report `NaN` and wipe the layout.
    if (size <= 0) return;
    const pointer = direction === 'row' ? event.clientX : event.clientY;
    onChange(clamp((pointer - start) / size, min, max));
  }

  function endDrag(): void {
    setDragging(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const back = direction === 'row' ? 'ArrowLeft' : 'ArrowUp';
    const forward = direction === 'row' ? 'ArrowRight' : 'ArrowDown';
    const distance = event.shiftKey ? step * 5 : step;
    let next: number;
    switch (event.key) {
      case back:
        next = value - distance;
        break;
      case forward:
        next = value + distance;
        break;
      case 'Home':
        next = min;
        break;
      case 'End':
        next = max;
        break;
      default:
        return;
    }
    // All of them: an arrow key in a scrolling pane scrolls it otherwise, and
    // Home jumps to the top of the document.
    event.preventDefault();
    onChange(clamp(next, min, max));
  }

  const position = clamp(value, min, max);

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation={direction === 'row' ? 'vertical' : 'horizontal'}
      aria-label={label}
      aria-valuemin={percentOf(min)}
      aria-valuenow={percentOf(position)}
      aria-valuemax={percentOf(max)}
      aria-valuetext={`${percentOf(position)}%`}
      {...(controls === undefined ? {} : { 'aria-controls': controls })}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onKeyDown={onKeyDown}
      onDoubleClick={() => {
        onChange(clamp(resetTo ?? (min + max) / 2, min, max));
      }}
      // The line is 1 px and the target is 9 px, because a 1 px target is a
      // target for nobody and a 9 px line is a window that lost a fight with
      // its own borders.
      className={cx(
        "relative shrink-0 bg-line after:absolute after:inset-0 after:content-['']",
        direction === 'row'
          ? 'w-px cursor-col-resize after:-left-1 after:-right-1'
          : 'h-px cursor-row-resize after:-top-1 after:-bottom-1',
        'hover:bg-accent',
        dragging && 'bg-accent',
        className,
      )}
    />
  );
}
