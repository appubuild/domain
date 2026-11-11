// @vitest-environment jsdom
/** A menu attached to a button.
 *
 *  The hook is small and the failure it prevents is not: a menu whose trigger
 *  was read from a ref that was empty on the first commit dismisses itself the
 *  moment it opens, because the press that opened it looks like a press
 *  outside. So the two things tested are that the trigger is really held, and
 *  that the anchor is measured from it rather than from anywhere else.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Menu, type MenuItem } from './Menu';
import { useAnchoredMenu } from './useAnchoredMenu';

const ITEMS: readonly MenuItem[] = [
  { id: 'dark', label: 'Nova Dark' },
  { id: 'light', label: 'Nova Light' },
];

function MenuButton(): React.JSX.Element {
  const menu = useAnchoredMenu();
  return (
    <>
      <button type="button" {...menu.triggerProps}>
        Theme
      </button>
      <Menu
        open={menu.isOpen}
        anchor={menu.anchor}
        trigger={menu.trigger}
        label="Theme"
        items={ITEMS}
        onClose={menu.close}
      />
    </>
  );
}

/** jsdom has no layout, so the button says how big it is and where. */
function stubRect(element: HTMLElement, rect: Partial<DOMRect>): void {
  element.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    toJSON: () => ({}),
    ...rect,
  });
}

describe('a button with a menu', () => {
  it('says it has one, and whether it is showing', async () => {
    const user = userEvent.setup();
    render(<MenuButton />);
    const trigger = screen.getByRole('button', { name: 'Theme' });

    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('menu')).toBeNull();

    await user.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('menu', { name: 'Theme' })).toBeTruthy();
  });

  it('hangs the menu off the trigger, measured when it opens', async () => {
    const user = userEvent.setup();
    render(<MenuButton />);
    const trigger = screen.getByRole('button', { name: 'Theme' });
    stubRect(trigger, { left: 120, top: 8, width: 64, height: 24, bottom: 32 });

    await user.click(trigger);

    const menu = screen.getByRole('menu', { name: 'Theme' });
    // The trigger's bottom-left corner: a menu that opened anywhere else would
    // be a menu attached to the wrong thing.
    expect(menu.style.left).toBe('120px');
    expect(menu.style.top).toBe('32px');
  });

  it('opens and closes on the same button, because a press there is not a press outside', async () => {
    const user = userEvent.setup();
    render(<MenuButton />);
    const trigger = screen.getByRole('button', { name: 'Theme' });

    await user.click(trigger);
    await user.click(trigger);

    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes when the menu says it should, and says nothing about where', async () => {
    const user = userEvent.setup();
    render(<MenuButton />);

    await user.click(screen.getByRole('button', { name: 'Theme' }));
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).toBeNull();
    // Focus came back to the button: a menu that took focus with it when it
    // closed is a menu that moved the user somewhere they did not ask to go.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Theme' }));
  });
});
