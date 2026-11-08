// @vitest-environment jsdom
/** The tooltip.
 *
 *  The property under test is that a tooltip is a *description*, not a layer: it
 *  does not exist until it is shown, it is pointed at by `aria-describedby`
 *  only while it is shown, and it answers the keyboard as well as the pointer.
 *  A tooltip that is in the DOM from the first render is read out by a screen
 *  reader on every pass, which is why the last test exists.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Button } from './Button';
import { Tooltip } from './Tooltip';

/** A tooltip that appears at once, so the test is about behaviour and not about
 *  waiting for the delay. The delay has its own test. */
function renderTooltip(): void {
  render(
    <Tooltip content="Export the timeline" delayMs={0}>
      <Button icon="download">Export</Button>
    </Tooltip>,
  );
}

describe('before anything happens', () => {
  it('is not in the document at all', () => {
    renderTooltip();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('does not describe the trigger, because there is nothing to describe it with', () => {
    renderTooltip();
    expect(screen.getByRole('button').getAttribute('aria-describedby')).toBeNull();
  });
});

describe('on hover', () => {
  it('appears', async () => {
    const user = userEvent.setup();
    renderTooltip();

    await user.hover(screen.getByRole('button'));
    expect(screen.getByRole('tooltip').textContent).toBe('Export the timeline');
  });

  it('describes the trigger while it is open', async () => {
    const user = userEvent.setup();
    renderTooltip();

    await user.hover(screen.getByRole('button'));
    const describedBy = screen.getByRole('button').getAttribute('aria-describedby');
    expect(describedBy).toBe(screen.getByRole('tooltip').getAttribute('id'));
  });

  it('goes away when the pointer leaves', async () => {
    const user = userEvent.setup();
    renderTooltip();

    await user.hover(screen.getByRole('button'));
    await user.unhover(screen.getByRole('button'));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});

describe('on the keyboard', () => {
  it('appears on focus, because a keyboard user has no pointer', async () => {
    const user = userEvent.setup();
    renderTooltip();

    await user.tab();
    expect(screen.getByRole('tooltip').textContent).toBe('Export the timeline');
  });

  it('goes away on blur', async () => {
    const user = userEvent.setup();
    renderTooltip();

    await user.tab();
    await user.tab();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('Escape dismisses it at once, and it does not come back', async () => {
    const user = userEvent.setup();
    renderTooltip();

    await user.tab();
    expect(screen.getByRole('tooltip')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).toBeNull();

    // The pointer never left, so a tooltip that only listened to pointer events
    // would reappear here — which is the bug this asserts against.
    await user.keyboard('{Shift}');
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});

describe('the delay', () => {
  it('waits before offering the description, so a toolbar does not flicker', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Export the timeline" delayMs={40}>
        <Button>Export</Button>
      </Tooltip>,
    );

    await user.hover(screen.getByRole('button'));
    expect(screen.queryByRole('tooltip')).toBeNull();

    await new Promise((resolve) => {
      setTimeout(resolve, 80);
    });
    expect(screen.queryByRole('tooltip')).not.toBeNull();
  });
});
