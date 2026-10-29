# Phase 1 foundation

The repository is an npm workspace with a Vite React SPA in `apps/web` and shared source in `packages`. Packages are introduced only when they have a real responsibility. TypeScript is strict. Routing is client-side; production hosting must serve `index.html` for SPA routes. Tailwind is available, with CSS variables defining initial tokens. Radix/shadcn primitives will be introduced when a real interactive component requires them.

Localization uses i18next namespaces and separate English/Bengali resources. The selected UI language is stored in browser localStorage; if storage is unavailable, it remains usable for the session. Report language will be independent. Translation parity is tested. Further feature namespaces, localized validation and locale-aware formatting will be added with their features. System Bengali fonts are used for now; bundled, licensed fonts and PDF shaping need verification in the reports phase.

The single home route is intentionally a foundation status page, not a functional dashboard or survey tool. At the foundation milestone no survey, project storage, server, authentication or map provider was implemented; later work is documented below.

Run `npm install`, `npm run dev`, `npm run typecheck`, `npm test`, `npm run build`, and `npx playwright install chromium && npm run test:e2e`. The Playwright suite checks widths 320–1920 and language persistence; interaction, landscape, accessibility, visual regression and native platform coverage must expand with each phase.

## Phase 2 workspace

The home and settings routes are the only primary navigation destinations. Desktop navigation can be collapsed for the session; mobile uses always-visible labeled navigation rather than an overlay. The app remains a guest experience without accounts, project storage or survey actions. The dashboard explicitly reports these limits rather than displaying fabricated projects or nonfunctional shortcuts. Language settings are shared with the header and storage failure is surfaced; report language remains a later feature. Sidebar collapse is intentionally not persisted.

Headless Chromium has exercised both routes at widths 320, 375, 430, 768, 1024, 1366 and 1920, and simulated touch in 375×812 portrait and 812×375 landscape. This is not a substitute for physical devices, other browsers, visual regression or accessibility auditing. A compatible local executable may be supplied with `PLAYWRIGHT_EXECUTABLE_PATH`; a standard Playwright Chromium installation remains the default.

## Phase 3 survey work

A temporary drawing route has been added; see [survey-engine.md](survey-engine.md). It is a partial interactive implementation with browser-verified core workflows, local-copy persistence and a default offline grid; see [map catalog](map-catalog.md) for the experimental online layer. Browser/device verification and the remaining survey capabilities are still required.

## Phase 4 local project copies

An IndexedDB-backed, versioned project repository and survey-page copy controls have been added. Save and reopen have unit/component coverage using fake IndexedDB and headless Chromium coverage; the remaining Phase 4 scope is outstanding. See [local-projects.md](local-projects.md).
