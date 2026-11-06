import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

/** Where the Python service is listening during development.
 *
 *  The desktop shell starts the service itself and serves the built frontend
 *  from it, so the app is same-origin in production and needs no proxy. In dev
 *  the two are separate processes, and a Vite proxy is what keeps the app's
 *  relative URLs honest — a frontend that hard-codes `localhost:8765` is a
 *  frontend that cannot be served from anywhere else.
 */
const API_ORIGIN = process.env['NOVA_API_ORIGIN'] ?? 'http://127.0.0.1:8765';

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
      '/api': { target: API_ORIGIN, changeOrigin: false },
      '/ws': { target: API_ORIGIN, ws: true, changeOrigin: false },
      '/healthz': { target: API_ORIGIN, changeOrigin: false },
    },
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
