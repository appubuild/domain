// @vitest-environment jsdom
/** `Select`: `Field`'s wiring on a native `<select>`.
 *
 *  The tests are mostly about the one decision that is this component's own: a
 *  value with no matching option means *nothing chosen*, not *the first entry*.
 *  That is the difference between a settings panel that saves a setting the user
 *  never made and one that does not, and it is the bug every settings panel has
 *  shipped at least once.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Select, type SelectOption } from './Select';

const OPTIONS: readonly SelectOption[] = [
  { value: '2', label: 'Stereo' },
  { value: '6', label: '5.1' },
  { value: '8', label: '7.1' },
  { value: '4', label: 'Unavailable', disabled: true },
];

/** A select that really holds its choice, for the tests that choose one. */
function Harness({
  onValueChange,
  value = '2',
  placeholder,
}: {
  readonly onValueChange?: (value: string) => void;
  readonly value?: string;
  readonly placeholder?: string;
}): React.JSX.Element {
  const [chosen, setChosen] = useState(value);
  return (
    <Select
      label="Channels"
      options={OPTIONS}
      value={chosen}
      onValueChange={(next) => {
        setChosen(next);
        onValueChange?.(next);
      }}
      {...(placeholder === undefined ? {} : { placeholder })}
    />
  );
}

describe('a select', () => {
  it('is found by its label', () => {
    render(<Harness />);
    expect(screen.getByLabelText<HTMLSelectElement>('Channels').tagName).toBe('SELECT');
  });

  it('hands the value to the caller rather than an event', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<Harness onValueChange={onValueChange} />);

    await user.selectOptions(screen.getByLabelText('Channels'), '6');
    expect(onValueChange).toHaveBeenCalledWith('6');
  });

  it('shows the choice it was given', () => {
    render(<Harness value="6" />);
    expect(screen.getByLabelText<HTMLSelectElement>('Channels').value).toBe('6');
  });

  it('renders one option per choice, in order', () => {
    render(<Harness />);
    const labels = screen
      .getAllByRole('option')
      .map((option) => (option as HTMLOptionElement).textContent);
    expect(labels).toEqual(['Stereo', '5.1', '7.1', 'Unavailable']);
  });

  it('falls back to the value when an option has no label of its own', () => {
    render(<Select label="Rate" options={[{ value: '48000' }]} value="48000" />);
    expect(screen.getByRole('option').textContent).toBe('48000');
  });

  it('keeps an unavailable option visible but unchoosable', () => {
    render(<Harness />);
    const unavailable = screen.getByRole<HTMLOptionElement>('option', { name: 'Unavailable' });
    expect(unavailable.disabled).toBe(true);
  });
});

describe('a select with a value no option offers', () => {
  // The bug: a `<select>` handed a value it does not have selects its first
  // option and reports *that* as the value. A settings panel then posts a
  // setting the user never chose.
  it('says nothing is chosen rather than choosing the first option', () => {
    render(<Harness value="1" placeholder="Pick one" />);
    expect(screen.getByLabelText<HTMLSelectElement>('Channels').value).toBe('');
  });

  it('shows the placeholder, so the state is one the user can read', () => {
    render(<Harness value="1" placeholder="Pick one" />);
    expect(screen.getByRole('option', { name: 'Pick one' })).toBeDefined();
  });

  it('asks for nothing, and the browser answers with the first option', () => {
    // The honest limitation of a native select: with no empty option to paint,
    // `value=""` resolves to the first one, and there is no way to say "unset"
    // in the DOM. This is why `placeholder` exists, and why a panel whose
    // setting can be unset passes one — the component cannot invent the row.
    render(<Harness value="1" />);
    const select = screen.getByLabelText<HTMLSelectElement>('Channels');
    expect(select.selectedOptions).toHaveLength(1);
    expect(select.value).toBe('2');
  });
});

describe('a select and the field around it', () => {
  it('describes itself with its hint', () => {
    render(<Select label="Channels" options={OPTIONS} value="2" hint="What we mix" />);
    expect(screen.getByText('What we mix')).toBeDefined();
  });

  it('marks itself invalid when it carries an error', () => {
    render(<Select label="Channels" options={OPTIONS} value="2" error="Not at this rate" />);
    expect(screen.getByLabelText('Channels').getAttribute('aria-invalid')).toBe('true');
  });

  it('can hide its label without losing it', () => {
    render(<Select label="Channels" options={OPTIONS} value="2" labelHidden />);
    expect(screen.getByLabelText('Channels')).toBeDefined();
  });

  it('keeps the arrow decorative', () => {
    // The select's own name and state are what a screen reader reads; a second
    // announcement of "chevron" is noise.
    render(<Harness />);
    expect(screen.queryByRole('img', { hidden: true })).toBeNull();
  });
});
