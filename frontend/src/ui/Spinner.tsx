/** The one piece of motion the design system insists on.
 *
 *  Everything else in the window may be still if the user asked for reduced
 *  motion. A spinner may not: a spinner that stops is indistinguishable from a
 *  hang, and "is it working?" is exactly the question it exists to answer. It
 *  therefore carries `data-motion="essential"`, which `styles/theme.css`
 *  exempts from the `prefers-reduced-motion` rule.
 *
 *  It is decorative by default — `aria-hidden` — because the thing that is busy
 *  is the button or the panel holding it, and that element says so with
 *  `aria-busy`. Two announcements of the same wait is no clearer than one.
 */

import { cx, type ClassValue } from './cx';

export interface SpinnerProps {
  readonly size?: 'sm' | 'md' | 'lg';
  /** The accessible name, for the rare spinner that stands alone. Given, the
   *  spinner becomes a status and the name is announced. */
  readonly label?: string;
  readonly className?: ClassValue;
}

const SIZE: Record<NonNullable<SpinnerProps['size']>, string> = {
  sm: 'h-3 w-3',
  md: 'h-4 w-4',
  lg: 'h-6 w-6',
};

export function Spinner({ size = 'md', label, className }: SpinnerProps): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={cx('animate-spin', SIZE[size], className)}
      data-motion="essential"
      aria-hidden={label === undefined ? true : undefined}
      role={label === undefined ? undefined : 'status'}
      data-testid={label === undefined ? undefined : 'spinner-status'}
    >
      {label === undefined ? null : <title>{label}</title>}
      {/* A full circle at low opacity, then an arc over it: the arc turns, the
          ring shows where it has yet to reach, and the whole thing reads as
          "working" at 12px, which is where it will be used. */}
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
