/** Where the one socket lives, and how the token gets there.
 *
 *  A browser cannot set a header on a WebSocket handshake, so the session token
 *  travels in the query string (`auth.py`). That is the same token the REST
 *  calls send as `Authorization`, and it is the reason this helper exists
 *  rather than a template string: a URL built by hand is a URL that forgets the
 *  token one day, and a socket that cannot authenticate is a socket that closes
 *  with no explanation.
 */

/** The path the service exposes for the event socket (`api.md` §6). */
export const EVENTS_PATH = '/api/v1/ws';

/** Build the socket URL for an origin.
 *
 *  `wss:` for a page served over https and `ws:` otherwise, because a page
 *  served securely is not allowed to open an insecure socket, and a page served
 *  over http has no secure one to open.
 *
 *  An empty origin means *this page's own origin* — which is the desktop case,
 *  where the service serves the window — and the answer is then a relative URL,
 *  because that is the one form that is right in every environment and needs no
 *  knowledge of how the page was delivered.
 */
export function eventSocketUrl(origin: string, token?: string): string {
  const query = token === undefined || token === '' ? '' : `?token=${encodeURIComponent(token)}`;
  const base = origin || (typeof window === 'undefined' ? '' : window.location.origin);
  if (base === '') return `${EVENTS_PATH}${query}`;

  // An opaque origin — a sandboxed frame, a `file:` page — reports itself as
  // "null", which is not something a URL can be built from. Relative is the
  // honest answer there too: it will not work, and neither would anything else.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(base)) return `${EVENTS_PATH}${query}`;

  const url = new URL(EVENTS_PATH, base.endsWith('/') ? base : `${base}/`);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  if (query !== '') url.search = query;
  return url.toString();
}
