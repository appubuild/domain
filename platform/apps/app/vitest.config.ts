import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

/**
 * Vitest config for the UI.
 *
 * No React plugin is loaded here on purpose: esbuild already transpiles TSX using the
 * project's `jsx: react-jsx` setting, and skipping the plugin avoids a Vite-major mismatch
 * between the app's Vite 6 and the Vite 5 copy bundled by Vitest 2.
 * PostCSS is explicitly emptied so the legacy root postcss.config.js is never consulted.
 */
export default defineConfig({
  css: { postcss: { plugins: [] } },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    globals: false,
    setupFiles: ['./test/setup.ts'],
    restoreMocks: true,
    server: { deps: { inline: ['@aura/core'] } },
  },
});
