/** The socket URL.
 *
 *  Three things matter, and each one is a bug the other way:
 *
 *  * **The scheme follows the page.** A page served over https that opens a
 *    `ws:` socket is refused by the browser, and the refusal names neither the
 *    page nor the socket.
 *  * **The token is in the query string**, because a browser cannot set a header
 *    on a handshake — and it is escaped, because a token is a random string that
 *    happens to be URL-safe today.
 *  * **No origin means a relative URL**, which is what the desktop case wants:
 *    the service serves the window, so the socket is on the page's own origin
 *    and there is nothing to name.
 */

import { describe, expect, it } from 'vitest';

import { EVENTS_PATH, eventSocketUrl } from './url';

describe('with an origin', () => {
  it('an http page opens an insecure socket', () => {
    expect(eventSocketUrl('http://127.0.0.1:8765')).toBe('ws://127.0.0.1:8765/api/v1/ws');
  });

  it('an https page opens a secure one', () => {
    expect(eventSocketUrl('https://nova.example')).toBe('wss://nova.example/api/v1/ws');
  });

  it('a trailing slash does not produce a double one', () => {
    expect(eventSocketUrl('http://127.0.0.1:8765/')).toBe('ws://127.0.0.1:8765/api/v1/ws');
  });

  it('the token travels in the query string', () => {
    expect(eventSocketUrl('http://127.0.0.1:8765', 'abc123')).toBe(
      'ws://127.0.0.1:8765/api/v1/ws?token=abc123',
    );
  });

  it('a token is escaped rather than trusted', () => {
    expect(eventSocketUrl('http://127.0.0.1:8765', 'a b&c')).toBe(
      'ws://127.0.0.1:8765/api/v1/ws?token=a%20b%26c',
    );
  });

  it('an empty token is no token, not an empty one', () => {
    expect(eventSocketUrl('http://127.0.0.1:8765', '')).toBe('ws://127.0.0.1:8765/api/v1/ws');
  });
});

describe('without an origin', () => {
  it('the answer is relative, so it works wherever the page came from', () => {
    // No `window` in a node test: the relative form is the only correct one
    // when neither an origin nor a page was named.
    expect(eventSocketUrl('')).toBe(EVENTS_PATH);
  });

  it('a token rides along in the relative form too', () => {
    expect(eventSocketUrl('', 'abc123')).toBe('/api/v1/ws?token=abc123');
  });

  it('an opaque origin — a sandboxed frame, a file page — is relative, not a crash', () => {
    // Such a page reports its origin as "null", which is not a base a URL can
    // be built from. Falling back is better than throwing inside a constructor
    // during render.
    expect(eventSocketUrl('null')).toBe(EVENTS_PATH);
  });
});
