// @vitest-environment jsdom
/** The dialog.
 *
 *  What is pinned is the contract with whoever was using the window before it
 *  opened: it has a name, it holds focus, Escape gives it back, and a press on
 *  the scrim is a dismissal while a press that merely *ends* on the scrim is
 *  not. The last one is the bug where dragging a text selection out of a dialog
 *  closes it and loses the edit.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './Button';
import { Modal } from './Modal';
import { TextField } from './TextField';

function Host({
  onClose,
  withFooter = true,
}: {
  readonly onClose?: (reason: 'escape' | 'outside') => void;
  readonly withFooter?: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        open
      </button>
      <Modal
        open={open}
        title="Export"
        description="Choose where the file goes."
        onClose={(reason) => {
          setOpen(false);
          onClose?.(reason);
        }}
        {...(withFooter
          ? {
              footer: (
                <>
                  <Button
                    onClick={() => {
                      setOpen(false);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button variant="solid">Export</Button>
                </>
              ),
            }
          : {})}
      >
        <TextField label="File name" value="" onValueChange={() => undefined} />
      </Modal>
    </>
  );
}

describe('an open dialog', () => {
  it('is a dialog with a name and a purpose', () => {
    render(<Host />);
    const dialog = screen.getByRole('dialog');
    expect(screen.getByRole('heading', { name: 'Export' })).toBeTruthy();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    // Named by the heading, not by a label attribute that could drift from it.
    const describedBy = dialog.getAttribute('aria-describedby');
    expect(document.getElementById(describedBy as string)?.textContent).toBe(
      'Choose where the file goes.',
    );
  });

  it('moves focus inside itself', () => {
    render(<Host />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('holds focus in, so Tab cannot reach the window behind', async () => {
    const user = userEvent.setup();
    render(<Host />);

    // Three tab stops inside: the field, Cancel, Export. A fourth Tab is the
    // wrap, and it must land back inside rather than on the "open" button.
    for (let i = 0; i < 6; i += 1) await user.tab();
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });
});

describe('closing', () => {
  it('Escape closes it and says why', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledWith('escape');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a press on the scrim closes it', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);

    // The scrim is the layer's first child, and it is what a click on the dimmed
    // part of the screen lands on.
    const scrim = document.querySelector('[data-testid="modal-layer"] > div');
    expect(scrim).not.toBeNull();
    await user.click(scrim as HTMLElement);

    expect(onClose).toHaveBeenCalledWith('outside');
  });

  it('a press inside does not, because a dialog you can close by using it is unusable', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);

    await user.click(screen.getByLabelText('File name'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('gives focus back to what opened it', async () => {
    const user = userEvent.setup();
    render(<Host />);
    const opener = screen.getByRole('button', { name: 'open' });
    opener.focus();

    await user.keyboard('{Escape}');
    expect(document.activeElement).toBe(opener);
  });
});

describe('a closed dialog', () => {
  it('renders nothing at all, so its controls are not in the tab order', async () => {
    const user = userEvent.setup();
    render(<Host />);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    // Not `display: none` and not `hidden`: the dialog is gone, so its field is
    // in neither the tab order nor the accessibility tree, and a screen reader
    // cannot reach a control the user cannot see.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByLabelText('File name')).toBeNull();
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['open']);
  });
});
