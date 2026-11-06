# §10 — Frontend architecture

**Part of:** [`ARCHITECTURE.md`](ARCHITECTURE.md) · **Owner:** Architecture Group
**Last reviewed:** 2026-11-06

This file is section 10 of the system architecture, kept separate because the section
outgrew the 64 KiB single-file budget (`scripts/check_repo_hygiene.py`) and will keep
growing through the UI, timeline and caption stages. Section numbers are unchanged, so a
reference to "ARCHITECTURE §10.7" resolves here.

**Status of this stage.** The window, its transport and its error model are built and
tested. The dock, the stores, the timeline canvas and the design system are specified
here and arrive in stages 6–7; folders that exist for them are listed in §10.4 with what
belongs in them, so the tree grows into its shape instead of being reshaped later.

---

## 10.1 What the window is, and what it is not

The window is a **client of the loopback service** and nothing else (§3, §3.1). It holds
no business logic, decodes no media and writes no `.nova` file: every authoritative answer
lives behind HTTP or the WebSocket, and the window is free to be rewritten without the
editor changing behaviour.

| The window owns | The service owns |
| --- | --- |
| Presentation, interaction and layout | The project, the timeline, the media |
| Local UI state (selection, hover, panel sizes) | Commands, undo/redo, the journal |
| Optimistic state, always reconcilable | Encoding, decoding, compositing, AI |
| Caching what the service already answered | The cache itself, and its budget (§7) |
| Keyboard maps, themes, window chrome | Capabilities, licences, the file system |

Two consequences drive everything below:

1. **Offline is not a feature, it is the only mode.** There is no CDN to fall back on:
   fonts, icons and bundles ship inside the package. A component that fetched an asset
   from the internet would work on the developer's laptop and nowhere else.
2. **The service is local, but it is not free.** It can be busy transcoding; it can be
   mid-boot when the window opens. Every request has a deadline, and "not answering yet"
   is a state the UI can name (§10.7).

## 10.2 Toolchain and ownership

`frontend/` owns its own toolchain and its own lockfile (ADR-0001). Nothing installs into
the backend virtualenv, nothing in the virtualenv reaches back, and the only thing that
crosses the boundary is the generated contract (§10.3).

| Concern | Choice | Why |
| --- | --- | --- |
| Runtime | Node ≥ 20.19 (`engines`), npm | Native `fetch`, `AbortSignal`, `structuredClone`; no transpiler needed |
| Bundler | Vite 7 (`@vitejs/plugin-react`) | One config for dev server, build and test |
| Language | TypeScript 5.9 | See the flag table below |
| UI | React 19 | Concurrent rendering; no class components anywhere |
| Styling | Tailwind v4 via `@tailwindcss/vite` | CSS-first `@theme` tokens, no JS config to keep in sync |
| Test | Vitest 3 + jsdom + Testing Library | Same transform as the build; node-by-default (§10.11) |
| Lint | ESLint 9 flat config, `typescript-eslint` `strictTypeChecked` | Type-aware rules, so a lint error is usually a real bug |
| Format | Prettier 3 (`printWidth 100`, single quotes, trailing commas) | One format, no arguments |

The TypeScript configuration is deliberately uncomfortable:

```jsonc
"strict": true,
"noUncheckedIndexedAccess": true,   // an index is `T | undefined`, because it is
"exactOptionalPropertyTypes": true, // `undefined` is a value you chose to send
"noImplicitOverride": true,
"noFallthroughCasesInSwitch": true,
"noUnusedLocals": true, "noUnusedParameters": true,
"verbatimModuleSyntax": true,       // type imports say `import type`
"isolatedModules": true,
```

`exactOptionalPropertyTypes` is the one that earns its keep in a client: `{ token }` and
`{ token: undefined }` are different requests, and a client that cannot tell them apart
sends `Authorization: Bearer undefined` one day.

**Where the bundle goes.** `vite build` writes `frontend/dist` (ignored by git). In the
packaged app the service serves those files itself and the window is same-origin, so
there is no CORS, no proxy and no second origin to secure (§11). In development the two
are separate processes and Vite proxies `/api`, `/ws` and `/healthz` to
`NOVA_API_ORIGIN` (`http://127.0.0.1:8765` by default) — a proxy rather than a hard-coded
origin, so the app's relative URLs stay honest and the same code runs in both worlds.

## 10.3 The contract seam

The frontend never hand-writes a type the backend already declared.

