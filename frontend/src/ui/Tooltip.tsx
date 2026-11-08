/** A tooltip: the label a control could not fit, shown on hover and on focus.
 *
 *  Four rules, and each is a rule because breaking it is a bug nobody reports:
 *
 *  * **It appears on focus as well as hover.** A tooltip that only answers a
 *    mouse is a tooltip a keyboard user never sees, and the controls that need
 *    tooltips — icon buttons — are the ones a keyboard user meets most.
 *  * **It is delayed.** A tooltip that appears the instant the pointer crosses a
 *    control flickers across a whole toolbar. 400 ms is long enough not to, and
 *    short enough to feel like an answer.
 *  * **Escape dismisses it, immediately and with no delay.** The user who
 *    pressed Escape has seen it and wants it gone; a tooltip that reappears
 *    because the pointer is still there is a tooltip that ignored them.
 *  * **It is not in the document when it is closed.** Hidden text is read by a
 *    screen reader. `aria-describedby` is attached only while it is open, which
 *    is the standard and the only way the description is announced once.
 *
 *  There is no positioning engine here. Four placements is what a desktop
 *  editor needs, and a library that flips and shifts costs more than the four
 *  cases it replaces — until a panel is docked against an edge, at which point
 *  `placement` is the caller's decision to make.
 */

import {
  type ReactElement,
  type ReactNode,
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

import { cx, type ClassValue } from './cx';

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

/** Where the bubble goes, relative to the trigger. */
const PLACEMENT: Record<TooltipPlacement, string> = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
  left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
  right: 'left-full top-1/2 -translate-y-1/2 ml-1.5',
};

/** How long the pointer must rest before the tooltip is offered. */
export const TOOLTIP_DELAY_MS = 400;

export interface TooltipProps {
  /** What it says. Keep it to a noun phrase: the tooltip of a button is its
   *  name, not a sentence about it. */
  readonly content: ReactNode;
  readonly placement?: TooltipPlacement;
  /** Override the delay. Zero for a tooltip that must be instant, which is
   *  almost never: `aria-describedby` already gives a screen reader the words
   *  without waiting. */
  readonly delayMs?: number;
  /** The control. Exactly one element, because the tooltip has to attach
   *  `aria-describedby` to it and clone it to do so. */
  readonly children: ReactElement;
  readonly className?: ClassValue;
}

export function Tooltip({
  content,
  placement = 'top',
  delayMs = TOOLTIP_DELAY_MS,
  children,
  className,
}: TooltipProps): React.JSX.Element {
  const id = useId();
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const cancel = useCallback((): void => {
    if (timer.current !== undefined) {
      clearTimeout(timer.current);
      timer.current = undefined;
    }
  }, []);

  const show = useCallback((): void => {
    cancel();
    if (delayMs <= 0) {
      setOpen(true);
      return;
    }
    timer.current = setTimeout(() => {
      timer.current = undefined;
      setOpen(true);
    }, delayMs);
  }, [cancel, delayMs]);

  const hide = useCallback((): void => {
    cancel();
    setOpen(false);
  }, [cancel]);

  // A tooltip left open when its trigger unmounts is a bubble with nothing to
  // point at, and a timer that fires into a dead component.
  useEffect(() => cancel, [cancel]);

  // The described-by is attached to the trigger only while the bubble exists:
  // attached permanently, the text is announced on focus with no bubble shown,
  // which reads as a stray sentence.
  const trigger = open
    ? cloneElement(children as ReactElement<{ readonly 'aria-describedby'?: string }>, {
        'aria-describedby': id,
      })
    : children;

  return (
    <span
      className="relative inline-flex"
      onPointerEnter={show}
      onPointerLeave={hide}
      // Focus and blur, and not pointer events alone: the keyboard user has no
      // pointer, and the controls that most need a tooltip are the ones with no
      // text of their own.
      onFocus={show}
      onBlur={hide}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          // Stop it here: Escape in a dialog closes the dialog, and Escape on a
          // trigger should dismiss the description, not the window behind it.
          event.stopPropagation();
          hide();
        }
      }}
    >
      {trigger}
      {open ? (
        <span
          id={id}
          role="tooltip"
          className={cx(
            'pointer-events-none absolute z-[var(--z-overlay)] whitespace-nowrap',
            'rounded-control border border-line bg-surface-3 px-2 py-1',
            'text-xs text-ink shadow-overlay',
            PLACEMENT[placement],
            className,
          )}
        >
          {content}
        </span>
      ) : null}
    </span>
  );
}
