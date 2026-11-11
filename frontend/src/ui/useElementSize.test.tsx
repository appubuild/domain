// @vitest-environment jsdom
/** Measuring an element.
 *
 *  Two behaviours, and the second is the one a hand-rolled measurement gets
 *  wrong: the size is **re-read when the element changes**, not once at mount. A
 *  preview panel whose size was read before its splitter had settled would ask
 *  the service for a frame at the wrong size and keep it until the window
 *  closed.
 *
 *  jsdom has no layout, so a size is whatever `getBoundingClientRect` is stubbed
 *  to say; an environment with no `ResizeObserver` still gets one measurement,
 *  which is the case the last test pins.
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useElementSize } from './useElementSize';

function Probe(): React.JSX.Element {
  const { ref, size } = useElementSize<HTMLDivElement>();
  return (
    <div ref={ref} data-testid="probe">
      {size.width}x{size.height}
    </div>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('measuring', () => {
  it('measures the element it was put on', async () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect(800, 450));

    render(<Probe />);

    await waitFor(() => {
      expect(screen.getByTestId('probe').textContent).toBe('800x450');
    });
  });

  it('measures again when the element it is on changes', async () => {
    // A keyed remount is how a panel whose element was replaced looks from
    // here: same hook, different node, and a ref read once would keep the old
    // number for the life of the window.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect(800, 450));

    const { rerender } = render(<Probe key="a" />);
    await waitFor(() => {
      expect(screen.getByTestId('probe').textContent).toBe('800x450');
    });

    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect(320, 180));
    rerender(<Probe key="b" />);

    await waitFor(() => {
      expect(screen.getByTestId('probe').textContent).toBe('320x180');
    });
  });

  it('asks the observer, when there is one, and stops when it is gone', async () => {
    const observed: Element[] = [];
    const disconnected: number[] = [];
    let instance = 0;
    class ObserverStub {
      private readonly index: number;
      /** Kept, and public, because the real observer is given one: a stub that
       *  dropped the callback would not be a stub of the thing being stubbed. */
      readonly callback: ResizeObserverCallback;
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
        this.index = instance += 1;
      }
      observe(element: Element): void {
        observed.push(element);
      }
      disconnect(): void {
        disconnected.push(this.index);
      }
      unobserve(): void {}
    }
    vi.stubGlobal('ResizeObserver', ObserverStub);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect(640, 360));

    const { unmount } = render(<Probe />);
    await waitFor(() => {
      expect(observed).toHaveLength(1);
    });

    act(() => {
      unmount();
    });

    expect(disconnected).toEqual([1]);
  });

  it('measures once in an environment with no observer, rather than never', async () => {
    // jsdom has no `ResizeObserver`, and neither does an old webview: a panel
    // that waited for one would never draw.
    vi.stubGlobal('ResizeObserver', undefined);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect(1024, 576));

    render(<Probe />);

    await waitFor(() => {
      expect(screen.getByTestId('probe').textContent).toBe('1024x576');
    });
  });
});

function rect(width: number, height: number): DOMRect {
  return {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    width,
    height,
    toJSON: () => ({}),
  };
}
