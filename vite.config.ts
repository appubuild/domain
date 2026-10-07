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
    chunkSizeWarningLimit: 1500,
  },
});
