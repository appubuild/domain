// @vitest-environment jsdom
/** Toasts: the queue, and the place they are shown.
 *
 *  The queue is tested as data and the region as markup, because the two halves
 *  fail differently. A queue that lets a fourth toast in is a bug nobody sees in
 *  a single-toast test; a live region that mounts with its message is a bug
 *  nobody sees at all.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../core/i18n/I18nProvider';
import { Toaster } from './Toaster';
import {
  createToastQueue,
  MAX_VISIBLE_TOASTS,
  TOAST_DURATION_MS,
  type ToastInput,
  type ToastQueue,
} from './toast';

/** Raise one.
 *
 *  Deliberately not wrapped in `act`: the queue is updated from outside React by
 *  design — that is what lets a callback that has outlived an unmount raise a
 *  message — so the test waits for the region the way a user would, with
 *  `waitFor`, rather than pretending the update was synchronous.
 */
function raise(queue: ToastQueue, input: ToastInput): void {
  queue.push(input);
}

function renderToaster(): ReturnType<typeof createToastQueue> {
  const queue = createToastQueue();
  render(
    <I18nProvider>
      <Toaster queue={queue} />
    </I18nProvider>,
  );
  return queue;
}

describe('the queue', () => {
  it('hands back what it holds', () => {
    const queue = createToastQueue();
    expect(queue.current()).toEqual([]);

    queue.push({ message: 'Saved' });
    expect(queue.current().length).toBe(1);
    expect(queue.current()[0]?.message).toBe('Saved');
  });

  it('gives each toast its own id, so dismissing one leaves the others', () => {
    const queue = createToastQueue();
    const first = queue.push({ message: 'one' });
    const second = queue.push({ message: 'two' });

    expect(first).not.toBe(second);
    queue.dismiss(first);
    expect(queue.current().map((toast) => toast.message)).toEqual(['two']);
  });

  it('an unknown id is ignored rather than an error', () => {
    const queue = createToastQueue();
    queue.push({ message: 'Saved' });
    queue.dismiss('not-an-id');
    expect(queue.current().length).toBe(1);
  });

  it('keeps only the newest few, because a batch export would otherwise cover the window', () => {
    const queue = createToastQueue();
    for (let i = 0; i < MAX_VISIBLE_TOASTS + 2; i += 1) queue.push({ message: `toast ${i}` });

    expect(queue.current().length).toBe(MAX_VISIBLE_TOASTS);
    expect(queue.current()[0]?.message).toBe('toast 2');
  });

  it('tells its subscribers, and stops telling them once they leave', () => {
    const queue = createToastQueue();
    const listener = vi.fn();
    const off = queue.subscribe(listener);

    queue.push({ message: 'Saved' });
    expect(listener).toHaveBeenCalledTimes(1);

    off();
    queue.push({ message: 'Saved again' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('a failure stays until it is dismissed; a success does not', () => {
    const queue = createToastQueue();
    queue.push({ message: 'Export failed', kind: 'danger' });
    queue.push({ message: 'Saved', kind: 'success' });

    const [failure, success] = queue.current();
    // Zero is "stay", and it is the kind's decision rather than the caller's:
    // a user who missed an export failure missed their afternoon.
    expect(failure?.durationMs).toBe(0);
    expect(success?.durationMs).toBe(TOAST_DURATION_MS.success);
  });

  it('an explicit duration wins over the kind’s', () => {
    const queue = createToastQueue();
    queue.push({ message: 'Stay a while', durationMs: 12_000 });
    expect(queue.current()[0]?.durationMs).toBe(12_000);
  });
});

describe('the region', () => {
  it('exists before anything is in it, which is the only way a live region works', () => {
    renderToaster();
    // Present and empty: an `aria-live` region that mounts with its message is
    // a message that is never announced.
    expect(screen.getByTestId('toaster')).toBeTruthy();
    expect(screen.getByTestId('toaster').textContent).toBe('');
  });

  it('shows what is raised, in the order it was raised', async () => {
    const queue = renderToaster();
    raise(queue, { message: 'Rendering' });
    raise(queue, { message: 'Done' });

    await waitFor(() => {
      expect(screen.getByText('Rendering')).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByText('Done')).toBeTruthy();
    });
  });

  it('a routine message is a status; a failure is an alert', async () => {
    const queue = renderToaster();
    raise(queue, { message: 'Saved', kind: 'success' });
    raise(queue, { message: 'Export failed', kind: 'danger' });

    await waitFor(() => {
      expect(screen.getByRole('status')).toBeTruthy();
    });
    // Assertive without making the whole region assertive: "Saved" must not cut
    // off a sentence a screen reader is midway through.
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('dismisses itself when its time is up', async () => {
    const queue = renderToaster();
    raise(queue, { message: 'Saved', kind: 'success', durationMs: 20 });

    await waitFor(() => {
      expect(screen.getByText('Saved')).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.queryByText('Saved')).toBeNull();
    });
  });

  it('a failure waits to be dismissed, and its button is reachable', async () => {
    const user = userEvent.setup();
    const queue = renderToaster();
    raise(queue, { message: 'Export failed', kind: 'danger' });

    await waitFor(() => {
      expect(screen.getByText('Export failed')).toBeTruthy();
    });
    // The dismiss control is inside the announced toast, not in a parallel
    // `aria-hidden` copy — the bug a duplicated live region always has.
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => {
      expect(screen.queryByText('Export failed')).toBeNull();
    });
  });

  it('an action runs, and dismisses the toast it belongs to', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const queue = renderToaster();
    const input: ToastInput = {
      message: 'Export failed',
      kind: 'danger',
      action: { label: 'Retry', onSelect },
    };
    raise(queue, input);

    // Waited for rather than assumed: the queue is updated outside React, so
    // even inside `user.click`'s own act the row may not exist yet.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    });
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByText('Export failed')).toBeNull();
    });
  });
});
