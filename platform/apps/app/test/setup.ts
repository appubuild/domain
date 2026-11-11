import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// jsdom lacks these browser APIs the UI probes; provide *real-shaped* stubs so components
// exercise their genuine code paths instead of crashing on missing globals.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
if (!window.requestAnimationFrame) {
  window.requestAnimationFrame = ((cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16) as unknown as number) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as typeof window.cancelAnimationFrame;
}

// jsdom has no 2D canvas. AvatarOrb already handles a null context, but jsdom *throws*;
// give it a real-shaped no-op context so the guard is what gets exercised.
const originalGetContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, contextId: string, ...rest: unknown[]) {
  if (contextId === '2d') {
    const noop = () => undefined;
    return {
      canvas: this, scale: noop, clearRect: noop, beginPath: noop, arc: noop, fill: noop, stroke: noop,
      fillRect: noop, moveTo: noop, lineTo: noop, createRadialGradient: () => ({ addColorStop: noop }),
      set fillStyle(_v: unknown) {}, set strokeStyle(_v: unknown) {}, set lineWidth(_v: unknown) {},
      set globalAlpha(_v: unknown) {}, get globalAlpha() { return 1; },
    } as unknown as CanvasRenderingContext2D;
  }
  return originalGetContext.call(this, contextId as '2d', ...(rest as []));
} as typeof HTMLCanvasElement.prototype.getContext;
