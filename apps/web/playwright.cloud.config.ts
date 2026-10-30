import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './cloud-e2e',
  use: { baseURL: 'http://127.0.0.1:4175', ...devices['Desktop Chrome'], launchOptions: process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {} },
  webServer: { cwd: '../..', command: 'VITE_SUPABASE_URL=https://test-project.supabase.co VITE_SUPABASE_ANON_KEY=sb_publishable_test npm run dev -- --port 4175 --strictPort', url: 'http://127.0.0.1:4175', reuseExistingServer: false },
});
