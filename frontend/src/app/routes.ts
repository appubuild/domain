/** Which screen the window is showing, as data.
 *
 *  The address is a string, and what it *means* is a pure function of that
 *  string — so that is a question a test can ask without a window, a document or
 *  a click. The component that listens for the address is `router.tsx`; this
 *  file is the part of it that is true everywhere.
 *
 *  A hash and not a path, because there is no server to rewrite a URL for us:
 *  the packaged app is a file on disk, and the hash is the part of an address
 *  that survives being one.
 */

export type Route =
  { readonly name: 'home' } | { readonly name: 'editor'; readonly projectId: string };

export const HOME: Route = { name: 'home' };

/** What an address means. Everything unrecognised is the home screen: a
 *  hand-edited hash, a bookmark from a build that arranged things differently,
 *  a project id that has since been closed — none of them is an error worth
 *  showing. */
export function parseRoute(hash: string): Route {
  const path = (hash.replace(/^#/, '').split('?')[0] ?? '').replace(/^\//, '');
  const [head, id] = path.split('/');
  if (head === 'editor' && id !== undefined && id !== '') {
    return { name: 'editor', projectId: safeDecode(id) };
  }
  return HOME;
}

/** The address for a route, for a link and for the address bar. */
export function routeHref(route: Route): string {
  return route.name === 'editor' ? `#/editor/${encodeURIComponent(route.projectId)}` : '#/';
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // A hand-edited hash can carry a `%` that is not an escape. The id is then
    // nonsense, and nonsense is still a route — the shell is what decides that
    // no such project is open.
    return value;
  }
}
