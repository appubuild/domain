import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Inline empty PostCSS pipeline: prevents Vite from walking up into the legacy
  // marketing site's root postcss.config.js outside this monorepo.
  css: { postcss: { plugins: [] } },
  ssr: {
    // node:sqlite is a Node builtin that Vite's SSR resolver must leave external.
    external: ['node:sqlite', 'sqlite'],
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 20_000,
    pool: 'forks',
    server: { deps: { external: [/node:sqlite/] } },
  },
});
