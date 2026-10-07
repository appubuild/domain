import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';

/**
 * Test-only build: bundles the whole app (including React.lazy chunks) into a
 * single classic <script>-executable IIFE so it can run inside jsdom, where ES
 * modules are not supported. Used by scripts/smoke.mjs.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    outDir: 'dist-smoke',
    emptyOutDir: true,
    minify: false,
    target: 'es2020',
    cssCodeSplit: false,
    rollupOptions: {
      input: 'src/main.tsx',
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'app.js',
        assetFileNames: 'app.[ext]',
      },
    },
  },
});
