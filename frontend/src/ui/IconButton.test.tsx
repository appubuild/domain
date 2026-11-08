// @vitest-environment jsdom
/** The icon button, whose whole reason for existing is the label.
 *
 *  `label` is a required prop, so the type system prevents the omission; what is
 *  tested here is that the requirement is *honoured* — that the name reaches the
 *  accessibility tree and the icon does not, and that a busy icon button is
 *  still the button it was.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { IconButton } from './IconButton';

describe('an icon button', () => {
  it('is named by its label, because it has no text to be named by', () => {
    render(<IconButton icon="close" label="Close project" />);
    expect(screen.getByRole('button', { name: 'Close project' })).toBeTruthy();
  });

  it('hides the drawing, which would otherwise be announced as nothing', () => {
    render(<IconButton icon="close" label="Close project" />);
    expect(document.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('calls back when pressed', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<IconButton icon="trash" label="Delete" onClick={onClick} />);

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('a busy one keeps its name and says it is busy', () => {
    render(<IconButton icon="download" label="Export" loading />);
    const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Export' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.disabled).toBe(true);
  });

  it('a disabled one is not described as busy', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<IconButton icon="trash" label="Delete" disabled onClick={onClick} />);

    await user.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByRole('button').getAttribute('aria-busy')).toBeNull();
  });
});
