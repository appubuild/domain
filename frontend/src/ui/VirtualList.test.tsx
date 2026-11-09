// @vitest-environment jsdom
/** Ten thousand rows, twenty of them drawn.
 *
 *  What is being pinned is the promise, and the promise has two halves. The
 *  first is the arithmetic: which rows exist, where they sit, and that the
 *  scrollbar still measures the whole list. The second is the accessibility of
 *  it — a virtualised list is the one place where the DOM tells a screen reader
 *  a deliberate lie, so `aria-posinset`/`aria-setsize` are what make row 500 of
 *  1 000 announce as row 500 of 1 000 instead of row 1 of 3.
 *
 *  jsdom has no layout, so the viewport measures zero: every test here is about
 *  the rows around `scrollTop`, which is the case that matters and the one a
 *  real browser agrees with.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';

import { VirtualList, type VirtualListHandle } from './VirtualList';

function renderList(props: Partial<React.ComponentProps<typeof VirtualList>> = {}): {
  readonly scroller: HTMLElement;
  readonly rerender: (next: Partial<React.ComponentProps<typeof VirtualList>>) => void;
} {
  const { container, rerender } = render(
    <VirtualList label="Clips" count={1000} itemSize={40} overscan={1} {...props}>
      {(index) => <span>row {index}</span>}
    </VirtualList>,
  );
  const scroller = container.firstElementChild as HTMLElement;
  return {
    scroller,
    rerender: (next) => {
      rerender(
        <VirtualList label="Clips" count={1000} itemSize={40} overscan={1} {...props} {...next}>
          {(index) => <span>row {index}</span>}
        </VirtualList>,
      );
    },
  };
}

function rowsIn(container = document.body): number[] {
  return [...container.querySelectorAll('[data-index]')].map((row) =>
    Number.parseInt((row as HTMLElement).dataset['index'] ?? '-1', 10),
  );
}

function scrollTo(scroller: HTMLElement, top: number): void {
  // Assigning `scrollTop` and firing `scroll` is what a browser does in the
  // other order, and the list reads the element rather than the event — so a
  // synthetic scroll event with no coordinates at all is enough.
  scroller.scrollTop = top;
  fireEvent.scroll(scroller);
}

describe('a list of a thousand rows', () => {
  it('draws the rows around the viewport and not the list', () => {
    const { scroller } = renderList();
    expect(rowsIn(scroller)).toEqual([0, 1]);
    expect(screen.queryByText('row 500')).toBeNull();
  });

  it('keeps a spacer as tall as the whole list, so the scrollbar tells the truth', () => {
    const { scroller } = renderList();
    const spacer = screen.getByRole('list');
    expect(spacer.style.height).toBe('40000px');
    // And the scroller is the thing that scrolls it.
    expect(spacer.parentElement).toBe(scroller);
  });

  it('follows the scroll position', () => {
    const { scroller } = renderList({ overscan: 1 });
    scrollTo(scroller, 400);
    // Row 10 starts at 400 px, so with one row of overscan either side the
    // window is 9, 10, 11 — and nothing else is in the document.
    expect(rowsIn(scroller)).toEqual([9, 10, 11]);
  });

  it('draws as far beyond the viewport as it was told to', () => {
    const narrow = renderList({ overscan: 0 });
    expect(rowsIn(narrow.scroller)).toEqual([0]);

    const wide = renderList({ overscan: 3 });
    expect(rowsIn(wide.scroller)).toEqual([0, 1, 2, 3]);
  });

  it('puts every row at its own offset, and not where it happens to land', () => {
    const { scroller } = renderList();
    scrollTo(scroller, 400);
    const tops = [...scroller.querySelectorAll<HTMLElement>('[data-index]')].map(
      (row) => row.style.top,
    );
    expect(tops).toEqual(['360px', '400px', '440px']);
  });

  it('draws nothing for an empty list, and takes no height for it', () => {
    const { scroller } = renderList({ count: 0 });
    expect(rowsIn(scroller)).toEqual([]);
    expect(screen.getByRole('list').style.height).toBe('0px');
  });

  it('rebuilds the window when the list changes under it', () => {
    const { scroller, rerender } = renderList();
    scrollTo(scroller, 400);
    expect(rowsIn(scroller)).toEqual([9, 10, 11]);

    rerender({ count: 2 });
    // The scroll position is now past the end of the list, so the window clamps
    // to the last row rather than drawing rows that no longer exist.
    expect(rowsIn(scroller)).toEqual([0, 1]);
  });
});

describe('rows of different heights', () => {
  it('adds up the sizes it was given', () => {
    const { scroller } = renderList({
      count: 4,
      itemSize: (index) => (index < 2 ? 10 : 20),
    });
    expect(screen.getByRole('list').style.height).toBe('60px');
    scrollTo(scroller, 20);
    // 0–10, 10–20, 20–40, 40–60: twenty pixels in is the third row.
    expect(rowsIn(scroller)).toEqual([1, 2, 3]);
    const tops = [...scroller.querySelectorAll<HTMLElement>('[data-index]')].map(
      (row) => row.style.top,
    );
    expect(tops).toEqual(['10px', '20px', '40px']);
  });
});

describe('what a screen reader is told', () => {
  it('is a named list that knows how long it is', () => {
    renderList();
    const list = screen.getByRole('list', { name: 'Clips' });
    expect(list.getAttribute('aria-setsize')).toBeNull();

    const items = screen.getAllByRole('listitem');
    expect(items.length).toBe(2);
    // Three rows are in the DOM and they are rows 1 and 2 of a thousand.
    expect(items[0]?.getAttribute('aria-posinset')).toBe('1');
    expect(items[0]?.getAttribute('aria-setsize')).toBe('1000');
    expect(items[1]?.getAttribute('aria-posinset')).toBe('2');
  });

  it('keeps telling the truth about which row this is, however far down it is', () => {
    const { scroller } = renderList();
    scrollTo(scroller, 20000);
    const items = screen.getAllByRole('listitem');
    expect(items[0]?.getAttribute('aria-posinset')).toBe('500');
    expect(items[0]?.getAttribute('aria-setsize')).toBe('1000');
  });

  it('drops the list roles for a collection whose rows speak for themselves', () => {
    const { scroller } = renderList({ role: 'none' });
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryByRole('listitem')).toBeNull();
    // The rows themselves are still there, still positioned.
    expect(rowsIn(scroller)).toEqual([0, 1]);
  });
});

describe('asking for a row', () => {
  it('scrolls to it', () => {
    const ref = createRef<VirtualListHandle>();
    const { scroller } = renderList({ ref });

    act(() => {
      ref.current?.scrollToIndex(500);
    });

    expect(scroller.scrollTop).toBe(20000);
    // And the window followed immediately — a caller that scrolls to a row and
    // then reads the list in the same tick does not get the old rows.
    expect(rowsIn(scroller)).toEqual([499, 500, 501]);
  });

  it('aligns it where it was asked to, once the viewport has a height', () => {
    const ref = createRef<VirtualListHandle>();
    const { scroller } = renderList({ ref, overscan: 0 });
    // jsdom reports a viewport of zero, so the height is handed to it: 300 px,
    // which is seven and a half rows of forty.
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 300 });
    fireEvent.scroll(scroller);

    act(() => {
      ref.current?.scrollToIndex(500, 'center');
    });
    expect(scroller.scrollTop).toBe(20000 - (300 - 40) / 2);

    act(() => {
      ref.current?.scrollToIndex(500, 'end');
    });
    expect(scroller.scrollTop).toBe(20000 - (300 - 40));
  });

  it('holds a row past either end at the end it was past', () => {
    const ref = createRef<VirtualListHandle>();
    const { scroller } = renderList({ ref });

    act(() => {
      ref.current?.scrollToIndex(-5);
    });
    expect(scroller.scrollTop).toBe(0);

    act(() => {
      ref.current?.scrollToIndex(99999);
    });
    expect(scroller.scrollTop).toBe(39960);
  });

  it('says nothing when there is nothing to say it about', () => {
    const ref = createRef<VirtualListHandle>();
    const { scroller } = renderList({ ref, count: 0 });

    act(() => {
      ref.current?.scrollToIndex(3);
    });
    expect(scroller.scrollTop).toBe(0);
  });
});
