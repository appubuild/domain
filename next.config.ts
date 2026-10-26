import type { NextConfig } from "next";
import path from "node:path";

/**
 * DomainFits is built as a **fully static export** (`out/`) that can be uploaded to
 * any shared-hosting document root. This constrains what the app may use:
 *
 *  - no route handlers / route segments that require a server
 *  - no server actions, middleware, ISR or `next/headers`
 *  - no `next/image` optimisation endpoint (images must be `unoptimized`)
 *
 * All data access happens in the browser through the data-source layer
 * (`src/lib/data/*`), which targets Supabase (Postgres + Auth + Storage) in
 * production and a local PostgreSQL-WASM store for offline/demo use.
 */
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  /**
   * The preview runs behind a proxy on `*.e2b.app`. Next blocks cross-origin
   * dev requests (HMR socket, RSC fetches, /_next/* assets) unless the origin is
   * listed, which would render the preview without styles or interactivity.
   */
  allowedDevOrigins: ["localhost", "127.0.0.1", "*.e2b.app"],
  images: { unoptimized: true },
  poweredByHeader: false,
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: false },
  // PGlite (local/demo data backend) ships WASM + ESM assets that must not be
  // bundled by webpack; they are copied into `public/` at install/build time.
  webpack: (config, { isServer }) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@": path.resolve(process.cwd(), "src"),
    };
    if (!isServer) {
      config.resolve.fallback = { ...config.resolve.fallback, fs: false, path: false };
    }
    return config;
  },
};

export default nextConfig;
