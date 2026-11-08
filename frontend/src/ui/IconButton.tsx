/** A button with an icon and no visible text.
 *
 *  `label` is **required**, which is the whole reason this component exists
 *  separately from `Button`. An icon-only control with no accessible name is the
 *  single most common accessibility failure in an editor's toolbar, and it is a
 *  failure that no test catches unless the test is looking for a name — so the
 *  type system looks, and a button with no label cannot be written.
 *
 *  A visible tooltip is the other half of the same problem: a sighted user
 *  meeting an unlabelled × has to guess. `IconButton` composes with `Tooltip`,
 *  and the two should be given the same words.
 */

import { type ButtonHTMLAttributes, type Ref } from 'react';

import { cx, type ClassValue } from './cx';
import { Icon } from './Icon';
import type { IconName } from './icons';
import { Spinner } from './Spinner';

export type IconButtonVariant = 'ghost' | 'soft' | 'danger';
export type IconButtonSize = 'sm' | 'md';

const VARIANT: Record<IconButtonVariant, string> = {
  ghost: 'bg-transparent text-ink-dim hover:bg-surface-2 hover:text-ink',
  soft: 'bg-surface-2 text-ink hover:bg-surface-3',
  danger: 'bg-transparent text-ink-dim hover:bg-danger hover:text-accent-ink',
};

// Square, because a round button in a row of square ones reads as a different
// kind of thing, and because the hit area a thumb needs is a square.
const SIZE: Record<IconButtonSize, string> = {
  sm: 'h-7 w-7',
  md: 'h-9 w-9',
};

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'className' | 'children'
> {
  readonly icon: IconName;
  /** The accessible name, and the text a `Tooltip` should be given too. */
  readonly label: string;
  readonly variant?: IconButtonVariant;
  readonly size?: IconButtonSize;
  readonly loading?: boolean;
  readonly className?: ClassValue;
  readonly ref?: Ref<HTMLButtonElement>;
}

export function IconButton({
  icon,
  label,
  variant = 'ghost',
  size = 'md',
  loading = false,
  className,
  disabled,
  type = 'button',
  ref,
  ...rest
}: IconButtonProps): React.JSX.Element {
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      // The label is the button's name; there is no visible text to take it
      // from, so it is passed as `aria-label` rather than rendered.
      aria-label={label}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-control',
        'transition-colors duration-[var(--duration-fast)] ease-out',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANT[variant],
        SIZE[size],
        className,
      )}
    >
      {loading ? <Spinner size="sm" /> : <Icon name={icon} size={size === 'sm' ? 'sm' : 'md'} />}
    </button>
  );
}
