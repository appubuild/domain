/** Whether this user has asked for less animation.
 *
 *  `styles/theme.css` zeroes every duration under
 *  `prefers-reduced-motion: reduce`, which handles CSS. What CSS cannot do is
 *  tell *JavaScript* that it should stop: a toast that dismisses itself after
 *  `setTimeout(…, 4000)` still waits four seconds, and a menu that animates out
 *  before running its action still delays the action. This hook is how a
 *  component asks.
 *
 *  It is read through `useSyncExternalStore` rather than an effect-and-state so
 *  the answer is right on the first render and shared by every component that
 *  asks, instead of each one keeping its own copy that is one render late.
 */

import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/** The media query list, or `undefined` where `matchMedia` is not available —
 *  a test environment, mostly. Absence is answered as "no preference", because
 *  animating by default is what the platform does. */
function queryList(): MediaQueryList | undefined {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return undefined;
  }
  return window.matchMedia(QUERY);
}

function subscribe(onChange: () => void): () => void {
  const list = queryList();
  if (list === undefined) return () => undefined;
  list.addEventListener('change', onChange);
  return () => {
    list.removeEventListener('change', onChange);
  };
}

function snapshot(): boolean {
  return queryList()?.matches ?? false;
}

/** True when the user has asked the platform for reduced motion.
 *
 *  A component that animates should read this *before* choosing a duration, not
 *  after: "I will animate but faster" is not what the preference asks for.
 */
export function useReducedMotion(): boolean {
  // The server snapshot is the same as the client's default: the window is
  // rendered on the machine that will also answer the query.
  return useSyncExternalStore(subscribe, snapshot, () => false);
}

/** One motion token, in milliseconds.
 *
 *  The durations are CSS custom properties, and a component that animates in JS
 *  needs the same number the CSS uses — a toast that fades over
 *  `--duration-base` and then removes itself after a hardcoded 180 has two
 *  answers to "how long is a moment", and they drift apart the first time
 *  somebody tunes the animation.
 *
 *  It is a function and not a hook because the moment that matters is the moment
 *  you start animating: read it there, from the live document, and a theme
 *  changed a second ago is already accounted for.
 *
 *  Falls back to the reference value when there is no window or no property: a
 *  component animating in a test still needs a number, and zero would make an
 *  animation finish before an assertion could see it.
 */
export function themeDuration(
  token: '--duration-fast' | '--duration-base' | '--duration-slow',
  element?: HTMLElement,
): number {
  const fallback = token === '--duration-fast' ? 120 : token === '--duration-base' ? 180 : 260;
  if (typeof window === 'undefined') return fallback;
  const target = element ?? document.documentElement;
  const raw = window.getComputedStyle(target).getPropertyValue(token);
  const parsed = Number.parseFloat(raw);
  // `s` as well as `ms`: a token written as `0.18s` is a token a human wrote,
  // and refusing it would be pedantry that costs a real bug later on.
  if (raw.endsWith('ms')) return parsed;
  if (raw.endsWith('s')) return parsed * 1000;
  return Number.isFinite(parsed) ? parsed : fallback;
}
