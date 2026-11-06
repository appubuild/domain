/** How this window was started, read once at boot.
 *
 * The desktop shell starts the Python service itself and then opens the window
 * with the session token in the query string (`ARCHITECTURE.md` §11). That
 * token is a bearer credential, so it is **consumed once**: read it, then take
 * it out of the address bar, because an address bar is a thing users copy and
 * paste into chat windows.
 *
 * In development there is no shell, so the Vite proxy answers same-origin and
 * `VITE_API_BASE` can point the app somewhere else entirely.
 */

export interface RuntimeConfig {
  /** Where the service is; empty means same-origin. */
  readonly baseUrl: string;
  /** The session token, when this window was handed one. */
  readonly token?: string;
}

export interface ShellLocation {
  readonly search: string;
  /** Path and hash, which the rewritten URL has to preserve. */
  readonly path: string;
  /** Replace the URL without reloading — how the token leaves the address bar. */
  readonly replace: (url: string) => void;
}

/** Read the config, and take the token out of the URL while doing so. */
export function readRuntimeConfig(location: ShellLocation = windowLocation()): RuntimeConfig {
  const query = new URLSearchParams(location.search);
  const token = query.get('nova_token') ?? query.get('token') ?? undefined;
  if (token !== undefined) {
    query.delete('nova_token');
    query.delete('token');
    const rest = query.toString();
    location.replace(`${location.path}${rest ? `?${rest}` : ''}`);
  }
  const baseUrl: string = String(import.meta.env['VITE_API_BASE'] ?? '');
  return {
    baseUrl,
    ...(token !== undefined && token !== '' ? { token } : {}),
  };
}

function windowLocation(): ShellLocation {
  const { location } = window;
  return {
    search: location.search,
    path: `${location.pathname}${location.hash}`,
    replace: (url) => {
      window.history.replaceState(null, '', url);
    },
  };
}
