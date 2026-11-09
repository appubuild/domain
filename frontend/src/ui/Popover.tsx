/** A panel anchored to something, that does not take the window hostage.
 *
 *  The difference between this and `Modal` is the whole design:
 *
 *  * **Focus is not trapped.** A popover holds controls — a colour picker, a
 *    shortcut list, a zoom menu — and a control you have to dismiss to get back
 *    to the thing you were editing is not a control, it is an interruption.
 *  * **Escape still closes it and returns focus to the trigger.** Which is the
 *    only promise it makes, and the reason it takes a `trigger` ref.
 *  * **It is anchored by measurement, not by nesting.** The caller measures its
 *    own trigger and hands over a rect, because a popover inside a panel with
 *    `overflow: hidden` is clipped, and the way out of that is a portal — which
 *    means the component cannot find the trigger by walking the DOM.
 *
 *  There is no flipping or shifting. Four placements and a rect is what a
 *  desktop editor needs; the caller that docks a panel against an edge knows
 *  which side has room, and it says so.
 */

import { type ReactNode, useEffect, useRef, useState } from 'react';

import { cx, type ClassValue } from './cx';
import { Portal } from './Portal';
import { useDismissable } from './useDismissable';

export type PopoverPlacement = 'top' | 'bottom' | 'left' | 'right';

/** The rect to anchor against, in viewport coordinates. */
export interface PopoverAnchor {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PopoverProps {
  readonly open: boolean;
  readonly anchor: PopoverAnchor | null;
  /** The element that opened it, or `null`: a press there is not an outside
   *  press, and it is where focus goes back to. */
  readonly trigger?: HTMLElement | null | undefined;
  readonly placement?: PopoverPlacement;
  readonly onClose: (reason: 'escape' | 'outside') => void;
  readonly children: ReactNode;
  /** Keep the trigger's width. A dropdown that is narrower than the control it
   *  belongs to looks like a different application. */
  readonly matchTriggerWidth?: boolean;
  readonly className?: ClassValue;
}

/** Where the panel goes, given the anchor's rect.
 *
 *  Computed rather than expressed in CSS because the anchor is a measurement:
 *  `position: fixed` against the viewport, offset from the rect, and centred on
 *  the axis it is not placed against — which is the one thing every popover
 *  library does and the one thing Tailwind cannot express in a class.
 */
function positionOf(
  placement: PopoverPlacement,
  anchor: PopoverAnchor,
): { readonly left: number; readonly top: number } {
  switch (placement) {
    case 'top':
      return { left: anchor.x, top: anchor.y };
    case 'bottom':
      return { left: anchor.x, top: anchor.y + anchor.height };
    case 'left':
      return { left: anchor.x, top: anchor.y };
    case 'right':
      return { left: anchor.x + anchor.width, top: anchor.y };
  }
}

export function Popover({
  open,
  anchor,
  trigger,
  placement = 'bottom',
  onClose,
  children,
  matchTriggerWidth = false,
  className,
}: PopoverProps): React.JSX.Element | null {
  // State, not a ref: the popover is portalled, so its element is not there on
  // the first commit, and an outside-press listener that never saw the element
  // would treat every click as outside — including the first one on itself.
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);

  useDismissable({ open, onDismiss: onClose, container: panel, trigger });

  // Escape and an outside press are handled by `useDismissable`; what is left is
  // the promise to give focus back — and only when the popover was *opened*
  // first. A effect that ran on mount would focus the trigger of a popover that
  // never opened, which is a window that steals focus from whatever else was
  // being done in it.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    if (trigger !== null && trigger !== undefined && trigger.isConnected) trigger.focus();
  }, [open, trigger]);

  if (!open || anchor === null) return null;

  const { left, top } = positionOf(placement, anchor);

  return (
    <Portal>
      <div
        ref={setPanel}
        style={{
          left,
          top,
          ...(matchTriggerWidth ? { width: anchor.width } : {}),
        }}
        data-placement={placement}
        className={cx(
          'fixed z-[var(--z-overlay)]',
          // Offsets per placement: the 6px gap is the design system's, and it is
          // applied here rather than with a margin because the element is
          // positioned, not laid out.
          placement === 'top' && '-translate-y-[calc(100%+0.375rem)]',
          placement === 'bottom' && 'translate-y-1.5',
          placement === 'left' && '-translate-x-[calc(100%+0.375rem)]',
          placement === 'right' && 'translate-x-1.5',
          'rounded-panel border border-line bg-surface-2 p-2 shadow-overlay',
          className,
        )}
      >
        {children}
      </div>
    </Portal>
  );
}
