/** Text for a screen reader and for nobody else.
 *
 *  The alternative — `display: none`, or `aria-label` on something that has no
 *  business having one — hides the text from assistive technology too, or hides
 *  it from a translator, or both. Tailwind's `sr-only` is the standard clip: it
 *  is in the accessibility tree, it is in the document, and it is one character
 *  wide on screen.
 *
 *  Use it for a word a sighted user can infer from position and a blind user
 *  cannot — "Close" on the × in a corner — and for the live regions a panel
 *  announces through.
 */

import { cx, type ClassValue } from './cx';

export interface VisuallyHiddenProps {
  readonly children: React.ReactNode;
  readonly className?: ClassValue;
}

export function VisuallyHidden({ children, className }: VisuallyHiddenProps): React.JSX.Element {
  return <span className={cx('sr-only', className)}>{children}</span>;
}
