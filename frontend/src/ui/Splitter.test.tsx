// @vitest-environment jsdom
/** The handle.
 *
 *  What is pinned here is that the value is a **fraction and not a distance** —
 *  the same drag on a wide window and a narrow one reports the same number —
 *  that the keyboard can do everything the pointer can, and that a drag ends.
 *  The last one is the bug where a handle keeps following the pointer after the
 *  button came up, which is a window that resizes itself while you type.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Splitter } from './Splitter';

/** A container the splitter measures. jsdom has no layout, so the rect is
 *  handed to it: 800 × 600 at the origin, which is a window. */
function stubContainer(element: HTMLElement, width = 800, height = 600): void {
  const container = element.parentElement;
  if (container === null) throw new Error('the splitter has no container to measure');
  container.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    width,
    height,
    toJSON: () => ({}),
  });
}

function renderSplitter(
  props: Partial<React.ComponentProps<typeof Splitter>> = {},
  onChange: (value: number) => void = () => undefined,
): { readonly handle: HTMLElement; readonly onChange: (value: number) => void } {
  render(
    <div>
      <Splitter label="Resize media and preview" value={0.5} onChange={onChange} {...props} />
    </div>,
  );
  const handle = screen.getByRole('separator');
  stubContainer(handle);
  return { handle, onChange };
}

function press(handle: HTMLElement, clientX = 400, clientY = 0): void {
  fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX, clientY });
}

function move(handle: HTMLElement, clientX = 400, clientY = 0): void {
  fireEvent.pointerMove(handle, { pointerId: 1, clientX, clientY });
}

describe('a handle', () => {
  it('is a separator with a name, an orientation and a position', () => {
    const { handle } = renderSplitter({ value: 0.25, min: 0.1, max: 0.9 });

    // A row is panes side by side, so the *handle* is vertical: the ARIA
    // orientation describes the separator, not the layout.
    expect(handle.getAttribute('aria-orientation')).toBe('vertical');
    expect(handle.getAttribute('aria-label')).toBe('Resize media and preview');
    expect(handle.getAttribute('aria-valuenow')).toBe('25');
    expect(handle.getAttribute('aria-valuemin')).toBe('10');
    expect(handle.getAttribute('aria-valuemax')).toBe('90');
    expect(handle.getAttribute('aria-valuetext')).toBe('25%');
    expect(handle.tabIndex).toBe(0);
  });

  it('names the pane it resizes, when the caller knows which one that is', () => {
    renderSplitter({ controls: 'media-pane' });
    expect(screen.getByRole('separator').getAttribute('aria-controls')).toBe('media-pane');
  });

  it('reports the value it was asked to hold, not the raw one', () => {
    // A restored layout whose numbers no longer fit the window is clamped for
    // display rather than reported as nonsense.
    const { handle } = renderSplitter({ value: 0.99, max: 0.8 });
    expect(handle.getAttribute('aria-valuenow')).toBe('80');
  });
});

