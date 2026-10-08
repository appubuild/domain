# Scriptora — performance notes

Measured with `npm run build && npm run report:size` on the mock-data build.

## Results after the polish pass

| chunk | before | after |
|---|---|---|
| entry (`index-*.js`) | 712.9 kB raw / **220.8 kB gzip** | 490.2 kB raw / **149.4 kB gzip** (−32 %) |
| initial download (entry + vendor + css) | 232.9 kB gzip | 239.2 kB gzip (split across 6 cacheable files) |
| editor route (`EditorPage-*.js`) | 514.7 kB / 152.2 kB gzip | 501.3 kB / 149.7 kB gzip — stays lazy |
| charts route (`charts-*.js`) | 425.1 kB / 113.5 kB gzip | 415.2 kB / 110.9 kB gzip — stays lazy |

Total bytes are essentially unchanged: the win is that vendor code (React, React Router,
TanStack Query, Lucide, Zustand) now lives in chunks that change only when those
dependencies change, so repeat visits and future deploys re-download far less, and the
browser fetches them in parallel with the entry chunk.

## What changed

1. **Vendor chunk splitting** (`vite.config.ts` → `build.rollupOptions.output.manualChunks`):
   `vendor-react`, `vendor-router`, `vendor-query`, `vendor-icons`, `vendor-state`.
   Deliberately **no catch-all**: an earlier attempt bucketed tiptap and recharts into an
   eager `vendor` chunk and doubled the initial download (442 kB gzip) because a lazy
   route's dependencies were pulled into the first load. The config carries a comment so
   nobody reintroduces it.
2. **`ThemeProvider` no longer polls.** It used to call `cmsRepo.theme()` and
   `JSON.stringify`-compare every 1500 ms forever, on every page. It now subscribes to the
   mock database (`subscribeDatabase`) and only re-renders when a write actually happens —
   so an admin theme change still propagates instantly, with zero idle work.
3. **`PricingPage` fetched plans twice** (two `usePlans()` calls in one object literal).
   Now one query.

## Guards

```bash
npm run build && npm run report:size   # chunk table + initial download size
npm run check:editor                   # editor canvas regression (page box, typing, zoom)
npm run check:theme                    # theme tokens applied from the database
npm run smoke                          # jsdom render test for every route
SMOKE_AS=demo|admin node scripts/smoke.mjs /route …
```

## Deliberately not done (and why)

- **Deferring the mock seed (~200 kB of source in the entry chunk).** The repositories read
  it during the first render, so deferring it would add a loading gate everywhere for no
  real first-paint gain. When Phase 2 replaces the seed with API calls, this disappears on
  its own.
- **Splitting `lucide-react` further.** Icons are already tree-shaken to the ones in use
  (66.5 kB raw / 12.6 kB gzip in `vendor-icons`).
- **Brotli.** Depends on the host/CDN, not the app; Cloudflare in front of the real deploy
  handles it.