```
   routes (nova_studio/api/routers/*.py)
        │  python -m nova_studio openapi
        ▼
   docs/architecture/api-contract.json        ← committed, reviewed like code
        │  scripts/codegen_contract.py
        ▼
   frontend/src/core/api/contract.ts          ← committed, generated, never edited
        │
        ▼
   core/api/client.ts  (hand-written, contract-typed)
```

| Fact | Value |
| --- | --- |
| OpenAPI | 3.1.0 |
| `CONTRACT_VERSION` | `0.1.0` |
| Paths / schemas | 30 / 62 |
| Generated file | `frontend/src/core/api/contract.ts` (≈ 47 kB) |

What the generator emits, and the rules it follows:

* **`Schemas`** — one exported interface per component schema, with the route's own
  `description` as a JSDoc comment (a doc comment is the only place a generated file may
  say anything, so escaping matters: `*/` inside a description is neutralised).
* **`OPERATIONS`** — one entry per route: `method`, `path`, `pathParams`, `queryParams`,
  `requestBody`, `response`, `responseFormat`. Operation keys are the camelCased handler
  names (`systemInfo`, `previewFrame`, `ensureMedia`, `trimCache`, `undoCommand`), so a
  rename in the router is a rename in the client and a compile error in every caller.
* **Nullability** — `nullable: true` widens to `| null`, and an absent property in
  `required` becomes optional. A field the service may not send is a field the UI has to
  handle; the type says so.
* **Binary** — a response whose schema is a string with `format: binary` is emitted as
  `responseFormat: "blob"`, which is what tells the client to `Accept: image/*` and to
  read `response.blob()` instead of parsing JSON. This is why the preview frame route
  declares its 200 response explicitly: FastAPI would otherwise describe it as
  `application/json`, and the generated client would try to `JSON.parse` a JPEG.

Two gates keep the seam honest, and both run in `make check`:

| Gate | Command | Fails when |
| --- | --- | --- |
| Contract freshness | `make contract-check` | the routes changed and the JSON or the `.ts` was not regenerated |
| Regeneration | `make contract` | — (writes both files; the diff is the review) |

`make contract-check` runs `codegen_contract.py --check` *and*
`nova-studio openapi --check docs/architecture/api-contract.json` (§10.13), so drift is
caught from either end: a hand-edited `contract.ts` fails it just as loudly as a new
route does.

## 10.4 Folder structure (normative)

```
frontend/
├── index.html                 entry document (dark class, #root)
├── vite.config.ts             build + dev proxy + vitest configuration
├── tsconfig.json              strict flag set of §10.2
├── eslint.config.js           lint, including the three architectural rules of §10.5
├── .prettierrc.json           one format
└── src/
    ├── main.tsx               composition root: config → client → context → <App/>
    ├── App.tsx                the window's shell (three lines until routing exists)
    ├── core/                  mechanisms, no product knowledge
    │   ├── api/
    │   │   ├── contract.ts    GENERATED — never edit
    │   │   ├── client.ts      the typed transport (§10.7)
    │   │   ├── problem.ts     ApiProblem, describe(), fromProblemResponse()
    │   │   └── context.ts     ApiContext + useApi() (DI at the window's edge)
    │   ├── result.ts          Result<T, E> and its combinators (§10.6)
    │   ├── shell/config.ts    how this window was started (§10.8)
    │   ├── events/            (stage 5) WS bridge → store dispatch
    │   ├── timecode/          (stage 7) frame math shared with backend semantics
    │   └── utils/
    ├── stores/                (stage 5–7) one slice per domain: project, timeline,
    │                          media, playback, captions, export, ai, settings, ui
    ├── ui/                    (stage 6) design system: Button, Slider, Menu, Modal,
    │                          Tooltip, VirtualList, Dock, Splitter, Icon, Toast
    ├── features/              one folder per screen or panel group
    │   ├── splash/            boot screen: is the editor there?
    │   ├── home/  project-manager/        (stage 6)
    │   ├── editor/            toolbar, left-sidebar, preview, inspector,
    │   │                      timeline (ruler, tracks, clips, keyframes, markers),
    │   │                      status-bar                                (stage 6–7)
    │   ├── captions/          Caption Studio                             (stage 9)
    │   ├── ai-studio/  plugins/  templates/  fonts/  export/  settings/  (stage 10+)
    │   └── shortcuts/  about/
    ├── styles/theme.css       the Tailwind v4 @theme block (§10.10)
    └── test/setup.ts          Testing Library cleanup (§10.11)
```

