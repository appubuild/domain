import { defineConfig } from 'vitest/config';

export default defineConfig({
  css: { postcss: { plugins: [] } },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 60_000,
    pool: 'forks',
    fileParallelism: false,
  },
});
