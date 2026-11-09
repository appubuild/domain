// @vitest-environment jsdom
/** The popover: an anchored panel that does not take the window hostage.
 *
 *  The difference from `Modal` is the whole test: focus is *not* trapped, Tab
 *  walks straight out of it, and closing it gives focus back to the trigger.
 *  A popover that trapped focus would be a dialog without the decency to look
 *  like one.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './Button';
import { Popover, type PopoverAnchor } from './Popover';

const ANCHOR: PopoverAnchor = { x: 40, y: 60, width: 120, height: 32 };

function Host({
  onClose,
  placement,
}: {
  readonly onClose?: (reason: 'escape' | 'outside') => void;
  readonly placement?: 'bottom' | 'top';
} = {}): React.JSX.Element {
  const [open, setOpen] = useState(true);
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  return (
    <>
      <Button
        ref={setTrigger}
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        trigger
      </Button>
      <Popover
        open={open}
        anchor={ANCHOR}
        trigger={trigger}
        {...(placement ? { placement } : {})}
        onClose={(reason) => {
          setOpen(false);
          onClose?.(reason);
        }}
      >
        <Button>inside</Button>
      </Popover>
    </>
  );
}

describe('an open popover', () => {
  it('is anchored where it was told, and says which way it faces', () => {
    render(<Host />);
    const panel = screen.getByText('inside').closest('[data-placement]');
    expect(panel?.getAttribute('data-placement')).toBe('bottom');
    // Fixed positioning against the viewport, from a rect the caller measured:
    // a popover inside a panel with `overflow: hidden` is clipped, so it cannot
    // be positioned by nesting.
    expect((panel as HTMLElement).style.left).toBe('40px');
    expect((panel as HTMLElement).style.top).toBe('92px');
  });

  it('does not steal focus, because it is not an interruption', () => {
    render(<Host />);
    expect(document.activeElement).toBe(document.body);
  });

  it('lets Tab walk out of it, unlike a dialog', async () => {
    const user = userEvent.setup();
    render(<Host />);

    const inside = screen.getByRole('button', { name: 'inside' });
    inside.focus();
    await user.tab();
    // Not trapped: focus left the popover. Where it lands is the browser's
    // business — at the end of the document it is the window itself — but a
    // modal-like trap would have kept it here.
    expect(document.activeElement).not.toBe(inside);
  });
});

describe('closing', () => {
  it('Escape closes it and gives focus back to the trigger', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledWith('escape');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'trigger' }));
  });

  it('a press outside closes it', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'trigger' }));
    // A press on the trigger is *not* an outside press: it toggles, and a
    // popover that closed and reopened in one event would flicker.
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a press on the page closes it', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <>
        <button type="button">elsewhere</button>
        <Host onClose={onClose} />
      </>,
    );

    await user.click(screen.getByRole('button', { name: 'elsewhere' }));
    expect(onClose).toHaveBeenCalledWith('outside');
  });

  it('renders nothing when it is closed', async () => {
    const user = userEvent.setup();
    render(<Host />);

    await user.keyboard('{Escape}');
    expect(screen.queryByText('inside')).toBeNull();
  });
});

describe('placement', () => {
  it('above the anchor when asked', () => {
    render(<Host placement="top" />);
    const panel = screen.getByText('inside').closest('[data-placement]');
    expect(panel?.getAttribute('data-placement')).toBe('top');
    expect((panel as HTMLElement).style.top).toBe('60px');
  });
});
