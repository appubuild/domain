/** A dialog: the window's one interruption.
 *
 *  A modal is the only overlay that takes the whole interface hostage, and the
 *  rules are all about giving it back:
 *
 *  * **Focus moves in on open and returns on close.** `useFocusTrap` does both;
 *    the second half is the one everybody forgets, and it is the half a keyboard
 *    user notices — close with Escape and focus must be back on the button you
 *    pressed, not at the top of the document.
 *  * **Escape closes it, and the press does not escape with it.** The listener
 *    stops propagation, so a menu open inside the dialog closes the menu.
 *  * **The rest of the window is inert while it is open.** `aria-modal` tells a
 *    screen reader that, and `aria-hidden` on the portal's siblings is what a
 *    screen reader actually obeys — `aria-modal` alone is honoured unevenly.
 *  * **It has a name.** `title` is rendered in an `h2` and pointed at by
 *    `aria-labelledby`, because "dialog" with no name is what a screen reader
 *    says when a dialog forgets.
 *
 *  There is no `size` prop with four values. A dialog is as wide as it needs to
 *  be and no wider, and the one that needs to be wide says so with `className`.
 */

import { type ReactNode, useId, useState } from 'react';

import { cx, type ClassValue } from './cx';
import { Portal } from './Portal';
import { useDismissable, useFocusTrap } from './useDismissable';

export interface ModalProps {
  /** Whether it is open. The component renders nothing at all when it is not,
   *  because a hidden dialog is a dialog whose inputs are still in the tab
   *  order and still announced. */
  readonly open: boolean;
  /** The dialog's name. Shown, and pointed at by `aria-labelledby`. */
  readonly title: string;
  /** What it is for. Shown under the title and pointed at by
   *  `aria-describedby`, so the sentence a screen reader reads first is the one
   *  that says why it is here. */
  readonly description?: string;
  readonly children?: ReactNode;
  /** Buttons, right-aligned. The first of them is focused on open unless
   *  something inside the body was. */
  readonly footer?: ReactNode;
  /** Called for Escape and for a press on the scrim. Not called for a press
   *  inside the dialog — a modal that closed because you clicked it would be
   *  unusable. */
  readonly onClose: (reason: 'escape' | 'outside') => void;
  readonly className?: ClassValue;
}

export function Modal({
  open,
  title,
  description,
  children,
  footer,
  onClose,
  className,
}: ModalProps): React.JSX.Element | null {
  // State, not a ref: the dialog renders into a portal, so the element does not
  // exist during the first commit. A ref would be read once — find nothing — and
  // never be consulted again, which is a focus trap that does not trap.
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const base = useId();
  const titleId = `${base}-title`;
  const descriptionId = `${base}-description`;

  useDismissable({ open, onDismiss: onClose, container: panel });
  useFocusTrap({ open, container: panel });

  if (!open) return null;

  return (
    <Portal>
      <div
        className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-6"
        data-testid="modal-layer"
      >
        {/* The scrim is a real element and not a `::before`, so a press on it is
            a press on something that can be identified — and so it can carry
            the blur and the dimming that make the window behind read as gone. */}
        <div
          className="absolute inset-0 bg-scrim"
          aria-hidden="true"
          onPointerDown={(event) => {
            // Only the scrim itself: a press that started inside the dialog and
            // ended out here — dragging a text selection — is not a dismissal.
            if (event.target === event.currentTarget) onClose('outside');
          }}
        />
        <div
          ref={setPanel}
          // `tabIndex={-1}` so the panel can hold focus when it has nothing
          // focusable inside it, and so a click in the padding focuses the
          // dialog rather than the document behind it.
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description === undefined ? undefined : descriptionId}
          className={cx(
            'relative flex max-h-full w-full max-w-md flex-col',
            'rounded-panel border border-line bg-surface-1 shadow-overlay',
            className,
          )}
        >
          <header className="shrink-0 border-b border-line px-4 py-3">
            <h2 id={titleId} className="text-sm font-semibold text-ink">
              {title}
            </h2>
            {description === undefined ? null : (
              <p id={descriptionId} className="mt-1 text-xs text-ink-dim">
                {description}
              </p>
            )}
          </header>

          {children === undefined ? null : (
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
          )}

          {footer === undefined ? null : (
            <footer className="flex shrink-0 justify-end gap-2 border-t border-line px-4 py-3">
              {footer}
            </footer>
          )}
        </div>
      </div>
    </Portal>
  );
}
