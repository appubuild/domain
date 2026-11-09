/** The toast queue as a store: the part with no React in it.
 *
 *  A toast is raised from anywhere — a failed export three components deep, a
 *  save that succeeded in a hook nobody renders — and shown in exactly one
 *  place, by a component at the top of the tree that does not know what raised
 *  it. That is a queue with subscribers, and it is deliberately *not* context:
 *
 *  * a `useToast()` hook that came from context could not be called from a
 *    callback that runs after an unmount, which is exactly when "export
 *    finished" happens;
 *  * a module-level array of components would be two mechanisms sharing a name.
 *
 *  So: one store, created by `createToastQueue()` and handed to the app
 *  explicitly. It is an object rather than a module singleton for the same
 *  reason every other dependency here is — a test creates its own, and two
 *  tests do not share state.
 *
 *  It is also a plain store and not a zustand slice, because it is not domain
 *  state. Nobody edits a toast; it is raised, shown and dismissed.
 */

import { themeDuration } from '../core/theme/useReducedMotion';

export type ToastKind = 'info' | 'success' | 'warning' | 'danger';

/** Where the stack sits. Three, because a fourth would be the same corner of
 *  the same screen with a different name: bottom-right is the default and the
 *  one a desktop editor uses, bottom-center is what a full-width status message
 *  wants, and top-right is what a window that already owns the bottom does. */
export type ToastPlacement = 'bottom-right' | 'bottom-center' | 'top-right';

export interface ToastAction {
  readonly label: string;
  readonly onSelect: () => void;
}

export interface Toast {
  readonly id: string;
  readonly kind: ToastKind;
  readonly message: string;
  /** One action, at most: a toast with three buttons is a dialog that refused
   *  to be one. */
  readonly action?: ToastAction;
  /** Milliseconds before it goes by itself. `0` means it stays until it is
   *  dismissed — for a failure whose message the user must be able to finish
   *  reading. */
  readonly durationMs: number;
}

export interface ToastInput {
  readonly kind?: ToastKind;
  readonly message: string;
  readonly action?: ToastAction;
  /** Override the default stay. `0` keeps it until dismissed. */
  readonly durationMs?: number;
}

/** How long each kind stays, when nobody says otherwise.
 *
 *  A failure stays forever and a success does not, and that asymmetry is the
 *  whole point: the user who missed a success missed an acknowledgement, and the
 *  user who missed an export failure missed their afternoon.
 */
export const TOAST_DURATION_MS: Record<ToastKind, number> = {
  info: 4000,
  success: 3000,
  warning: 6000,
  danger: 0,
};

/** How many may be on screen at once.
 *
 *  Three, and the oldest falls off the front when a fourth arrives: an editor
 *  that raises twelve toasts during a batch export has covered the thing the
 *  user was reading.
 */
export const MAX_VISIBLE_TOASTS = 3;

export interface ToastQueue {
  /** What is showing now. */
  readonly current: () => readonly Toast[];
  /** Raise one, and answer its id. */
  readonly push: (input: ToastInput) => string;
  /** Take one away. Unknown ids are ignored: a toast that dismissed itself is
   *  not an error, and the id may have been queued twice. */
  readonly dismiss: (id: string) => void;
  /** Subscribe. Answers the unsubscribe, so a component can hold the
   *  subscription in an effect and nothing else. */
  readonly subscribe: (listener: () => void) => () => void;
}

/** A queue that hands out ids from a counter.
 *
 *  Not `crypto.randomUUID()`: a toast id has to be unique within one process for
 *  a few seconds, and a counter is readable in a test assertion. It is not a
 *  `useState` either, for the reason above.
 */
export function createToastQueue(): ToastQueue {
  let toasts: readonly Toast[] = [];
  let next = 0;
  const listeners = new Set<() => void>();

  const tell = (): void => {
    for (const listener of listeners) listener();
  };

  return {
    current: () => toasts,
    push(input: ToastInput): string {
      const kind = input.kind ?? 'info';
      next += 1;
      const id = `toast-${next}`;
      const toast: Toast = {
        id,
        kind,
        message: input.message,
        ...(input.action ? { action: input.action } : {}),
        // `0` from the kind means "stay"; an explicit `0` from the caller means
        // the same thing, and an explicit number is honoured exactly.
        durationMs: input.durationMs ?? TOAST_DURATION_MS[kind],
      };
      toasts = [...toasts, toast].slice(-MAX_VISIBLE_TOASTS);
      tell();
      return id;
    },
    dismiss(id: string): void {
      const before = toasts.length;
      toasts = toasts.filter((toast) => toast.id !== id);
      // Only announced when something actually went: a dismissal of an id that
      // is already gone would re-render every subscriber for nothing.
      if (toasts.length !== before) tell();
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** How long a toast takes to leave, from the theme.
 *
 *  Read when the toast is raised rather than when it is rendered, because the
 *  token may have changed in between and because a component that read it once
 *  at mount would animate at the wrong speed after a theme switch.
 */
export function toastExitDurationMs(): number {
  return themeDuration('--duration-base');
}