describe('dragging', () => {
  it('reports a fraction of the container, not a distance', () => {
    const onChange = vi.fn();
    const { handle } = renderSplitter({ value: 0.5, min: 0, max: 1 }, onChange);

    press(handle, 400);
    move(handle, 600);

    // 600 of 800 is three quarters — the same number on a window twice as wide.
    expect(onChange).toHaveBeenCalledWith(0.75);
  });

  it('measures along the axis it was laid out on', () => {
    const onChange = vi.fn();
    const { handle } = renderSplitter({ direction: 'column', min: 0, max: 1 }, onChange);

    press(handle, 0, 150);
    move(handle, 0, 450);

    // 450 of 600: a stacked layout reads the vertical axis and ignores the
    // horizontal one entirely.
    expect(onChange).toHaveBeenCalledWith(0.75);
    expect(handle.getAttribute('aria-orientation')).toBe('horizontal');
  });

  it('holds at the bounds when the drag goes past them', () => {
    const onChange = vi.fn();
    const { handle } = renderSplitter({ min: 0.2, max: 0.8 }, onChange);

    press(handle, 400);
    move(handle, 5000);
    expect(onChange).toHaveBeenLastCalledWith(0.8);

    move(handle, -5000);
    expect(onChange).toHaveBeenLastCalledWith(0.2);
  });

  it('stops when the button comes up, because a window that resizes itself is worse than one that does not', () => {
    const onChange = vi.fn();
    const { handle } = renderSplitter({ min: 0, max: 1 }, onChange);

    press(handle, 400);
    move(handle, 600);
    fireEvent.pointerUp(handle, { pointerId: 1 });
    const calls = onChange.mock.calls.length;

    move(handle, 100);
    expect(onChange.mock.calls.length).toBe(calls);
  });

  it('stops when the pointer is lost, which is what a cancelled gesture looks like', () => {
    const onChange = vi.fn();
    const { handle } = renderSplitter({ min: 0, max: 1 }, onChange);

    press(handle, 400);
    fireEvent.pointerCancel(handle, { pointerId: 1 });
    move(handle, 600);

    expect(onChange).not.toHaveBeenCalled();
  });

  it('ignores a press that is not the primary one', () => {
    const onChange = vi.fn();
    const { handle } = renderSplitter({ min: 0, max: 1 }, onChange);

    fireEvent.pointerDown(handle, { button: 2, pointerId: 1, clientX: 400 });
    move(handle, 600);

    expect(onChange).not.toHaveBeenCalled();
  });

  it('says nothing at all when the container has no size to measure', () => {
    const onChange = vi.fn();
    render(
      <div>
        <Splitter label="Resize" value={0.5} onChange={onChange} min={0} max={1} />
      </div>,
    );
    const handle = screen.getByRole('separator');
    // No stub: jsdom reports a rect of zero, and dividing by it would hand the
    // layout a NaN and wipe it.
    press(handle, 400);
    move(handle, 600);

    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows the resize cursor for the whole window while it is dragging, and puts it back', () => {
    const { handle } = renderSplitter({ min: 0, max: 1 });
    const before = document.body.style.cursor;

    press(handle, 400);
    // The pointer races ahead of a 1 px handle within a few pixels of movement,
    // and a cursor that flickers back to an arrow reads as a drag that ended.
    expect(document.body.style.cursor).toBe('col-resize');
    expect(document.body.style.userSelect).toBe('none');

    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(document.body.style.cursor).toBe(before);
    expect(document.body.style.userSelect).toBe('');
  });
});

describe('the keyboard', () => {
  it('moves by a step, and says which way the layout goes', () => {
    const onChange = vi.fn();
    const { handle } = renderSplitter({ value: 0.5, min: 0, max: 1 }, onChange);

    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith(0.51);
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith(0.49);
  });

  it('moves five steps with shift, because a percentage point at a time is a long way to the edge', () => {
    const onChange = vi.fn();
    const { handle } = renderSplitter({ value: 0.5, min: 0, max: 1 }, onChange);

    fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith(0.55);
  });

  it('goes to the ends with Home and End', () => {
    const onChange = vi.fn();
    const { handle } = renderSplitter({ value: 0.5, min: 0.2, max: 0.8 }, onChange);

    fireEvent.keyDown(handle, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith(0.8);
    fireEvent.keyDown(handle, { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith(0.2);
  });

  it('ignores the keys that belong to the other axis, so a stacked pane can still scroll', () => {
    const onChange = vi.fn();
    const { handle } = renderSplitter({ direction: 'row', min: 0, max: 1 }, onChange);

    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    fireEvent.keyDown(handle, { key: 'PageDown' });

    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('putting it back', () => {
  it('a double click returns it to where the caller said', () => {
    const onChange = vi.fn();
    const { handle } = renderSplitter({ resetTo: 0.4 }, onChange);

    fireEvent.doubleClick(handle);

    expect(onChange).toHaveBeenCalledWith(0.4);
  });

  it('or to the middle of what it is allowed to do', () => {
    const onChange = vi.fn();
    const { handle } = renderSplitter({ min: 0.2, max: 0.6 }, onChange);

    fireEvent.doubleClick(handle);

    expect(onChange).toHaveBeenCalledWith(0.4);
  });
});
