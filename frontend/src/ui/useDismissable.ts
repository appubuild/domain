/** The two listeners every overlay needs, and one focus trap they all share.
 *
 *  A modal, a menu and a popover are three different things that all have to
 *  answer the same three questions, and answering them three times is how an
 *  app ends up with a modal that closes on Escape and a menu that does not:
 *
 *  * **Did the user press Escape?** Then close, and stop the event — Escape in
 *    a menu inside a dialog closes the menu, not the dialog.
 *  * **Did the user click outside?** Then close, unless the click was on the
 *    trigger that opens it, which would otherwise close and immediately reopen.
 *  * **May focus leave?** While an overlay is open, focus stays inside it, and
 *    when it closes focus goes back to whatever had it. A keyboard user tabbed
 *    somewhere; that is where they expect to be put back.
 *
 *  The trap is deliberately shallow: it cycles within a container rather than
 *  computing every focusable element in the document and disabling the rest.
 *  Disabling the rest is a two-second implementation that breaks the browser's
 *  own focus history, and it is why "modal" has a reputation for trapping
 *  people.
 */

import { useEffect, useRef } from 'react';

/** What counts as a press of Escape. Keydown and not keyup, because a dialog
 *  that waits for the key to come up feels a frame late. */
export function isEscapeKey(event: KeyboardEvent): boolean {
  // `Escape` is the standard value; `Esc` is what Internet Explorer and the
  // desktop WebView on some Windows builds still report, and a user pressing
  // Esc in a packaged window is not a hypothetical.
  return event.key === 'Escape' || event.key === 'Esc';
}

/** The elements inside `container` that may hold focus, in document order.
 *
 *  The selector is the standard one plus the two things it misses: an element
 *  with `contenteditable`, and a scroll container that is focusable in every
 *  browser but announced by none of them.
 */
export function focusableWithin(container: HTMLElement): readonly HTMLElement[] {
  const candidates = container.querySelectorAll<HTMLElement>(
    [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled]):not([type="hidden"])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
      '[contenteditable="true"]',
    ].join(','),
  );
  return [...candidates].filter((element) => {
    if (element.hasAttribute('hidden')) return false;
    // `getComputedStyle` and not `offsetWidth`: a zero-size box is how jsdom
    // reports *every* element, because jsdom has no layout, and a filter that
    // trusts it makes the whole suite blind. Display and visibility are the
    // things a hidden control actually has, and they are computed without a
    // layout pass.
    const style = typeof getComputedStyle === 'function' ? getComputedStyle(element) : null;
    if (style !== null && (style.display === 'none' || style.visibility === 'hidden')) {
      return false;
    }
    return true;
  });
}

export interface DismissableOptions {
  /** Whether the overlay is open. Every listener is a no-op while it is not. */
  readonly open: boolean;
  /** Called for Escape and for an outside press. */
  readonly onDismiss: (reason: 'escape' | 'outside') => void;
  /** The overlay's own element, or `null` before it has mounted.
   *
   *  Taken as an element and not as a ref on purpose: an overlay renders into a
   *  portal, so its content does not exist during the first commit. A ref would
   *  be read once, find `null`, and never be looked at again — which is a focus
   *  trap that never traps and a menu whose arrow keys do nothing. An element
   *  in state re-runs the effect the moment it arrives. */
  readonly container: HTMLElement | null;
  /** The element that opened it. A press on the trigger is not an outside
   *  press — otherwise the toggle closes and reopens in one event. */
  readonly trigger?: HTMLElement | null | undefined;
}

/** Escape, and a press outside, on `document` rather than on a backdrop.
 *
 *  Listening on the document rather than painting an invisible full-screen
 *  element means a click on another window, on the browser's own chrome or on
 *  an iframe is heard too — and it means one listener instead of a layer that
 *  can swallow a click meant for something else.
 */
export function useDismissable({ open, onDismiss, container, trigger }: DismissableOptions): void {
  // The handler is read through a ref: a caller who passes an inline arrow must
  // not be re-subscribing on every render, and a listener added and removed
  // sixty times a second is a leak that only shows up under load.
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (!isEscapeKey(event)) return;
      // Stop it, so an Escape in a menu inside a dialog closes the menu and
      // leaves the dialog alone. The listener nearest the overlay runs first
      // because it was added last.
      event.stopPropagation();
      dismiss.current('escape');
    };

    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (container?.contains(target) === true) return;
      if (trigger?.contains(target) === true) return;
      dismiss.current('outside');
    };

    // Added on `document` with both flags where they matter: keydown in the
    // capture phase so it is heard before a component that handles keys of its
    // own, pointerdown in the bubble phase so a click that a button already
    // handled is still a click outside.
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [container, open, trigger]);
}

export interface FocusTrapOptions {
  readonly open: boolean;
  /** The container focus is kept inside, or `null` before it has mounted. */
  readonly container: HTMLElement | null;
  /** Whether to move focus in on open. A dialog says yes; a tooltip-like
   *  overlay that must not steal focus says no. */
  readonly autoFocus?: boolean;
}

/** Keep focus inside `container` while it is open, and give it back on close.
 *
 *  Restoring focus is the half everybody forgets, and it is the half a keyboard
 *  user notices: close a dialog with Escape and focus goes to the top of the
 *  document, which means the next Tab starts from the beginning of a window
 *  they had already navigated.
 */
export function useFocusTrap({ open, container, autoFocus = true }: FocusTrapOptions): void {
  useEffect(() => {
    if (!open) return;

    const previous = document.activeElement;
    const node = container;
    if (node === null) return;

    if (autoFocus) {
      const [first] = focusableWithin(node);
      // The container itself when there is nothing focusable inside it: a dialog
      // with no controls still has to hold focus, or Tab leaves for the page
      // behind it.
      (first ?? node).focus();
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return;
      const focusable = focusableWithin(node);
      if (focusable.length === 0) {
        // Nothing to move to, so nothing may move: Tab out of an empty dialog
        // would put focus behind the scrim.
        event.preventDefault();
        node.focus();
        return;
      }
      const first = focusable[0] as HTMLElement;
      const last = focusable[focusable.length - 1] as HTMLElement;
      const active = document.activeElement;

      // Only at the edges, and only then: preventing Tab in the middle of a
      // dialog is how a trap becomes a cage.
      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && (active === first || active === node)) {
        event.preventDefault();
        last.focus();
      }
    };

    node.addEventListener('keydown', onKeyDown);
    return () => {
      node.removeEventListener('keydown', onKeyDown);
      // Back where it was, if that element is still in the document — a trigger
      // that unmounted with the thing it opened has nowhere to be focused.
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [autoFocus, container, open]);
}
