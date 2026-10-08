import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // fileURLToPath keeps this correct on Windows (handles "C:\..." and spaces in paths).
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    allowedHosts: true,
    hmr: { clientPort: undefined },
  },
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        /**
         * Split the shared shell into cacheable vendor chunks. Route chunks are already
         * lazy (React.lazy), so this keeps the entry chunk to app code + the mock seed
         * and lets browsers download React, the router, the query client and the icon
         * set in parallel — and reuse them across deploys.
         */
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'vendor-react';
          if (id.includes('react-router')) return 'vendor-router';
          if (id.includes('@tanstack')) return 'vendor-query';
          if (id.includes('lucide-react')) return 'vendor-icons';
          if (id.includes('zustand')) return 'vendor-state';
          // Deliberately no catch-all: heavy libraries that only lazy routes need
          // (tiptap in the editor, recharts in the charts chunk) must stay with those
          // lazy chunks. Forcing them into an eager vendor chunk would make the first
          // load *worse* — it did, by 2x, before this note existed.
          return undefined;
        },
      },
    },
  },
});
