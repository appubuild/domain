// @vitest-environment jsdom
/** The spinner, and the one exemption it claims from reduced motion.
 *
 *  The interesting assertion is `data-motion="essential"`: the stylesheet stops
 *  every animation when the user asks it to, and the spinner is the single thing
 *  that must keep turning, because a still spinner reads as a hang rather than
 *  as restraint.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Spinner } from './Spinner';

describe('a spinner', () => {
  it('is decoration by default, because the thing holding it is what is busy', () => {
    render(<Spinner />);
    const svg = document.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('is exempted from reduced motion, on purpose', () => {
    render(<Spinner />);
    expect(document.querySelector('svg')?.getAttribute('data-motion')).toBe('essential');
  });

  it('takes a name when it stands alone, and becomes a status', () => {
    render(<Spinner label="Rendering" />);
    expect(screen.getByRole('status', { name: 'Rendering' })).toBeTruthy();
  });

  it('spins, which is the only thing it is for', () => {
    render(<Spinner />);
    // `getAttribute` rather than `.className`: on an SVG element `className` is
    // an `SVGAnimatedString`, and asking it for a substring is asking an object.
    expect(document.querySelector('svg')?.getAttribute('class')).toContain('animate-spin');
  });
});
