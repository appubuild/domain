/** The vitest setup file: the one thing every test needs and no test should say.
 *
 * Two things, and the second is the one that will surprise:
 *
 * 1. **Cleanup.** `@testing-library/react` only registers its automatic cleanup
 *    when vitest runs with globals enabled, and globals are off — a test that
 *    says `expect` without importing it is a test whose dependencies are
 *    invisible. So cleanup is wired here instead, and a component test cannot
 *    leak its DOM into the next one.
 *
 * 2. **`PointerEvent`.** jsdom implements no pointer events at all. Firing one
 *    through Testing Library without this falls back to a bare `Event`, which
 *    drops `clientX`, `button` and `pointerId` on the floor — a drag test that
 *    measures nothing and a right-click test that is not a right-click. Rather
 *    than have every component test invent the same lie, the platform is made
 *    whole once, here, out of the pieces jsdom *does* have: a `MouseEvent` with
 *    a pointer's name carries every coordinate a drag needs.
 *
 *    What this shim does **not** do is pretend to implement pointer capture
 *    (`setPointerCapture`, `releasePointerCapture`). Capture is an optimisation
 *    a component may use and must not depend on; the components in `ui/` call
 *    it optionally, and a test that needs it stubs it.
 */
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Guarded on `window` as well as on the class: this file runs for the node
// suites too (§10.11), where there is no window to make whole.
if (typeof window !== 'undefined' && typeof window.PointerEvent === 'undefined') {
  class PointerEventShim extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    readonly isPrimary: boolean;

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? 'mouse';
      this.isPrimary = init.isPrimary ?? true;
    }
  }

  Object.defineProperty(window, 'PointerEvent', {
    configurable: true,
    writable: true,
    value: PointerEventShim,
  });
}

afterEach(() => {
  cleanup();
});
