import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  /**
   * `tsconfig.json` sets `jsx: "preserve"` (required by Next's compiler), and Vite 8's oxc
   * transform honours that, handing raw JSX to the runtime. Overriding the transform here is
   * what lets tests render real components with `react-dom/server` — no browser, no jsdom.
   */
  oxc: {
    jsx: { runtime: "automatic", importSource: "react" },
    target: "es2022",
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    setupFiles: ["tests/setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    reporters: process.env.CI ? ["default"] : ["default"],
  },
});
