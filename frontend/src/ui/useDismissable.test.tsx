// @vitest-environment jsdom
/** The three behaviours every overlay shares: Escape, an outside press, and
 *  focus that comes back.
 *
 *  These are tested through a component rather than through the hooks directly,
 *  because what matters is the wiring — which listener, on what, in which
 *  phase — and a hook tested with `renderHook` would only prove the callbacks
 *  fire when called.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useDismissable, useFocusTrap } from './useDismissable';

function Harness({
  open = true,
  onDismiss,
  autoFocus = true,
}: {
  readonly open?: boolean;
  readonly onDismiss?: (reason: 'escape' | 'outside') => void;
  readonly autoFocus?: boolean;
}): React.JSX.Element {
  // State, not a ref — the component under test takes an element for exactly
  // this reason.
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  useDismissable({ open, onDismiss: onDismiss ?? (() => undefined), container: box });
  useFocusTrap({ open, container: box, autoFocus });
  return (
    <div>
      <button type="button">outside</button>
      <div ref={setBox} tabIndex={-1}>
        <button type="button">first</button>
        <button type="button">last</button>
      </div>
    </div>
  );
}

describe('Escape', () => {
  it('dismisses, and says why', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<Harness onDismiss={onDismiss} />);

    await user.keyboard('{Escape}');
    expect(onDismiss).toHaveBeenCalledWith('escape');
  });

  it('stops at the innermost overlay, so a menu inside a dialog closes only the menu', async () => {
    const user = userEvent.setup();
    const outer = vi.fn();
    const inner = vi.fn();

    // The outer listener is added first, as a dialog's would be; the inner one
    // second, as a menu's would be. Capture-phase listeners run in order of
    // registration, so the proof is that the inner one's `stopPropagation`
    // reaches the outer one at all.
    render(
      <div
        onKeyDownCapture={(event) => {
          if (event.defaultPrevented) outer('escape');
        }}
      >
        <Harness onDismiss={inner} />
      </div>,
    );

    await user.keyboard('{Escape}');
    expect(inner).toHaveBeenCalledWith('escape');
    expect(outer).not.toHaveBeenCalled();
  });

  it('is not heard while the overlay is closed', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<Harness open={false} onDismiss={onDismiss} />);

    await user.keyboard('{Escape}');
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe('a press outside', () => {
  it('dismisses', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<Harness onDismiss={onDismiss} />);

    await user.click(screen.getByRole('button', { name: 'outside' }));
    expect(onDismiss).toHaveBeenCalledWith('outside');
  });

  it('a press inside does not', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<Harness onDismiss={onDismiss} />);

    await user.click(screen.getByRole('button', { name: 'first' }));
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe('focus', () => {
  it('moves to the first control on open', () => {
    render(<Harness />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'first' }));
  });

  it('can be told not to, for an overlay that must not steal it', () => {
    render(<Harness autoFocus={false} />);
    expect(document.activeElement).toBe(document.body);
  });

  it('wraps from the last control to the first', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    screen.getByRole('button', { name: 'last' }).focus();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'first' }));
  });

  it('wraps backwards too, because Shift-Tab is the same journey', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    screen.getByRole('button', { name: 'first' }).focus();
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'last' }));
  });

  it('goes back where it came from on close — the half everybody forgets', () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'trigger';
    document.body.append(trigger);
    trigger.focus();

    const { unmount } = render(<Harness />);
    expect(document.activeElement).not.toBe(trigger);

    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
