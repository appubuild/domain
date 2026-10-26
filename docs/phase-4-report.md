# Phase 4 — availability integration, instrumentation, and verification hardening

**Date:** 2026-10-26 · **Branch:** `arena/b181432b-domain`

Phase 3 shipped a tested availability engine that the UI never called. This phase closes that
gap, adds the missing write side of analytics, and upgrades the test suite so the failures it
found cannot come back.

---

## 1. The defect this phase started from

`generator-workspace.tsx` held:

```ts
const [availability] = useState<Map<string, AvailabilityInfo>>(new Map());
```

No setter. The engine, providers, cache and RDAP contract were all built and passing 20 tests —
but every candidate rendered as **"Not checked"** forever, and the UI shipped a tooltip
explaining that checking was "a separate engine". Nothing was fabricated, but a real capability
was effectively decorative. That is a correctness problem, not a cosmetic one.

## 2. What was built

| Piece | File | Behaviour |
| --- | --- | --- |
| Browser runner | `src/lib/availability/client.ts` | Transport selection, edge-function provider, persisted session cache, mapping helpers |
| React hook | `src/lib/availability/use-availability.ts` | Bounded runs (≤200 domains), abort on unmount, per-status progress tally, event recording |
| Edge Function | `supabase/functions/availability/index.ts` | Server-side RDAP with Postgres cache; same result shape as the client engine |
| Analytics | `src/lib/analytics/events.ts` | Lazy-loaded first-party event writes; reports whether the event was actually stored |
| UI | `results-panel.tsx`, `candidate-row.tsx` | "Check N names/selected", live progress, transport note, per-domain results in the detail dialog |

### Transport selection (explicit, and shown to the user)

1. `NEXT_PUBLIC_AVAILABILITY_FN_URL` set → checks go through our Edge Function
   (`mode: "edge-function"`).
2. Otherwise → public RDAP endpoints called directly (`mode: "direct-rdap"`), with the UI
   stating that some registries block cross-origin requests.
3. No providers at all → `mode: "none"`: the check button is **disabled** and a callout explains
   that names stay unchecked rather than pretending the action works.

### Honesty guarantees encoded in code and tests

- A failed lookup is `check_failed` / `rate_limited` / `unknown`, never `available_verified`.
- Unrecognised status strings from the Edge Function are coerced to `unknown`.
- A 404 only means "available" when the answering host is authoritative for the TLD.
- The row chip for an indeterminate status is never styled as success.
- The tooltip copy for verified availability says the name must be confirmed at a registrar.
- `summarizeByLabel` takes the candidate's **first checked domain**, not an optimistic average
  across TLDs.

### Analytics

`recordEvent` writes to `analytics_events` through the public client (RLS allows insert, not
bulk read) and returns `{ recorded: false, reason: "not-configured" }` when the backend is
absent — so the admin dashboard can show measured counts or nothing, never estimates. Payloads
are flattened, truncated (200 chars/field, 20 fields) and carry a random per-session id rather
than a fingerprint.

Wired events: `generation_run`, `export_created`, `favorite_added`, `availability_check`,
`availability_failure`.

The Supabase client is imported **dynamically** at send time: the generator's first-load JS went
from 223 kB back to **158 kB** by keeping `@supabase/supabase-js` out of the initial bundle.

---

## 3. Defects found while doing it

| # | Defect | How it surfaced | Fix |
| --- | --- | --- | --- |
| 1 | Availability never called from the UI | Reading the workspace state | Runner + hook + UI wiring |
| 2 | `npm run build` silently corrupted a running dev server (`MODULE_NOT_FOUND './770.js'`, later `ENOENT app-paths-manifest.json`) | Reproduced twice by building during preview work | `scripts/prebuild-check.ts` refuses to build while port 3000 is in use, with an actionable message and an explicit override |
| 3 | Admin resources could reference columns that do not exist, failing only at click time | New contract test against real Postgres | Test-driven: registry validated against `information_schema` |
| 4 | `pages.slug` / `posts.slug` marked immutable but not primary-key components — identity semantics were implicit | Same contract test | Invariant restated correctly: identity tuples must be backed by a PK **or unique index** (both are), and composite keys (`scoring_profiles`) are validated as tuples |
| 5 | Analytics would have added ~65 kB to the generator bundle | Build-size comparison (223 kB vs 151 kB) | Lazy dynamic import; verified back at 158 kB |

---

## 4. Verification

```
npx tsc --noEmit                 exit 0 (strict, noUncheckedIndexedAccess)
npx vitest run                   179 passed / 11 files
npm run build                    ✓ Exporting (2/2)  → out/ regenerated
```

Test files and what they now cover:

| File | Tests | Covers |
| --- | --- | --- |
| `engine/generate`, `constraints`, `normalize`, `export` | 64 | Naming engine, filters, exports |
| `db/schema.test.ts` | 31 | Real Postgres 18.6: schema, constraints, RLS |
| `availability/engine.test.ts` | 20 | RDAP status contract with injected fetch |
| `availability/client.test.ts` | 16 | **new** — edge-function parsing, status coercion, cache, mapping, batching |
| `admin/resources.test.ts` | 11 | **new** — every admin module vs the live schema and its unique keys |
| `analytics/events.test.ts` | 5 | **new** — honest `not-configured`, sink failures, payload hygiene |
| `ui/results-panel.test.tsx` | 15 | **new** — real component renders: check control, disabled state, progress, chip labels |
| `content/content.test.ts` | 17 | Content pack, sitemap, metadata, sanitiser, JSON-LD escaping |

The component tests required a toolchain fix: `tsconfig.json` sets `jsx: "preserve"` for Next,
which Vite 8's oxc transform honoured literally, so `.tsx` imports failed to parse. Setting
`oxc.jsx` in `vitest.config.ts` enables real `react-dom/server` renders — no browser, no jsdom.

### Still blocked (unchanged)

- **Live RDAP**: sandbox egress allows only npm/github/pypi hosts. Provider behaviour is verified
  against fixtures that encode the real contract; production results depend on the deployed
  endpoint.
- **Edge Function deployment**: no Supabase project, so the function is written and documented
  but has never been executed on the platform. `deno check` is also unavailable here.
- **Browser E2E**: no browser binaries. Component rendering is covered; interaction, hydration
  and HMR behaviour are verified only by the running dev server and build.

---

## 5. Next

1. Deploy `availability` and exercise it against real registries; record actual status
   distribution (and where CORS/rate limits bite) in this report.
2. Affiliate routing + click tracking through the same Edge Function pattern, with the
   allowlist enforced server-side.
3. Ad slot rendering with the existing configurable slots (still off by default).
4. Playwright suite once a browser is available; the four critical journeys are already
   enumerated in the Phase 1–3 report.
