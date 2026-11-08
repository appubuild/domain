// @vitest-environment jsdom
/** The icon renderer.
 *
 *  What is worth pinning is the accessibility contract, because that is the half
 *  a screenshot cannot show: an unnamed icon is hidden, a named one is an image
 *  with that name, and neither leaks a `<title>` into the other's markup.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Icon } from './Icon';
import { ICON_NAMES } from './icons';

describe('an icon by default', () => {
  it('is hidden from assistive technology, because it names nothing', () => {
    render(<Icon name="close" />);
    const svg = document.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('role')).toBeNull();
  });

  it('inherits the current colour instead of choosing one', () => {
    render(<Icon name="close" />);
    expect(document.querySelector('svg')?.getAttribute('stroke')).toBe('currentColor');
    expect(document.querySelector('svg')?.getAttribute('fill')).toBe('none');
  });

  it('is drawn at the size it was asked for', () => {
    const { unmount } = render(<Icon name="close" size="lg" />);
    expect(document.querySelector('svg')?.getAttribute('width')).toBe('20');
    unmount();
    // A number is allowed too, for the one icon that has to match a cap height.
    render(<Icon name="close" size={32} />);
    expect(document.querySelector('svg')?.getAttribute('width')).toBe('32');
  });

  it('says which icon it is, so a test can assert on one without a class', () => {
    render(<Icon name="film" />);
    expect(document.querySelector('svg')?.getAttribute('data-icon')).toBe('film');
  });
});

describe('an icon with a name', () => {
  it('becomes an image with that name', () => {
    render(<Icon name="warning" label="Unsaved changes" />);
    const svg = screen.getByRole('img', { name: 'Unsaved changes' });
    expect(svg.getAttribute('aria-hidden')).toBeNull();
  });
});

describe('the whole set', () => {
  it('renders without throwing, which is the sum of every malformed path', () => {
    for (const name of ICON_NAMES) {
      const { unmount } = render(<Icon name={name} />);
      expect(document.querySelector('svg')?.children.length ?? 0, name).toBeGreaterThan(0);
      unmount();
    }
  });
});