A folder is created **with the feature that needs it**, not before: an empty folder is a
guess, and the tree above is a map of where things go, not a claim that they are there.

## 10.5 Layering inside the frontend

```
        features/            screens and panels (product knowledge lives here)
            │
        stores/              domain state, one slice per aggregate
            │
        core/                mechanisms: api, result, shell, events, timecode
            │
        (nothing)            core imports no feature, no store, no component
```

`ui/` sits beside them and depends on `core/result.ts` and on tokens, never on a store.
Rules, and how each is enforced:

| Rule | Enforced by |
| --- | --- |
| No bare `fetch` outside `core/api` | `no-restricted-globals` (`fetch`) in `eslint.config.js` |
| No colour literals in `src/` | `no-restricted-syntax` on hex literals (§10.10) |
| No stale closures | `react-hooks/exhaustive-deps` |
| No floating promises, no `any` in disguise | `typescript-eslint` `strictTypeChecked` |
| No backend-shaped code in the window | review, and the fact that there is nothing to import |

`scripts/check_layering.py` (ADR-0002) is the *backend* gate and stays there. The
frontend equivalent is the ESLint configuration above plus review; adding
`no-restricted-imports` rules for `features → core` direction is the next hardening step,
once there are enough layers to make a mistake in.

## 10.6 The error model

The Python core returns `Result[T]` instead of raising (§5.5), and the window does the
same for the same reason: a panel that wraps every call in `try/catch` is a panel where
somebody eventually forgets, and the exception surfaces three components from the thing
that caused it.

`core/result.ts` is the vocabulary — `ok`, `err`, `isOk`, `isErr`, `map`, `mapErr`,
`andThen`, `unwrapOr`, `match` — with `E = never` as the default error so a helper that
cannot fail says so in its type. `match` exists because it is the only form that makes
forgetting the failure branch a compile error.

Every transport failure is an `ApiProblem` (`core/api/problem.ts`):

| `kind` | `code` | What it means | What the UI does |
| --- | --- | --- | --- |
| `transport` | `transport/unreachable` | Nothing answered | "The editor is not running" + retry |
| `timeout` | `transport/timeout` | It did not answer in time | "It may still be starting" — not an error yet |
| `aborted` | `transport/aborted` | We cancelled it | Say nothing; a newer request is in flight |
| `api` | `NS-<DOMAIN>-<NNNN>` | The service answered, and refused | Localised message keyed by the code |
| `api` | `http/<status>` | It answered, but not with a problem document | Log with the status; generic message |
| `decode` | `transport/decode` | 200 with bytes that are not what we asked for | Log loudly; this is a bug |
| `contract` | `transport/missing-path-param` | We called an operation without its path parameter | Log; this is a bug |

`code` is the only field guaranteed to mean something to whoever reads it next, which is
why `describe()` puts it first and why **the `NS-*` code is the localisation key**: the
window never invents a message for a failure the service already named, and it never
renders `detail` — `detail` is for the log line (§10.10, i18n rule).

## 10.7 The API client

`core/api/client.ts` exports one function that matters: `run(id, request)`. Both
arguments are typed from `OPERATIONS`, so:

* a misspelled operation id, a missing path parameter, or a parameter the route does not
  take is a **compile error**;
* the response type is the route's schema, or `Blob` when the route answers binary;
* the client **never throws** — every failure is `Err(ApiProblem)`;
* every request has a deadline (`DEFAULT_TIMEOUT_MS = 15_000`, overridable per request;
  `0` means "no deadline").

```
   run('previewFrame', { params, query, body, signal, timeoutMs, headers })
        │
        ├─ buildUrl()      path params → 400-level contract problem if missing
        ├─ Headers         Accept (json | image/*), Content-Type, Authorization
        ├─ combine()       caller's signal ∪ deadline → one AbortController
        ├─ fetch()
        └─ read()          !ok → problem+json → ApiProblem
                           blob → Response.blob()
                           204/empty → ok(undefined)
                           else → JSON, or a decode problem
```

Cancellation and deadlines are combined into one `AbortController` with a separate
`expired` flag, because "the user cancelled" and "it took too long" are different
failures with different remedies. An already-aborted caller's signal is acted on
immediately rather than waiting for an `abort` event that will never fire.

Three capabilities are deliberately **not** in the client, and each is the caller's
business:

* **Retries** — only the caller knows whether replaying this request is safe; a transport
  that retried a command would execute it twice.
