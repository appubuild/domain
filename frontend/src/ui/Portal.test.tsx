// @vitest-environment jsdom
/** The portal, which is small and is the reason the overlays can exist.
 *
 *  Two properties: the children end up outside their parent in the DOM, and the
 *  node this component made is taken away with it. The second one is the leak —
 *  a portal that leaves its `div` behind adds one element to `<body>` for every
 *  modal the user has ever opened.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Panel } from './Panel';
import { Portal } from './Portal';

describe('a portal', () => {
  it('renders its children outside the element that renders it', () => {
    render(
      <Panel title="Host">
        <Portal>
          <p>floating</p>
        </Portal>
      </Panel>,
    );

    const floating = screen.getByText('floating');
    // Not inside the panel: an overlay inside a panel with `overflow: hidden` is
    // clipped, which is the whole reason this component exists.
    expect(floating.closest('section')).toBeNull();
    expect(document.body.contains(floating)).toBe(true);
  });

  it('cleans up the node it made', () => {
    const { unmount } = render(
      <Portal>
        <p>floating</p>
      </Portal>,
    );
    expect(document.querySelectorAll('[data-nova-portal]').length).toBe(1);

    unmount();
    expect(document.querySelectorAll('[data-nova-portal]').length).toBe(0);
  });

  it('leaves a container it was handed alone, because it did not make it', () => {
    const container = document.createElement('div');
    container.setAttribute('id', 'mine');
    document.body.append(container);

    const { unmount } = render(
      <Portal container={container}>
        <p>floating</p>
      </Portal>,
    );
    expect(container.querySelector('p')?.textContent).toBe('floating');

    unmount();
    // Still there: a container given from outside is not this component's to
    // remove, and a test that asserts on it must find it afterwards.
    expect(document.getElementById('mine')).not.toBeNull();
    container.remove();
  });
});
