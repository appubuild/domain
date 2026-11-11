/** A switch: one setting that is either on or off.
 *
 *  **A checkbox, and deliberately.** The usual way to build this is a
 *  `<button role="switch" aria-checked>`, and the usual result is a control
 *  that looks right and is announced wrong: `role="switch"` is the one ARIA
 *  role a screen reader reads as a *state* rather than a *value*, which means
 *  "Proxy decoding, on" — and it is also the one role whose keyboard contract
 *  (Space to toggle) a hand-rolled button most often forgets. A native
 *  checkbox already has both of those, in every locale, for free.
 *
 *  What a native checkbox cannot do is look like a switch, so it is hidden and
 *  a track is drawn beside it. The input stays in the DOM, stays focusable and
 *  stays the thing that reports the state — `appearance-none` on the input
 *  itself rather than `display: none`, because a control that is not rendered
 *  is a control a keyboard cannot reach.
 *
 *  The label is part of the control, not beside it: the whole row is clickable,
 *  which is the difference between a target the width of the text and one the
 *  width of sixteen pixels.
 */

import { type InputHTMLAttributes, type Ref } from 'react';

import { cx, type ClassValue } from './cx';

export interface SwitchProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'className' | 'type' | 'checked' | 'onChange' | 'children' | 'size'
> {
  /** What is being turned on or off. The accessible name, and the row the user
   *  clicks. */
  readonly label: string;
  readonly checked: boolean;
  readonly onCheckedChange?: ((checked: boolean) => void) | undefined;
  /** Help text under the row. */
  readonly hint?: string;
  readonly className?: ClassValue;
  readonly ref?: Ref<HTMLInputElement>;
}

export function Switch({
  label,
  checked,
  onCheckedChange,
  hint,
  className,
  disabled,
  id,
  ref,
  ...rest
}: SwitchProps): React.JSX.Element {
  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <label
        className={cx(
          'flex cursor-pointer items-start gap-2.5 text-sm text-ink',
          disabled === true && 'cursor-not-allowed text-ink-faint',
        )}
      >
        <input
          {...rest}
          {...(id === undefined ? {} : { id })}
          ref={ref}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => {
            onCheckedChange?.(event.currentTarget.checked);
          }}
          // `peer` rather than a sibling selector on a state hook: the track is
          // drawn from the input's own state, so the two cannot disagree —
          // which is the bug every switch with its own `useState` has.
          className="peer sr-only"
        />
        <span
          aria-hidden="true"
          className={cx(
            'mt-0.5 flex h-4 w-7 shrink-0 items-center rounded-full border p-0.5',
            'transition-colors duration-fast',
            'border-line bg-surface-2',
            'peer-checked:border-accent peer-checked:bg-accent',
            'peer-focus-visible:ring-2 peer-focus-visible:ring-accent/40',
            'peer-disabled:opacity-60',
          )}
        >
          <span
            className={cx(
              'h-2.5 w-2.5 rounded-full bg-ink-faint transition-transform duration-fast',
              'translate-x-0 peer-checked:translate-x-3 peer-checked:bg-accent-ink',
            )}
          />
        </span>
        <span className="min-w-0">{label}</span>
      </label>

      {hint === undefined || hint === '' ? null : (
        // Not wired through `aria-describedby`: the hint belongs to the row and
        // the input's name is the label, so a screen reader reads the label and
        // then the next text in the document — which is this.
        <p className="pl-[2.375rem] text-xs text-ink-faint">{hint}</p>
      )}
    </div>
  );
}