* **Caching** — caching is a policy with an invalidation story (`api.md` §13); a cache
  hidden inside the transport has neither.
* **A queue** — the service throttles by job, not by connection.

## 10.8 Boot and shell configuration

`main.tsx` is the composition root and the only file that knows how the window was
delivered:

1. `readRuntimeConfig()` (`core/shell/config.ts`) reads the query string, takes the
   session token out of it, and then **rewrites the URL** so the token never sits in an
   address bar where a user can copy it into a chat window. `VITE_API_BASE` overrides the
   origin for development; empty means same-origin, which is the desktop case.
2. `createApiClient({ baseUrl, token })` binds the adapter.
3. `<ApiContext.Provider>` makes it available to the tree; `useApi()` throws when it is
   missing, because a component silently talking to no service is the hardest failure to
   debug.

`ShellLocation` is a two-field seam (`search`, `path`) with a `replace` callback, so the
token-stripping logic is tested without a browser (`config.test.ts`).

Dev server proxy (`vite.config.ts`):

| Prefix | Target | Notes |
| --- | --- | --- |
| `/api` | `NOVA_API_ORIGIN` | the REST surface |
| `/ws` | `NOVA_API_ORIGIN` | WebSocket, proxy-enabled |
| `/healthz` | `NOVA_API_ORIGIN` | readiness probe |

## 10.9 State management

MVVM as §4.1 specifies it, mapped onto React:

| Role | Where it lives | Example today |
| --- | --- | --- |
| View | `features/**/*.tsx` — renders state, no decisions | `Splash.tsx` |
| View-model | `features/**/use*.ts` — owns one screen's state machine | `useServiceInfo.ts` |
| Model | `stores/*` (stage 5+) — domain state, one slice per aggregate | — |
| Service | `core/api` + `core/events` — the world outside the window | `client.ts` |

`useServiceInfo` is the smallest complete example, and its state machine is the pattern
every screen follows — each state is spelled out rather than implied:

```ts
type ServiceState =
  | { kind: 'connecting' }                              // not an error: it is booting
  | { kind: 'ready'; info: SystemInfoResponse }
  | { kind: 'unreachable'; problem: ApiProblem };
```

Rules that will hold for the stores when they arrive:

* **Server state and UI state are different stores.** Selection, hover and panel sizes
  never share a slice with the project.
* **The service is the source of truth.** A store is a cache of what the service said,
  plus optimistic state that the command log can roll back (§5.3). Nothing writes to the
  project except a command.
* **Events, not polling.** `core/events/` (stage 5) bridges the WebSocket to store
  dispatch with a topic → handler map, and re-syncs from REST after a reconnect gap,
  because a WS that dropped for two seconds is a store that is two seconds wrong.
* **Undo/redo is not frontend state.** The journal lives in the service; the window sends
  commands and receives events (§5.3).

## 10.10 Theming and the design system

`src/styles/theme.css` is the **only** place a colour may exist. Every value is a CSS
custom property inside a Tailwind v4 `@theme` block, which is what makes a theme a
document that overrides properties rather than a second stylesheet:

| Token group | Tokens |
| --- | --- |
| Surfaces | `--color-surface-0` … `--color-surface-3` |
| Lines | `--color-line` |
| Ink | `--color-ink`, `--color-ink-dim`, `--color-ink-faint` |
| Accent | `--color-accent`, `--color-accent-ink` |
| Feedback | `--color-danger`, `--color-success` |
| Type | `--font-ui`, `--font-mono` |
| Shape | `--radius-panel` |

The window is dark-first (`<html class="dark">`) because the product is an editor. The
lint rule that forbids hex literals in `src/` is what keeps this true: without it, the
first deadline turns `oklch(0.72 0.16 250)` into `#4c8dff` in a component and theming
quietly dies. Future themes (including plugin-contributed ones) are JSON documents that
override these properties — no code path, no rebuild.

**i18n rule (from §10):** no literal user-facing string in a component. Today the splash
carries English literals and i18n arrives with the design system in stage 6; when it
does, `NS-*` problem codes are the keys for error messages (§10.6), so a failure is
localised by the same table the service's `remedy` field feeds.

## 10.11 Testing strategy

Vitest, configured inside `vite.config.ts` so tests run through the same transform as the
build.

