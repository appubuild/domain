/** The button every other button in the window is one of.
 *
 *  Four variants, three sizes, two states, and no colours — every value is a
 *  token, which is why a theme can be a document (§10.10). What is interesting
 *  here is the part that is not visual:
 *
 *  * **A button that is working says so twice.** `loading` sets `aria-busy` for
 *    a screen reader and `disabled` for a pointer, because those are two
 *    different questions: "may I press this" and "is something happening".
 *  * **The label stays in the DOM while it is loading.** A button whose text
 *    disappears when you press it changes its accessible name mid-press, which
 *    is how a screen reader announces a button the user no longer recognises.
 *    The spinner takes the leading slot instead.
 *  * **A ref is forwarded**, because a dialog has to focus its default button on
 *    open and a menu has to return focus to its trigger on close. A button that
 *    cannot be focused by its parent is a dialog that opens with focus on
 *    `body`.
 */

import { type ButtonHTMLAttributes, type ReactNode, type Ref } from 'react';

import { cx, type ClassValue } from './cx';
import { Icon } from './Icon';
import type { IconName } from './icons';
import { Spinner } from './Spinner';

export type ButtonVariant = 'solid' | 'soft' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

/** The visual variants. `soft` is the default because `solid` is the accent,
 *  and an editor with five accent-filled buttons has no accent any more. */
const VARIANT: Record<ButtonVariant, string> = {
  solid: 'bg-accent text-accent-ink hover:brightness-110 border border-transparent',
  soft: 'bg-surface-2 text-ink hover:bg-surface-3 border border-line',
  ghost: 'bg-transparent text-ink-dim hover:text-ink hover:bg-surface-2 border border-transparent',
  danger: 'bg-danger text-accent-ink hover:brightness-110 border border-transparent',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-7 gap-1.5 px-2.5 text-xs',
  md: 'h-9 gap-2 px-3 text-sm',
  lg: 'h-11 gap-2.5 px-4 text-base',
};

const ICON_SIZE: Record<ButtonSize, 'sm' | 'md' | 'lg'> = {
  sm: 'sm',
  md: 'md',
  lg: 'lg',
};

export interface ButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'className' | 'children'
> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  /** Show a spinner and refuse the press. The label stays put while it does. */
  readonly loading?: boolean;
  /** An icon before the label. */
  readonly icon?: IconName;
  /** An icon after the label — a chevron on a menu, mostly. */
  readonly iconEnd?: IconName;
  readonly fullWidth?: boolean;
  /** The label. `children` rather than `label` because a button's contents are
   *  its name, and a prop named `label` invites someone to pass a string where
   *  an element belongs. */
  readonly children?: ReactNode;
  readonly className?: ClassValue;
  readonly ref?: Ref<HTMLButtonElement>;
}

export function Button({
  variant = 'soft',
  size = 'md',
  loading = false,
  icon,
  iconEnd,
  fullWidth = false,
  children,
  className,
  disabled,
  type = 'button',
  ref,
  ...rest
}: ButtonProps): React.JSX.Element {
  // Native `disabled`, not `aria-disabled` with a guarded handler. Removing the
  // control from the tab order is the platform's own answer to "you may not
  // press this", and a second, subtler answer of our own would be a button that
  // behaves unlike every other button on the user's machine. The case that
  // needs care — a button that is *busy* rather than forbidden — is covered by
  // `aria-busy` below, and by the spinner keeping the label in place.
  const inert = disabled === true;

  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      // A busy button is a disabled button that says why: `aria-busy` is what a
      // screen reader announces, and the spinner is what a sighted user sees.
      disabled={inert || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex select-none items-center justify-center whitespace-nowrap rounded-control',
        'font-medium transition-colors duration-[var(--duration-fast)] ease-out',
        // Focus is drawn once, globally, in theme.css — not per component, so
        // that a focus ring cannot be forgotten on the one component that
        // needed it most.
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANT[variant],
        SIZE[size],
        fullWidth && 'w-full',
        className,
      )}
      onClick={(event) => {
        if (inert || loading) {
          event.preventDefault();
          return;
        }
        rest.onClick?.(event);
      }}
    >
      {loading ? (
        <Spinner size={size === 'lg' ? 'md' : 'sm'} />
      ) : icon ? (
        <Icon name={icon} size={ICON_SIZE[size]} />
      ) : null}
      {children}
      {iconEnd && !loading ? <Icon name={iconEnd} size={ICON_SIZE[size]} /> : null}
    </button>
  );
}
