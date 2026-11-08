/** A text input with a label, a hint and an error — `Field` wired to `<input>`.
 *
 *  `onValueChange` and not `onChange`: the handler is handed the string rather
 *  than the event, because a component that receives an event can read
 *  `event.target.value` after React has pooled it, and because every caller was
 *  going to write the same one line to get the value out. An escape hatch
 *  (`onChange`, the native one) is still there for the caller who needs the
 *  event — a caret position, a key.
 */

import { type InputHTMLAttributes, type Ref } from 'react';

import { cx, type ClassValue } from './cx';
import { Field } from './Field';

export interface TextFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  // `size` is ours: the HTML `size` attribute is a character count, and a
  // component whose `size="sm"` silently means `size=0` is a trap.
  'className' | 'value' | 'children' | 'size'
> {
  readonly label: string;
  readonly value: string;
  readonly onValueChange?: ((value: string) => void) | undefined;
  readonly hint?: string;
  readonly error?: string;
  readonly size?: 'sm' | 'md';
  readonly labelHidden?: boolean;
  readonly className?: ClassValue;
  readonly ref?: Ref<HTMLInputElement>;
}

const SIZE = {
  sm: 'h-8 px-2.5 text-sm',
  md: 'h-9 px-3 text-sm',
} as const;

export function TextField({
  label,
  value,
  onValueChange,
  hint,
  error,
  size = 'md',
  labelHidden = false,
  className,
  required,
  ref,
  ...rest
}: TextFieldProps): React.JSX.Element {
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
        <input
          {...rest}
          {...control}
          ref={ref}
          value={value}
          // Never `required` on the element itself: the browser's own
          // validation bubble is unstyleable, untranslatable and appears in the
          // wrong place. `Field` reports it with `aria-required`, and the form
          // that cares shows a message it wrote.
          required={false}
          onChange={(event) => {
            onValueChange?.(event.target.value);
            // The caller's own handler, when it needs the event and not just
            // the string — a caret to restore, a key to swallow.
            rest.onChange?.(event);
          }}
          className={cx(
            'w-full min-w-0 rounded-control border bg-surface-0 text-ink',
            'placeholder:text-ink-faint',
            'transition-colors duration-[var(--duration-fast)] ease-out',
            // The border is the state: neutral, then the line colour, then
            // danger. Never danger alone — `aria-invalid` came from `Field`.
            error ? 'border-danger' : 'border-line hover:border-ink-faint',
            'disabled:cursor-not-allowed disabled:opacity-50',
            SIZE[size],
          )}
        />
      )}
    </Field>
  );
}
