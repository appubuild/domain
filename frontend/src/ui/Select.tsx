/** A drop-down: `Field`'s wiring on a native `<select>`.
 *
 *  **Native, and deliberately.** A listbox of one's own is perhaps two hundred
 *  lines of focus management, type-ahead, roving `aria-activedescendant`,
 *  scroll-into-view and outside-dismiss — and it is the one control where
 *  getting any of that subtly wrong is invisible to the developer and total for
 *  the user: a `<div role="option">` that does not follow the arrow keys is a
 *  control that cannot be operated by keyboard at all. The platform already
 *  shipped that code, in every locale, and it knows what a screen reader
 *  expects. What it cannot do is look like this application, which is styling,
 *  and styling is what is below.
 *
 *  The trade-off is honest and written down: a native select cannot render an
 *  icon per option, cannot virtualise a list of ten thousand, and draws its
 *  open list in the operating system's own voice. Those are the three reasons a
 *  later stage would replace it, and the replacement is one component with the
 *  same props — `options`, `value`, `onValueChange` — so no caller changes.
 *
 *  `onValueChange` and not `onChange`: the handler gets the string, for the
 *  same reason `TextField` does. A caller that wanted the event can still have
 *  it, and a caller that wanted the value was going to write the same line.
 */

import { type Ref, type SelectHTMLAttributes } from 'react';

import { cx, type ClassValue } from './cx';
import { Field } from './Field';
import { Icon } from './Icon';

/** One choice. `value` is a string because an `<option>`'s value is a string:
 *  the wire and the DOM agree, and a select that took a number would have to
 *  invent a rule for what `08` means. */
export interface SelectOption {
  /** What is submitted, and what `value` is compared against. */
  readonly value: string;
  /** What the user reads. Falls back to `value` when omitted. */
  readonly label?: string;
  /** Whether the option can be chosen. A disabled option is still shown: a
   *  choice that disappears when it is unavailable is a setting the user cannot
   *  find to ask why. */
  readonly disabled?: boolean;
}

export interface SelectProps extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  'className' | 'value' | 'children' | 'size' | 'onChange'
> {
  readonly label: string;
  readonly options: readonly SelectOption[];
  /** The chosen option's value. `''` is "nothing chosen", which a select that
   *  has no matching option renders as the placeholder rather than as the
   *  first entry — the difference between "unset" and "set to the first thing
   *  on the list", which is the bug every settings panel has shipped. */
  readonly value: string;
  readonly onValueChange?: ((value: string) => void) | undefined;
  readonly hint?: string;
  readonly error?: string;
  readonly size?: 'sm' | 'md';
  readonly labelHidden?: boolean;
  /** Shown as the selected entry when nothing is chosen. Given, an empty
   *  `value` is a state the user can be in and read. */
  readonly placeholder?: string;
  readonly className?: ClassValue;
  readonly ref?: Ref<HTMLSelectElement>;
}

const SIZE = {
  sm: 'h-8 pl-2.5 pr-8 text-sm',
  md: 'h-9 pl-3 pr-8 text-sm',
} as const;

export function Select({
  label,
  options,
  value,
  onValueChange,
  hint,
  error,
  size = 'md',
  labelHidden = false,
  placeholder,
  className,
  required,
  ref,
  ...rest
}: SelectProps): React.JSX.Element {
  // A value with no matching option is "nothing chosen", not "the first one".
  // Without this the browser selects the first option and reports it as the
  // value, and a settings panel then saves a setting the user never made.
  const chosen = options.some((option) => option.value === value) ? value : '';

  return (
    <Field
      label={label}
      {...(hint ? { hint } : {})}
      {...(error ? { error } : {})}
      required={required === true}
      labelHidden={labelHidden}
      className={className}
    >
      {(control) => (
        <div className="relative">
          <select
            {...control}
            {...rest}
            ref={ref}
            value={chosen}
            onChange={(event) => {
              onValueChange?.(event.currentTarget.value);
            }}
            className={cx(
              'w-full appearance-none rounded-control border border-line bg-surface-2 text-ink',
              'transition-colors focus:border-accent focus:outline-none',
              'focus-visible:ring-2 focus-visible:ring-accent/40',
              'disabled:cursor-not-allowed disabled:text-ink-faint',
              SIZE[size],
            )}
          >
            {placeholder === undefined ? null : (
              <option value="" disabled={required === true}>
                {placeholder}
              </option>
            )}
            {options.map((option) => (
              <option key={option.value} value={option.value} disabled={option.disabled === true}>
                {option.label ?? option.value}
              </option>
            ))}
          </select>
          {/* `appearance-none` takes the platform's arrow away, so the arrow is
              drawn here — and it is decorative, because the select's own
              name and state are what a screen reader reads. */}
          <Icon
            name="chevron-down"
            size="sm"
            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
          />
        </div>
      )}
    </Field>
  );
}
