// @vitest-environment jsdom
/** `Field`, which is the wiring every form forgets.
 *
 *  The tests are written from the accessibility tree outward — `getByLabelText`,
 *  `aria-describedby`, `aria-invalid` — because a field that looks right and
 *  is not wired is the one that ships.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Field, type FieldControlProps } from './Field';

function Control(props: { readonly hint?: string; readonly error?: string }): React.JSX.Element {
  // A stand-in for the input, so the test is about the wiring and not about
  // `TextField`'s choice of element.
  return (
    <Field
      label="Project name"
      {...(props.hint ? { hint: props.hint } : {})}
      {...(props.error ? { error: props.error } : {})}
    >
      {(control: FieldControlProps) => <input {...control} />}
    </Field>
  );
}

describe('a field', () => {
  it('ties the label to the control, so clicking the label focuses it', () => {
    render(<Control />);
    const input = screen.getByLabelText('Project name');
    expect(input.tagName).toBe('INPUT');

    const label = screen.getByText('Project name');
    expect(label.getAttribute('for')).toBe(input.getAttribute('id'));
  });

  it('gives two fields two ids, so a second one cannot steal the first’s label', () => {
    render(
      <>
        <Control />
        <Control />
      </>,
    );
    const [first, second] = screen.getAllByLabelText('Project name');
    expect(first?.getAttribute('id')).not.toBe(second?.getAttribute('id'));
  });
});

describe('a field with help', () => {
  it('points the control at the hint', () => {
    render(<Control hint="Shown in the title bar" />);
    const input = screen.getByLabelText('Project name');
    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).not.toBeNull();
    expect(document.getElementById(describedBy as string)?.textContent).toBe(
      'Shown in the title bar',
    );
  });

  it('does not mark the control invalid for having help', () => {
    render(<Control hint="Shown in the title bar" />);
    expect(screen.getByLabelText('Project name').getAttribute('aria-invalid')).toBeNull();
  });
});

describe('a field with an error', () => {
  it('marks the control invalid, so the state is not carried by colour alone', () => {
    render(<Control error="A name is required" />);
    expect(screen.getByLabelText('Project name').getAttribute('aria-invalid')).toBe('true');
  });

  it('announces the error, because it appeared after the user acted', () => {
    render(<Control error="A name is required" />);
    expect(screen.getByRole('alert').textContent).toBe('A name is required');
  });

  it('describes by the error first, then the hint', () => {
    render(<Control hint="Shown in the title bar" error="A name is required" />);
    const describedBy = screen.getByLabelText('Project name').getAttribute('aria-describedby');
    const [first, second] = (describedBy ?? '').split(' ');
    expect(document.getElementById(first as string)?.textContent).toBe('A name is required');
    expect(document.getElementById(second as string)?.textContent).toBe('Shown in the title bar');
  });

  it('an empty error is no error at all', () => {
    // `error=""` is what an untouched form holds, and it must not paint every
    // field red on first render.
    render(<Control error="" />);
    expect(screen.getByLabelText('Project name').getAttribute('aria-invalid')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('a field that hides its label', () => {
  it('keeps the label for assistive technology', () => {
    render(
      <Field label="Search" labelHidden>
        {(control) => <input {...control} />}
      </Field>,
    );
    // Still found by label: `sr-only` clips it, it does not remove it.
    expect(screen.getByLabelText('Search')).toBeTruthy();
    expect(screen.getByText('Search').className).toContain('sr-only');
  });
});
