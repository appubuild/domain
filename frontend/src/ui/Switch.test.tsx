// @vitest-environment jsdom
/** `Switch`: one setting that is on or off.
 *
 *  What is pinned here is the accessibility contract, because that is the part
 *  a hand-rolled `role="switch"` button gets wrong and the part nobody notices
 *  until a screen-reader user reports it:
 *
 *  * it is a real checkbox, so Space toggles it and the state is announced as
 *    a state rather than as a label that changed;
 *  * the label *is* the control's name, so clicking the row toggles it;
 *  * the drawn track is decoration and is never announced.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Switch } from './Switch';

/** A switch that really holds its state, for the tests that toggle it. */
function Harness({
  onCheckedChange,
  checked = false,
  hint,
  disabled,
}: {
  readonly onCheckedChange?: (checked: boolean) => void;
  readonly checked?: boolean;
  readonly hint?: string;
  readonly disabled?: boolean;
}): React.JSX.Element {
  const [on, setOn] = useState(checked);
  return (
    <Switch
      label="Decode from a proxy"
      checked={on}
      onCheckedChange={(next) => {
        setOn(next);
        onCheckedChange?.(next);
      }}
      {...(hint === undefined ? {} : { hint })}
      {...(disabled === undefined ? {} : { disabled })}
    />
  );
}

describe('a switch', () => {
  it('is a checkbox, found by its label', () => {
    render(<Harness />);
    const input = screen.getByLabelText<HTMLInputElement>('Decode from a proxy');
    expect(input.tagName).toBe('INPUT');
    expect(input.type).toBe('checkbox');
  });

  it('reports the state it was given', () => {
    render(<Harness checked />);
    expect(screen.getByLabelText<HTMLInputElement>('Decode from a proxy').checked).toBe(true);
  });

  it('hands the new state to the caller, not the event', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Harness onCheckedChange={onCheckedChange} />);

    await user.click(screen.getByLabelText('Decode from a proxy'));

    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('toggles from the keyboard, because it is a native control', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Harness onCheckedChange={onCheckedChange} />);

    await user.tab();
    await user.keyboard(' ');

    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('toggles when the row is clicked, not only the track', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Harness onCheckedChange={onCheckedChange} />);

    // The label text, not the sixteen-pixel track: a target the width of the
    // sentence is the difference between a switch you hit and one you miss.
    await user.click(screen.getByText('Decode from a proxy'));

    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('keeps the track it draws out of the accessibility tree', () => {
    render(<Harness />);
    // One control, not two: a second "graphic" in the tree is a control a
    // screen reader reads twice.
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
  });

  it('shows its hint under the row', () => {
    render(<Harness hint="Export ignores this." />);
    expect(screen.getByText('Export ignores this.')).toBeDefined();
  });

  it('refuses the press when it is disabled', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Harness onCheckedChange={onCheckedChange} disabled />);

    await user.click(screen.getByLabelText('Decode from a proxy'));

    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});
