import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    // The Arena preview proxies the dev server through a public host,
    // so we must not reject unknown hosts.
    allowedHosts: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    cssCodeSplit: true,
  },
})
