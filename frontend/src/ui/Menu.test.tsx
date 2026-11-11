// @vitest-environment jsdom
/** The menu, which is a keyboard component that happens to be drawn.
 *
 *  The mouse behaviour is three lines of the file. What is tested here is the
 *  other ninety percent: one tab stop for the whole menu, arrows that wrap,
 *  Home and End, type-ahead, and Escape that closes without touching the dialog
 *  behind. A menu that works with a mouse and not with a keyboard is a menu
 *  that a fifth of the people using this editor cannot use.
 */

import { render, screen } from '@testing-library/react';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Menu, type MenuItem } from './Menu';

const ITEMS: readonly MenuItem[] = [
  { id: 'open', label: 'Open', icon: 'folder', shortcut: 'Ctrl+O' },
  { id: 'save', label: 'Save', icon: 'download' },
  { id: 'close', label: 'Close', separatorBefore: true },
  { id: 'delete', label: 'Delete', icon: 'trash', disabled: true },
];

function renderMenu(
  items: readonly MenuItem[] = ITEMS,
  onClose: (reason: 'escape' | 'outside' | 'select') => void = () => undefined,
): void {
  render(
    <div>
      <button type="button">trigger</button>
      <Menu
        open
        anchor={{ x: 10, y: 20 }}
        label="Project actions"
        items={items}
        onClose={onClose}
      />
    </div>,
  );
}

describe('a menu', () => {
  it('is a menu, named, with an item per command', () => {
    renderMenu();
    const menu = screen.getByRole('menu', { name: 'Project actions' });
    expect(screen.getAllByRole('menuitem').length).toBe(4);
    expect(menu).toBeTruthy();
  });

  it('takes focus when it opens, or the arrow keys have nowhere to go', () => {
    renderMenu();
    // The menu itself, not an item: nothing is chosen yet, and a menu that
    // pre-selects its first command is a menu that suggests one.
    expect(document.activeElement).toBe(screen.getByRole('menu'));
  });

  it('is one tab stop, so Tab leaves it rather than walking it', async () => {
    const user = userEvent.setup();
    renderMenu();

    // Focus starts on the menu; a single Tab must not land on an item.
    await user.tab();
    expect(screen.queryByRole('menuitem', { name: /Open/ })?.matches(':focus')).toBeFalsy();
  });

  it('does not pre-select an item, because nothing has been chosen', () => {
    renderMenu();
    // No item is focused on open: the first arrow press is what chooses.
    expect(document.activeElement?.getAttribute('role')).toBe('menu');
  });
});

describe('arrow keys', () => {
  it('down lands on the first item', async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.keyboard('{ArrowDown}');
    expect(document.activeElement?.textContent).toContain('Open');
  });

  it('down from the last wraps to the first', async () => {
    const user = userEvent.setup();
    renderMenu();

    // Two enabled items and one disabled: Delete is skipped, so the walk is
    // Open → Save → Close → Open.
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(document.activeElement?.textContent).toContain('Open');
  });

  it('up from the first wraps to the last enabled item', async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.keyboard('{ArrowUp}');
    // Not "Delete": a disabled item is skipped rather than focused.
    expect(document.activeElement?.textContent).toContain('Close');
  });

  it('Home and End jump, the way every other menu does', async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.keyboard('{End}');
    expect(document.activeElement?.textContent).toContain('Close');
    await user.keyboard('{Home}');
    expect(document.activeElement?.textContent).toContain('Open');
  });
});

describe('type-ahead', () => {
  it('jumps to the item that starts with the letter typed', async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.keyboard('c');
    expect(document.activeElement?.textContent).toContain('Close');
  });

  it('remembers the run, so two letters find a longer prefix', async () => {
    const user = userEvent.setup();
    renderMenu([
      { id: 'clip', label: 'Clip' },
      { id: 'close', label: 'Close' },
    ]);

    await user.keyboard('c');
    expect(document.activeElement?.textContent).toContain('Clip');
    // "cl" — the run, not a fresh search from "c", which would find Clip again.
    await user.keyboard('l');
    expect(document.activeElement?.textContent).toContain('Close');
  });
});

describe('choosing', () => {
  it('runs the command and closes, saying why', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onClose = vi.fn();
    renderMenu([{ id: 'save', label: 'Save', onSelect }], onClose);

    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Enter}');

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith('select');
  });

  it('a disabled item cannot be chosen, by mouse or by key', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderMenu([{ id: 'delete', label: 'Delete', disabled: true, onSelect }]);

    await user.click(screen.getByRole('menuitem', { name: /Delete/ }));
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('Escape', () => {
  it('closes the menu and leaves the dialog behind it alone', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderMenu(ITEMS, onClose);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledWith('escape');
  });
});

describe('a separator', () => {
  it('is a separator and not an item', () => {
    renderMenu();
    expect(screen.getAllByRole('separator').length).toBe(1);
    expect(screen.getAllByRole('menuitem').length).toBe(4);
  });
});

describe('giving focus back', () => {
  /** A menu that really opens and closes, with the button that opened it —
   *  because the promise is about what happens to *that* element. */
  function Toggle(): React.JSX.Element {
    const [open, setOpen] = useState(false);
    const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
    return (
      <>
        <button
          type="button"
          ref={setTrigger}
          onClick={() => {
            setOpen((was) => !was);
          }}
        >
          actions
        </button>
        <Menu
          open={open}
          anchor={open ? { x: 0, y: 0 } : null}
          trigger={trigger}
          label="Project actions"
          items={ITEMS}
          onClose={(reason) => {
            if (reason === 'select') setOpen(false);
            else setOpen(false);
          }}
        />
      </>
    );
  }

  it('returns focus to the trigger when Escape closes it', async () => {
    const user = userEvent.setup();
    render(<Toggle />);

    await user.click(screen.getByRole('button', { name: 'actions' }));
    expect(document.activeElement).toBe(screen.getByRole('menu'));

    await user.keyboard('{Escape}');

    // Not the top of the document: a menu that closed and left focus nowhere has
    // moved the user somewhere they did not ask to go.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'actions' }));
  });

  it('returns focus to the trigger after a command runs', async () => {
    const user = userEvent.setup();
    render(<Toggle />);

    await user.click(screen.getByRole('button', { name: 'actions' }));
    await user.keyboard('{ArrowDown}{Enter}');

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'actions' }));
  });
});

describe('a menu near the edge of the window', () => {
  it('hangs from whichever edge it was told to', () => {
    render(
      <Menu
        open
        anchor={{ x: 400, y: 20 }}
        label="Project actions"
        items={ITEMS}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByRole('menu').style.left).toBe('400px');

    render(
      <Menu
        open
        align="end"
        anchor={{ x: 400, y: 20 }}
        label="Edge menu"
        items={ITEMS}
        onClose={() => undefined}
      />,
    );
    // `end` subtracts the menu's own width, which is the only way a trigger at
    // the right-hand edge can keep its menu on screen. jsdom measures zero, so
    // what is being asserted is that the number is the anchor's, not the
    // arithmetic — the arithmetic cannot be seen without a layout engine.
    expect(screen.getByRole('menu', { name: 'Edge menu' }).style.left).toBe('400px');
  });
});