| Decision | Why |
| --- | --- |
| `environment: 'node'` by default | The services under test are pure. A component test opts into jsdom with a one-line docblock, so jsdom is never the default cost. |
| `setupFiles: ['./src/test/setup.ts']` | Automatic cleanup only registers under Vitest globals, which are off; without it a second component test in a file sees the first one's DOM. |
| No jest-dom | `expect(el.textContent).toContain(...)` says the same thing with no extra dependency. |
| Coverage excludes `contract.ts` | It is generated; covering it tests the generator, which is a Python test. |

Suites today (33 tests, 4 files, ≈ 2 s):

| Suite | Covers |
| --- | --- |
| `core/result.test.ts` (7) | The combinators, including that `map` leaves a failure untouched |
| `core/api/client.test.ts` (16) | URL building, path params, headers, token, JSON and blob reads, timeouts, cancellation, and every `ApiProblem` kind — against a `fetch` double, so no service is needed |
| `core/shell/config.test.ts` (5) | Token consumption, URL rewriting, `VITE_API_BASE` |
| `features/splash/Splash.test.tsx` (5) | All three splash states, including that a timeout is not reported as a crash |

Type-level strictness means a test can fail to compile rather than fail to assert, which
is why the tests route values through helpers: `const good = asResult(ok(42))` keeps the
type checker from narrowing a literal two lines earlier and proving the branch for us.

Deliberately untested here, and where it belongs instead: pixel output (goldens in stage
8), the WebSocket bridge (stage 5, against a real service), and canvas rendering (stage 7,
with a headless canvas harness).

## 10.12 Performance strategy

| Rule | Why |
| --- | --- |
| The bundle is budgeted, not measured afterwards | Today: 236 kB raw / 73 kB gzip for a boot screen and a client. A route-level split comes with routing (stage 6). |
| No per-frame React state | Timeline and preview panels write to canvas (§10.12), not to `useState`; a 60 fps React render is 60 reconciliations of a tree that did not change. |
| Redraws batched in `requestAnimationFrame`, dirty-region driven | Thousands of clips; only the damaged region repaints. |
| Virtualise by visible range | A two-hour timeline has ~200 000 frames; rendering the ones off-screen is the whole bug. |
| Decode is the service's job | Proxies, thumbnails and the cache budget (§7) keep the window from ever holding a full-resolution frame it did not need. |

## 10.13 Commands

`make` is the canonical entry point (the Makefile's own rule: a target is added in the
stage that makes it real). The npm scripts in `frontend/package.json` mirror them for
anyone who lives inside that folder.

| `make` | npm | What it does |
| --- | --- | --- |
| `make contract` | — | Regenerate `api-contract.json`, then `contract.ts` |
| `make contract-check` | — | Fail if either is stale |
| `make frontend-install` | `npm install` | Install from `frontend/package-lock.json` |
| `make frontend-types` | `npm run typecheck` | `tsc --noEmit` |
| `make frontend-lint` | `npm run lint` | ESLint + `prettier --check .` |
| `make frontend-format` | `npm run format` | Prettier + `eslint --fix` |
| `make frontend-test` | `npm test` | `vitest run` |
| `make frontend-build` | `npm run build` | `tsc --noEmit && vite build` |
| `make frontend-check` | — | contract-check + types + lint + test |
| `make dev` | `npm run dev` | Service and Vite dev server together, proxied |

`make check` runs the backend gates and, **where npm is installed**, `frontend-check` —
so a backend-only contributor is not blocked by a toolchain the backend does not use,
while CI, which has both, always runs the whole thing.

## 10.14 What is not built yet

| Order | What | Stage |
| --- | --- | --- |
| `core/events/` — WS bridge, topic → handler map, reconnect re-sync | 5 |
| `stores/project` — the first slice, and the command/undo loop | 5, 7 |
| `ui/` — the design system, then the dock tree and window chrome | 6 |
| `features/editor/` — preview panel, inspector, status bar | 6 |
| `features/editor/timeline/` — Canvas 2D ruler, tracks, clips, snapping | 7 |
| WebGL overlay layer for preview-only gizmos | 7 |
| `features/captions/` — the Caption Studio | 9 |
| `features/ai-studio/`, `plugins/`, `export/`, `settings/` | 10–12 |

---

## Related

| Document | What it holds |
| --- | --- |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) §10 | The section this file expands: the folder tree, docking, timeline rendering, the preview transports, theming and the i18n rule |
| [`api.md`](api.md) | The service side of every request, `problem+json`, and the WS protocol |
| [`api-contract.json`](api-contract.json) | The generated contract |
| `scripts/codegen_contract.py` | The generator, and `tests/scripts/test_codegen_contract.py` its tests |
