// @vitest-environment jsdom
/** The provider: the queue a tree raises into, and the place it is shown.
 *
 *  Tested here and not in `Toaster.test.tsx`, because what is being pinned is
 *  the seam and not the markup: that a component anywhere in the tree can reach
 *  the queue, that a test can hold the same queue and drive it from outside
 *  React, and that a component with no provider fails loudly instead of raising
 *  a message nobody will ever see.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../core/i18n/I18nProvider';
import { type ToastQueue, createToastQueue } from './toast';
import { ToastProvider } from './ToastProvider';
import { useToastQueue } from './toast-context';

/** Push from outside React, which is the point of the store: a callback whose
 *  component is long gone can still say something. */
function raise(queue: ToastQueue, input: Parameters<ToastQueue['push']>[0]): string {
  return queue.push(input);
}

describe('the provider', () => {
  it('makes a queue when it was not given one', async () => {
    function Raise(): React.JSX.Element {
      const queue = useToastQueue();
      return (
        <button
          type="button"
          onClick={() => {
            queue.push({ message: 'From the tree' });
          }}
        >
          raise
        </button>
      );
    }
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <ToastProvider>
          <Raise />
        </ToastProvider>
      </I18nProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'raise' }));
    await waitFor(() => {
      expect(screen.getByText('From the tree')).toBeTruthy();
    });
  });

  it('uses the queue it was given, so a test can hold it too', async () => {
    const queue = createToastQueue();
    render(
      <I18nProvider>
        <ToastProvider queue={queue}>
          <span />
        </ToastProvider>
      </I18nProvider>,
    );

    raise(queue, { message: 'From outside' });
    await waitFor(() => {
      expect(screen.getByText('From outside')).toBeTruthy();
    });
    // The caller holds the queue, which is the point: anything with it can raise
    // a message, including a callback whose component is long gone.
    expect(queue.current().length).toBe(1);
  });

  it('a component with no provider fails loudly rather than raising into nowhere', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function Orphan(): React.JSX.Element {
      useToastQueue();
      return <span />;
    }
    expect(() => render(<Orphan />)).toThrow(/no ToastQueue in context/);
    spy.mockRestore();
  });
});
