/** A label, a control, and the two things a control can say about itself.
 *
 *  `Field` owns the wiring every form control needs and every hand-written form
 *  forgets, in this order of frequency:
 *
 *  1. the `for`/`id` pair, so clicking the label focuses the control and a
 *     screen reader reads the label when the control is focused;
 *  2. `aria-describedby` pointing at the hint *and* the error, so the help text
 *     is announced rather than merely adjacent;
 *  3. `aria-invalid`, so "this is wrong" is not conveyed by colour alone —
 *     which is the one accessibility rule with a name everybody knows and the
 *     one most often broken by a red border.
 *
 *  It is a render-prop component rather than a wrapper that renders an
 *  `<input>`, because the moment it renders an input, someone needs a
 *  `<select>`, a slider, or a colour picker inside a field, and a second copy of
 *  this wiring appears.
 */

import { type ReactNode, useId } from 'react';

import { cx, type ClassValue } from './cx';

/** What the control needs to be told, and nothing else. */
export interface FieldControlProps {
  readonly id: string;
  readonly 'aria-describedby': string | undefined;
  readonly 'aria-invalid': true | undefined;
  readonly 'aria-required': true | undefined;
}

export interface FieldProps {
  readonly label: ReactNode;
  /** Help text under the control. */
  readonly hint?: ReactNode;
  /** An error message. Given, it replaces the hint and marks the control. */
  readonly error?: ReactNode;
  readonly required?: boolean;
  /** Hide the label visually while keeping it for assistive technology. For a
   *  control whose purpose is obvious from its position — the search box in a
   *  toolbar — and not for a control whose purpose is not. */
  readonly labelHidden?: boolean;
  readonly className?: ClassValue;
  readonly children: (control: FieldControlProps) => ReactNode;
}

export function Field({
  label,
  hint,
  error,
  required = false,
  labelHidden = false,
  className,
  children,
}: FieldProps): React.JSX.Element {
  // One id per field instance, from React rather than from a counter: two
  // instances of the same component on one screen must not share an id, and a
  // module-level counter does exactly that after a fast refresh.
  const base = useId();
  const id = `${base}-control`;
  const hintId = `${base}-hint`;
  const errorId = `${base}-error`;

  // Both, rather than either: a hint and an error can be shown together, and
  // the order is the order they are read in.
  const describedBy =
    error !== undefined && error !== ''
      ? hint !== undefined && hint !== ''
        ? `${errorId} ${hintId}`
        : errorId
      : hint !== undefined && hint !== ''
        ? hintId
        : undefined;

  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label
        htmlFor={id}
        className={cx('text-xs font-medium text-ink-dim', labelHidden && 'sr-only')}
      >
        {label}
        {required ? (
          // A word and not only a star: `*` is announced as "star" by some
          // screen readers and as nothing by others.
          <span className="ml-1 text-ink-faint" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>

      {children({
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error !== undefined && error !== '' ? true : undefined,
        'aria-required': required ? true : undefined,
      })}

      {error !== undefined && error !== '' ? (
        // `role="alert"` so a field that becomes invalid after a submit says so
        // without the user going looking.
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}

      {hint !== undefined && hint !== '' ? (
        <p id={hintId} className="text-xs text-ink-faint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
