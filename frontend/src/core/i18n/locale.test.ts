/** Choosing a starting language from what the platform says.
 *
 *  Small module, small suite, and the second test is the one that matters: a
 *  host that answers nothing — a WebView with no locale plumbing, a test
 *  environment — must still get a language, because falling through to "no
 *  bundle" is falling through to a screen full of keys.
 */

import { describe, expect, it } from 'vitest';

import { platformLocales, preferredLocale } from './locale';

describe('the platform’s preference list', () => {
  it('is empty rather than throwing where there is no navigator', () => {
    // A node test has no `navigator`, and asking one for a language should be an
    // absence, not a crash during boot.
    expect(Array.isArray(platformLocales())).toBe(true);
  });
});

describe('the preferred locale', () => {
  it('is the first tag the platform offers', () => {
    expect(preferredLocale('en', ['bn-BD', 'en-US'])).toBe('bn-BD');
  });

  it('is the fallback when the platform offers nothing', () => {
    expect(preferredLocale('en', [])).toBe('en');
    expect(preferredLocale('bn', [])).toBe('bn');
  });

  it('skips a tag that is not a tag, rather than looking it up and missing', () => {
    expect(preferredLocale('en', ['', '  ', 'bn'])).toBe('bn');
    expect(preferredLocale('en', ['not a locale!', 'en-GB'])).toBe('en-GB');
  });

  it('keeps a region, so a bundle can be found by language when it must be', () => {
    expect(preferredLocale('en', ['de-DE-1901'])).toBe('de-DE-1901');
  });
});
