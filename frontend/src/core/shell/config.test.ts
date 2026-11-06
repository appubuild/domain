/** `core/shell/config.ts` — how the window was started.
 *
 * One rule matters here and it is a security rule: **the session token leaves
 * the address bar**. The shell hands it over in the query string because that
 * is the only channel a pywebview window has before boot, and an address bar is
 * a thing people copy into chat. So reading it and removing it are the same
 * operation, never two.
 */

import { describe, expect, it } from 'vitest';
import { readRuntimeConfig, type ShellLocation } from './config';

function locationWith(search: string, path = '/'): ShellLocation & { replaced: string[] } {
  const replaced: string[] = [];
  return {
    search,
    path,
    replace: (url) => replaced.push(url),
    replaced,
  };
}

describe('a window the shell opened', () => {
  it('reads the token and takes it out of the url', () => {
    const location = locationWith('?nova_token=abc123');
    const config = readRuntimeConfig(location);

    expect(config.token).toBe('abc123');
    expect(location.replaced).toEqual(['/']);
  });

  it('keeps the parts of the url that are not the token', () => {
    const location = locationWith('?nova_token=abc123&project=p1');
    readRuntimeConfig(location);

    expect(location.replaced).toEqual(['/?project=p1']);
  });

  it('accepts the short form, because the shell is not the only client', () => {
    const config = readRuntimeConfig(locationWith('?token=abc123'));
    expect(config.token).toBe('abc123');
  });
});

describe('a window that started itself', () => {
  it('has no token and rewrites nothing', () => {
    const location = locationWith('');
    const config = readRuntimeConfig(location);

    expect(config.token).toBeUndefined();
    expect(location.replaced).toEqual([]);
  });

  it('does not mistake an empty token for a credential', () => {
    const location = locationWith('?nova_token=');
    const config = readRuntimeConfig(location);

    expect(config.token).toBeUndefined();
  });
});
