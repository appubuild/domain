// @vitest-environment jsdom
/** The button.
 *
 *  Every test here is about a state, not a colour: a button that is busy says so
 *  in two channels, a button that is forbidden does not tell you it is busy, and
 *  a pressed button's name does not change underneath the person who pressed it.
 *  Those are the three things a hand-written button gets wrong, and none of them
 *  is visible in a screenshot.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './Button';

describe('a button', () => {
  it('is a button, and not a link that behaves like one', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' }).tagName).toBe('BUTTON');
  });

  it('does not submit the form it sits in unless it was asked to', () => {
    // The single most common bug in a dialog: a button without `type` submits
    // the form, closes the dialog and loses the edit.
    render(<Button>Cancel</Button>);
    expect(screen.getByRole('button').getAttribute('type')).toBe('button');
  });

  it('calls back when pressed', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);

    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('forwards a ref, because a dialog has to focus its default button', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>Save</Button>);
    expect(ref.current?.tagName).toBe('BUTTON');
    ref.current?.focus();
    expect(document.activeElement).toBe(ref.current);
  });

  it('takes extra classes last, so the caller wins by CSS order', () => {
    render(<Button className="w-full">Save</Button>);
    expect(screen.getByRole('button').className).toContain('w-full');
  });
});

describe('a disabled button', () => {
  it('does not call back', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Save
      </Button>,
    );

    await user.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('does not say it is busy, because it is not — it is forbidden', () => {
    render(<Button disabled>Save</Button>);
    // `aria-busy` on a merely disabled control tells a screen reader to wait for
    // something that is never going to finish.
    expect(screen.getByRole('button').getAttribute('aria-busy')).toBeNull();
  });
});

describe('a busy button', () => {
  it('says so, and refuses the press', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Export
      </Button>,
    );

    const button = screen.getByRole('button');
    expect(button.getAttribute('aria-busy')).toBe('true');
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('keeps its name while it works', () => {
    // The reason the spinner takes a slot beside the label rather than replacing
    // it: a button whose name changes mid-press is announced as a different
    // button to the person who pressed it.
    render(<Button loading>Export</Button>);
    expect(screen.getByRole('button', { name: 'Export' })).toBeTruthy();
  });

  it('shows the spinner without giving it a name of its own', () => {
    render(<Button loading>Export</Button>);
    // One announcement of the wait, from the button: `aria-busy` plus the label.
    expect(screen.queryByRole('status')).toBeNull();
    expect(document.querySelector('[data-motion="essential"]')).not.toBeNull();
  });
});

describe('a button with icons', () => {
  it('puts the icon beside the label, not in front of the reader', () => {
    render(<Button icon="plus">New</Button>);
    const button = screen.getByRole('button', { name: 'New' });
    expect(button.querySelector('[data-icon="plus"]')).not.toBeNull();
  });

  it('drops the trailing icon while busy, because a chevron and a spinner is a shrug', () => {
    render(
      <Button loading iconEnd="chevron-down">
        Export
      </Button>,
    );
    expect(document.querySelector('[data-icon="chevron-down"]')).toBeNull();
  });
});
