import { readFileSync } from 'node:fs';
import type { ClientRequest } from 'node:http';
import { defineConfig } from 'vitest/config';
import type { ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

/** Where the Python service is listening during development.
 *
 *  `make dev` binds it to a known port; the desktop shell starts the service
 *  itself and serves the built frontend from it, so the app is same-origin in
 *  production and needs no proxy at all. In dev the two are separate
 *  processes, and a Vite proxy is what keeps the app's relative URLs honest —
 *  a frontend that hard-codes an origin is a frontend that cannot be served
 *  from anywhere else.
 */
const API_ORIGIN = process.env['NOVA_API_ORIGIN'] ?? 'http://127.0.0.1:8765';

/** Where `nova-studio serve --endpoint-file` wrote the endpoint.
 *
 *  The service hands out a fresh 256-bit session token per launch (ADR-0005
 *  §4) and refuses anything without one. In production the shell puts that
 *  token in the window's URL, where the app reads it and takes it out again
 *  (`core/shell/config.ts`). A dev server has no shell, so **the proxy is the
 *  shell's stand-in**: it is the one thing here that can read the file, and it
 *  attaches the token on the way through. The app itself stays unaware that
 *  development is different — which is the point.
 */
const ENDPOINT_FILE =
  process.env['NOVA_ENDPOINT_FILE'] ??
  // Relative to this file, not to the shell that started it: `make dev` runs
  // Vite from `frontend/`, and a path that only resolved from the repository
  // root would work for exactly one of the two ways to start it.
  fileURLToPath(new URL('../.nova/dev-endpoint.json', import.meta.url));

/** The token from the endpoint file, or `undefined` when there is none yet.
 *
 *  Read per request rather than once at startup: `make dev` starts the service
 *  and this server together, and the file may not exist for the first few
 *  hundred milliseconds. It is one small read on a developer's machine, and a
 *  missing token is a 401 the app can explain, not a crash.
 */
function sessionToken(): string | undefined {
  try {
    const endpoint: unknown = JSON.parse(readFileSync(ENDPOINT_FILE, 'utf8'));
    if (typeof endpoint !== 'object' || endpoint === null) return undefined;
    const token = (endpoint as { token?: unknown }).token;
    return typeof token === 'string' ? token : undefined;
  } catch {
    return undefined;
  }
}

/** Add the token to one proxied request: a header for HTTP, a query parameter
 *  for the WebSocket, because a browser cannot set a header on a handshake. */
function authorise(proxyReq: ClientRequest): void {
  const token = sessionToken();
  if (token === undefined) return;
  if (proxyReq.path.startsWith('/ws')) {
    proxyReq.path += proxyReq.path.includes('?') ? `&token=${token}` : `?token=${token}`;
    return;
  }
  proxyReq.setHeader('Authorization', `Bearer ${token}`);
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    strictPort: true,
    proxy: {
      '/api': serviceProxy({}),
      '/ws': serviceProxy({ ws: true }),
      // Unauthenticated by design: it is the one endpoint the shell polls
      // before it has a token anywhere to keep one.
      '/healthz': serviceProxy({}),
    },
    // The bind is explicit rather than inherited: a dev server that only
    // listens on loopback cannot be reached from another machine, and a
    // packaged build never starts one.
    host: true,
    // Vite refuses a `Host` it does not recognise. This server is a
    // development tool — a packaged build serves `frontend/dist` from the
    // service itself, with no Vite in the box — and the thing behind it
    // enforces its own Host and Origin guard (ADR-0005 §4), which is the
    // boundary that matters. Pin one host with `NOVA_DEV_HOST` when you would
    // rather this were strict.
    allowedHosts: process.env['NOVA_DEV_HOST'] ? [process.env['NOVA_DEV_HOST']] : true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
  },
  test: {
    // Node by default: the services under test are pure. A component test opts
    // into a DOM with a one-line docblock, so jsdom is never the default cost.
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/core/api/contract.ts', 'src/**/*.test.*'],
    },
  },
});

/** One proxy entry, set up the way every entry here needs to be.
 *
 *  `changeOrigin` rewrites the `Host` header to the target. The service checks
 *  Host and Origin (ADR-0005 §4), and leaving the browser's host in place means
 *  a dev server reached from any other machine — a tablet on the LAN, a preview
 *  URL — is refused by the very guard that exists to protect it.
 */
function serviceProxy(
  extra: Omit<ProxyOptions, 'target' | 'changeOrigin' | 'configure'>,
): ProxyOptions {
  return {
    target: API_ORIGIN,
    changeOrigin: true,
    ...extra,
    configure: (proxy) => {
      proxy.on('proxyReq', (proxyReq) => {
        authorise(proxyReq);
      });
    },
  };
}
