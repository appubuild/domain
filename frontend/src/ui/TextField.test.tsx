// @vitest-environment jsdom
/** `TextField`: `Field`'s wiring on an `<input>`, plus the one decision of its
 *  own — the handler is handed a string.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { TextField } from './TextField';

function renderField(over: Partial<React.ComponentProps<typeof TextField>> = {}): void {
  render(<TextField label="Project name" value="" {...over} />);
}

/** A field that actually holds its state, for the tests that type into it.
 *
 *  `value=""` with no setter is an input that forgets every keystroke, which is
 *  the correct behaviour for a controlled component and the wrong setup for a
 *  test about typing.
 */
function Harness({
  onValueChange,
  onChange,
}: {
  readonly onValueChange?: (value: string) => void;
  readonly onChange?: React.ChangeEventHandler<HTMLInputElement>;
}): React.JSX.Element {
  const [value, setValue] = useState('');
  return (
    <TextField
      label="Project name"
      value={value}
      onValueChange={(next) => {
        setValue(next);
        onValueChange?.(next);
      }}
      {...(onChange ? { onChange } : {})}
    />
  );
}

describe('a text field', () => {
  it('is found by its label', () => {
    renderField();
    expect(screen.getByLabelText('Project name').tagName).toBe('INPUT');
  });

  it('hands the value to the caller rather than an event', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<Harness onValueChange={onValueChange} />);

    await user.type(screen.getByLabelText('Project name'), 'Holi');
    // One call per keystroke, each with the whole value — the caller holds the
    // state, so it must be given the value and not a delta.
    expect(onValueChange).toHaveBeenCalledTimes(4);
    expect(onValueChange).toHaveBeenLastCalledWith('Holi');
  });

  it('still offers the event, for a caller who needs the caret', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(event: React.ChangeEvent<HTMLInputElement>) => void>();
    render(<Harness onChange={onChange} />);

    await user.type(screen.getByLabelText('Project name'), 'a');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0]?.target).toBeInstanceOf(HTMLInputElement);
  });

  it('marks itself invalid by the border *and* by aria, because colour alone is not an error', () => {
    renderField({ error: 'A name is required' });
    const input = screen.getByLabelText('Project name');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.className).toContain('border-danger');
  });

  it('never sets `required` on the element, leaving the message to the caller', () => {
    // The browser's validation bubble cannot be styled, translated or placed.
    renderField({ required: true });
    // Matched by a pattern: the visible `*` is inside the label and hidden from
    // the accessible name, but it is still in the label's text.
    const input = screen.getByLabelText(/Project name/);
    expect(input.getAttribute('required')).toBeNull();
    expect(input.getAttribute('aria-required')).toBe('true');
  });

  it('forwards a ref, so a dialog can focus the first field', () => {
    const ref = createRef<HTMLInputElement>();
    renderField({ ref });
    ref.current?.focus();
    expect(document.activeElement).toBe(ref.current);
  });

  it('a disabled field cannot be typed into', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    renderField({ disabled: true, onValueChange });

    await user.type(screen.getByLabelText('Project name'), 'x');
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('keeps the attributes it did not choose to own', () => {
    renderField({ placeholder: 'Holiday 2026', autoComplete: 'off', maxLength: 40 });
    const input = screen.getByLabelText('Project name');
    expect(input.getAttribute('placeholder')).toBe('Holiday 2026');
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(input.getAttribute('maxlength')).toBe('40');
  });
});
