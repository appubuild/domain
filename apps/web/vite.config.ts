import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const electronBuild = process.env.VITE_ELECTRON === 'true';
const nativeBuild = electronBuild || process.env.VITE_CAPACITOR === 'true';
const nativeCsp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https: wss:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-src 'none'";

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: electronBuild ? './' : '/',
  plugins: [react(), tailwindcss(), ...(nativeBuild ? [{
    name: 'native-content-security-policy',
    transformIndexHtml(html: string) {
      return html.replace('</head>', `<meta http-equiv="Content-Security-Policy" content="${nativeCsp}"></head>`);
    },
  }] : [])],
  optimizeDeps: { exclude: ['maplibre-gl'] },
  server: { host: '0.0.0.0', allowedHosts: ['.e2b.app'] },
  build: { outDir: 'dist', emptyOutDir: true },
  test: { environment: 'jsdom', setupFiles: ['./src/test-setup.ts'], include: ['src/**/*.test.{ts,tsx}', '../electron/src/**/*.test.ts'] },
});
