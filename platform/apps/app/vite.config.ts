import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import { fileURLToPath, URL } from 'node:url';

/**
 * Dev server proxies API + WebSockets to the local AURA server so the browser never
 * needs to know a backend port, and previews work behind the sandbox proxy host.
 */
export default defineConfig({
  plugins: [react()],
  // Explicit plugin list: an empty list would skip Tailwind entirely, and omitting the
  // option makes Vite walk up to the legacy marketing site's postcss.config.js.
  css: { postcss: { plugins: [tailwindcss(), autoprefixer()] } },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false },
      '/ws': { target: 'ws://127.0.0.1:8787', ws: true },
    },
  },
  preview: { host: '0.0.0.0', port: 5173 },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // Keep the 3D stack out of the initial payload: the dashboard and most pages do
        // not need three.js until an avatar stage actually mounts.
        manualChunks: {
          three: ['three', '@react-three/fiber', '@react-three/drei'],
          vendor: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query', 'zustand'],
        },
      },
    },
  },
});
