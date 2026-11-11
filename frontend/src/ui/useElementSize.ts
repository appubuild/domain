/** How big an element is, as state.
 *
 *  A preview panel has to tell the service how many pixels it can fill, and
 *  that number is not a style — it is a measurement that changes when the user
 *  drags a splitter, resizes the window, or moves the window to another screen.
 *  So it is read from the layout, with the one browser API built for reading it
 *  continuously: `ResizeObserver`.
 *
 *  Two details are the whole of it:
 *
 *  * **The size is in CSS pixels, and the caller decides what to do with the
 *    device pixel ratio.** A hook that multiplied by `devicePixelRatio` itself
 *    would be wrong for half its callers, and a hook that did not would be
 *    wrong for the other half.
 *  * **An environment with no `ResizeObserver` gets one measurement.** jsdom has
 *    none, and neither does an old webview; a panel in one of those that never
 *    measured would never ask for a frame at all. One measurement on mount is
 *    enough to draw, which is strictly better than a blank panel.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface ElementSize {
  readonly width: number;
  readonly height: number;
}

export interface ElementSizeHandle<T extends HTMLElement> {
  /** Put on the element to measure. */
  readonly ref: (element: T | null) => void;
  readonly size: ElementSize;
}

export function useElementSize<T extends HTMLElement>(): ElementSizeHandle<T> {
  const [element, setElement] = useState<T | null>(null);
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });

  // Held as an element and not measured through a ref's `.current`: a ref is not
  // a dependency, so an effect keyed on it never runs again — the bug where a
  // panel measures once at mount and keeps that number until the window closes.
  const observer = useRef<ResizeObserver | null>(null);

  const ref = useCallback((next: T | null) => {
    setElement(next);
  }, []);

  useEffect(() => {
    if (element === null) return;

    const measure = (): void => {
      const rect = element.getBoundingClientRect();
      setSize((current) =>
        // Compared before writing: an observer fires on every layout change,
        // and a state write on an unchanged size is a render per frame.
        current.width === rect.width && current.height === rect.height
          ? current
          : { width: rect.width, height: rect.height },
      );
    };

    measure();

    if (typeof ResizeObserver === 'undefined') return;
    observer.current = new ResizeObserver(measure);
    observer.current.observe(element);
    return () => {
      observer.current?.disconnect();
      observer.current = null;
    };
  }, [element]);

  return { ref, size };
}
