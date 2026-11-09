/** A list of ten thousand things, of which twenty are drawn.
 *
 *  Two hundred thousand frames fit on a two-hour timeline, and a media bin
 *  grows without limit. Drawing all of them is the whole bug: the DOM node is
 *  not the expensive part, the layout of it is.
 *
 *  What this component decides for everybody else:
 *
 *  * **The window is derived from the scroll position, and nothing else is
 *    measured.** No `IntersectionObserver` per row, no measuring pass, no
 *    `content-visibility` guess: an offset table is built once from the item
 *    sizes and binary-searched on every scroll.
 *  * **The items are absolutely positioned inside a spacer as tall as the whole
 *    list.** Which is what keeps the scrollbar honest — a list that only shows
 *    the rows it has is a list whose scrollbar lies about how much is left.
 *  * **The list is a `list`, and it knows how long it is.** Virtualisation is
 *    invisible to a mouse and glaring to a screen reader: the DOM says "3
 *    items", so `role="list"` plus `aria-posinset`/`aria-setsize` on every row
 *    is what tells the truth about which of the ten thousand this is.
 *  * **Keyboard navigation is not here.** What moving through a list means —
 *    roving focus, a selection, a type-ahead — depends on the list, so it stays
 *    with the list. `scrollToIndex` is the one piece this owns, because it
 *    needs the offset table.
 */

import {
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';

import { cx, type ClassValue } from './cx';

export interface VirtualListHandle {
  /** Bring item `index` into view, aligned to the start of the viewport, its
   *  centre, or its end. */
  readonly scrollToIndex: (index: number, align?: 'start' | 'center' | 'end') => void;
}

export interface VirtualListProps {
  readonly count: number;
  /** The height of one row: one number, or a function of the index. A function
   *  is called for every index when `count` or the function changes, so it must
   *  be cheap, and it must be stable (`useCallback`) or the table is rebuilt on
   *  every render. */
  readonly itemSize: number | ((index: number) => number);
  readonly children: (index: number) => ReactNode;
  /** Rows drawn beyond the viewport on each side. Two by default: enough that
   *  a fast drag does not show empty space, few enough that the overscan is not
   *  itself the thing being measured. */
  readonly overscan?: number;
  /** Required. An unnamed `list` is announced as "list", which is every other
   *  list on the screen. */
  readonly label: string;
  /** `none` for a collection whose rows carry their own role — a toolbar, a
   *  strip of thumbnails, a row of tabs. The offset table still applies. */
  readonly role?: 'list' | 'none';
  readonly className?: ClassValue;
  readonly ref?: Ref<VirtualListHandle>;
}

/** The top edge of every row, plus the bottom edge of the last one. Length is
 *  `count + 1`, so `offsets[i]` is where row `i` starts and `offsets[i + 1]` is
 *  where it ends. */
function offsetsOf(count: number, itemSize: number | ((index: number) => number)): number[] {
  const sizeOf = typeof itemSize === 'number' ? () => itemSize : itemSize;
  const offsets: number[] = [0];
  for (let index = 0; index < count; index += 1) {
    offsets.push((offsets[index] ?? 0) + Math.max(0, sizeOf(index)));
  }
  return offsets;
}

/** The row that contains `distance`. Binary search, because a linear scan of
 *  two hundred thousand offsets per scroll event is a scroll event that
 *  stutters. */
function indexAt(offsets: readonly number[], distance: number): number {
  let low = 0;
  let high = offsets.length - 2;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((offsets[middle] ?? 0) <= distance) low = middle;
    else high = middle - 1;
  }
  return low;
}

function sizeAt(offsets: readonly number[], index: number): number {
  return (offsets[index + 1] ?? 0) - (offsets[index] ?? 0);
}

export function VirtualList({
  count,
  itemSize,
  children,
  overscan = 2,
  label,
  role = 'list',
  className,
  ref,
}: VirtualListProps): React.JSX.Element {
  const viewport = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(0);

  const offsets = useMemo(() => offsetsOf(count, itemSize), [count, itemSize]);
  const total = offsets[count] ?? 0;

  // One read of both numbers, in one place: the scroll handler, the resize
  // observer and `scrollToIndex` all want the same two, and three copies of a
  // `clientHeight` read is three places to forget one.
  const measure = useCallback(() => {
    const element = viewport.current;
    if (element === null) return;
    setScrollTop(element.scrollTop);
    setHeight(element.clientHeight);
  }, []);

  useEffect(() => {
    const element = viewport.current;
    if (element === null) return undefined;
    measure();
    // A pane resized by a splitter changes the number of visible rows without
    // a scroll and without a window resize, which is exactly the case a scroll
    // listener misses. Guarded, because jsdom has no `ResizeObserver` and no
    // layout — a list in a test measures zero and draws the first `overscan`
    // rows, which is what the tests assert.
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      measure();
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [measure]);

  useImperativeHandle(
    ref,
    () => ({
      scrollToIndex(index, align = 'start') {
        const element = viewport.current;
        if (element === null || count === 0) return;
        const target = Math.min(Math.max(index, 0), count - 1);
        const top = offsets[target] ?? 0;
        const shift =
          align === 'center'
            ? (height - sizeAt(offsets, target)) / 2
            : align === 'end'
              ? height - sizeAt(offsets, target)
              : 0;
        element.scrollTop = Math.max(0, top - shift);
        // The browser fires `scroll` for a scroll it was asked to do, but not
        // before this function returns — and a caller that scrolls to a row and
        // then reads the window in the same tick should see the row.
        measure();
      },
    }),
    // `ref` is deliberately not a dependency: it is where the handle is written,
    // not a value the handle is computed from.
    [count, height, measure, offsets],
  );

  const first = Math.max(0, indexAt(offsets, scrollTop) - overscan);
  const last = Math.min(count - 1, indexAt(offsets, scrollTop + height) + overscan);
  const rows: number[] = [];
  for (let index = first; index <= last; index += 1) rows.push(index);

  const asList = role === 'list';

  return (
    <div
      ref={viewport}
      onScroll={measure}
      className={cx('overflow-y-auto', className)}
      data-count={count}
    >
      <div
        // The role is on the spacer and not on the scroller, so the rows are the
        // list's own children: a generic container between a `list` and its
        // `listitem`s is a relationship some browsers drop.
        style={{ position: 'relative', height: total }}
        {...(asList ? { role: 'list', 'aria-label': label } : {})}
      >
        {rows.map((index) => (
          <div
            key={index}
            style={{
              position: 'absolute',
              top: offsets[index] ?? 0,
              left: 0,
              right: 0,
              height: sizeAt(offsets, index),
            }}
            data-index={index}
            {...(asList
              ? { role: 'listitem', 'aria-posinset': index + 1, 'aria-setsize': count }
              : {})}
          >
            {children(index)}
          </div>
        ))}
      </div>
    </div>
  );
}
