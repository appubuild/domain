/** A menu attached to a button.
 *
 *  Everything an overlay needs is already in `Menu`; what is missing is the one
 *  thing every button that opens one has to do for itself: say *where*. This
 *  hook is that answer, and it is a hook rather than a component because the
 *  trigger is different every time — a toolbar icon, a title-bar button, a row
 *  in a list — and a component would have to become all of them.
 *
 *  Two details are the whole of it:
 *
 *  * **The trigger is held as an element, not a ref.** Portalled content does
 *    not exist on the first commit, and a ref read once finds `null` and is
 *    never consulted again — the bug where the first press on the button counts
 *    as a press outside and the menu opens and shuts in one click.
 *  * **The anchor is measured when the menu opens, not continuously.** A rect
 *    read on every render is a layout flush on every render, and a button that
 *    moves while its menu is open is a button whose menu had better stay put.
 */

import { useCallback, useMemo, useState } from 'react';

export interface MenuAnchor {
  readonly x: number;
  readonly y: number;
}

export interface AnchoredMenu {
  readonly isOpen: boolean;
  /** Where the menu goes: the trigger's bottom-left corner, in viewport
   *  coordinates. `null` until there is a trigger to measure. */
  readonly anchor: MenuAnchor | null;
  readonly trigger: HTMLElement | null;
  readonly setTrigger: (element: HTMLElement | null) => void;
  readonly open: () => void;
  /** Takes no argument, because nothing about the reason changes what a
   *  closed menu does — and a caller that passed it one would be a caller
   *  coupled to a reason it cannot use. */
  readonly close: () => void;
  readonly toggle: () => void;
  /** Spread onto the button, so the wiring cannot be got wrong: a menu button
   *  that does not say it has a popup is a button a screen reader announces as
   *  a plain one. */
  readonly triggerProps: {
    readonly ref: (element: HTMLElement | null) => void;
    readonly 'aria-haspopup': 'menu';
    readonly 'aria-expanded': boolean;
    readonly onClick: () => void;
  };
}

export function useAnchoredMenu(): AnchoredMenu {
  const [trigger, setTrigger] = useState<HTMLElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const anchor = useMemo<MenuAnchor | null>(() => {
    if (!isOpen || trigger === null) return null;
    const rect = trigger.getBoundingClientRect();
    // Measured here rather than in the menu: a component that is handed a point
    // does not need to know what a button is.
    return { x: rect.left, y: rect.bottom };
  }, [isOpen, trigger]);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  const open = useCallback(() => {
    setIsOpen(true);
  }, []);

  const toggle = useCallback(() => {
    setIsOpen((was) => !was);
  }, []);

  return {
    isOpen,
    anchor,
    trigger,
    setTrigger,
    open,
    close,
    toggle,
    triggerProps: {
      ref: setTrigger,
      'aria-haspopup': 'menu',
      'aria-expanded': isOpen,
      onClick: toggle,
    },
  };
}
