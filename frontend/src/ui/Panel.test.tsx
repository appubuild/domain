// @vitest-environment jsdom
/** The panel: the surface the dock tree will be made of.
 *
 *  The assertions are structural — a heading that is a heading, a body that is
 *  separate from it — because the reason `Panel` exists is that six panels side
 *  by side have to agree about their own chrome, and a screenshot cannot say
 *  that a title is an `h2`.
 */

import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';

import { IconButton } from './IconButton';
import { Panel } from './Panel';

describe('a panel with a title', () => {
  it('puts the title in a heading, so a screen reader can move between panels', () => {
    render(<Panel title="Media">body</Panel>);
    const heading = screen.getByRole('heading', { name: 'Media' });
    expect(heading.tagName).toBe('H2');
  });

  it('takes a level, because a panel inside a panel is a subsection', () => {
    render(
      <Panel title="Colour" headingLevel={3}>
        body
      </Panel>,
    );
    expect(screen.getByRole('heading', { name: 'Colour' }).tagName).toBe('H3');
  });

  it('keeps the header out of the scrolling body', () => {
    render(<Panel title="Media">body</Panel>);
    const heading = screen.getByRole('heading', { name: 'Media' });
    const scroller = heading.parentElement?.nextElementSibling;
    expect(scroller?.className).toContain('overflow-y-auto');
    expect(scroller?.textContent).toBe('body');
  });

  it('puts the actions beside the title and not inside the body', () => {
    render(
      <Panel title="Media" actions={<IconButton icon="plus" label="Import media" />}>
        body
      </Panel>,
    );
    const button = screen.getByRole('button', { name: 'Import media' });
    expect(button.closest('header')).not.toBeNull();
  });
});

describe('a panel with no title', () => {
  it('has no header, and says nothing about a heading it does not have', () => {
    const { container } = render(<Panel>body</Panel>);
    expect(container.querySelector('header')).toBeNull();
    expect(screen.queryByRole('heading')).toBeNull();
  });
});

describe('a panel that must not scroll', () => {
  it('does not clip its contents by growing past the window instead', () => {
    render(<Panel scroll={false}>body</Panel>);
    // No scroll container: the caller has docked this where the space is known.
    expect(document.querySelector('.overflow-y-auto')).toBeNull();
  });
});

describe('a panel as an element', () => {
  it('is a section, and forwards a ref so a splitter can measure it', () => {
    const ref = createRef<HTMLElement>();
    render(<Panel ref={ref}>body</Panel>);
    expect(ref.current?.tagName).toBe('SECTION');
  });
});
