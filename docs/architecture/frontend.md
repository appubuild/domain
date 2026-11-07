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
    ├── main.tsx               process entry: config → client → context → <App/>
    ├── App.tsx                the window's shell: service state → splash or workspace
    ├── app/
    │   └── providers.tsx      the workspace's composition root (§10.9.3)
    ├── core/                  mechanisms, no product knowledge
    │   ├── api/
    │   │   ├── contract.ts    GENERATED — never edit
    │   │   ├── client.ts      the typed transport (§10.7)
    │   │   ├── problem.ts     ApiProblem, describe(), fromProblemResponse()
    │   │   └── context.ts     ApiContext + useApi() (DI at the window's edge)
    │   ├── result.ts          Result<T, E> and its combinators (§10.6)
    │   ├── shell/config.ts    how this window was started (§10.8)
    │   ├── events/            the WS bridge: protocol.ts, bridge.ts, url.ts,
    │   │                      useEventStream.ts (§10.9.1)
    │   ├── timecode/          (stage 7) frame math shared with backend semantics
    │   └── utils/
    ├── stores/                one slice per domain, each a vanilla zustand store
    │   │                      behind a context (§10.9.2)
    │   ├── project.ts         the file menu, as state — the first slice
    │   ├── timeline/  media/  playback/  captions/  export/  ai/  settings/  ui/
    │                          (stages 6–11, one per feature that needs one)
    ├── ui/                    (stage 6) design system: Button, Slider, Menu, Modal,
    │                          Tooltip, VirtualList, Dock, Splitter, Icon, Toast
    ├── features/              one folder per screen or panel group
    │   ├── splash/            boot screen: is the editor there? (useServiceInfo, Splash)
    │   ├── projects/          the project list panel (useProjects, ProjectList)
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
        app/                 the composition root: wires the two halves together
            │                (§10.9.3) — depends on everything, is depended on by
            │                nothing but main.tsx
        features/            screens and panels (product knowledge lives here)
            │
        stores/              domain state, one slice per aggregate
            │
        core/                mechanisms: api, result, shell, events, timecode
            │
        (nothing)            core imports no feature, no store, no component
```

`ui/` sits beside them and depends on `core/result.ts` and on tokens, never on a store.
`app/` is the exception the diagram draws on purpose: it is allowed to know both
`stores/` and `core/` because joining them is its only job — and it holds no
behaviour of its own, so there is nothing to test about it except the join
(`app/providers.test.tsx`).
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

From there `App.tsx` owns the window's one question — *is the editor there?*
(`useServiceInfo`) — and answers it with either the splash or the workspace. The
workspace is `<WorkspaceProviders>`, which is where the store and the socket are
joined (§10.9.3); it is not created until the service has answered, because a
socket opened against a service that is still starting is a retry loop with a
splash screen on top of it.

`ShellLocation` is a two-field seam (`search`, `path`) with a `replace` callback, so the
token-stripping logic is tested without a browser (`config.test.ts`).

**The session token in development.** The service hands out a fresh 256-bit token
per launch and refuses anything without one (ADR-0005 §4). In production the
shell puts that token in the window's URL, where the app reads it and takes it
out again. A dev server has no shell, so **the proxy is the shell's stand-in**:
`make dev` starts the service with `--endpoint-file .nova/dev-endpoint.json`,
and the proxy reads the token from that file on every request and attaches it —
an `Authorization` header for HTTP, a `token` query parameter for the WebSocket,
which cannot carry a header on its handshake. The app itself never learns that
development is different, which is the point: a dev-only branch in `main.tsx` is
a branch production never exercises.

The file is read per request rather than once at start-up, because the two
processes start together and the file does not exist for the first few hundred
milliseconds; a missing token is a 401 the window can explain, not a crash.

Dev server proxy (`vite.config.ts`):

| Prefix | Target | Notes |
| --- | --- | --- |
| `/api/v1/ws` | `API_ORIGIN` | the socket, with the token in the query string |
| `/api` | `API_ORIGIN` | the REST surface, with the token attached |
| `/healthz` | `API_ORIGIN` | readiness probe; unauthenticated by design |

Two details in that table are easy to get wrong, and both fail as a mysterious
403 rather than as anything that mentions a token:

* **The socket entry comes first.** Vite matches a proxy by prefix and takes the
  first that matches, so `/api/v1/ws` registered *after* `/api` is handled by a
  proxy that cannot upgrade — which answers a handshake with a 200 and a closed
  connection.
* **http-proxy emits `proxyReqWs` for an upgrade, not `proxyReq`.** Hook only the
  first and the token is attached to every REST call and to no WebSocket.

`changeOrigin` rewrites `Host` to the target, because the service checks Host and
Origin and a dev server reached from anywhere but loopback would otherwise be
refused by the very guard that protects it. `allowedHosts` is open for the same
reason — this server is a development tool, never shipped — and `NOVA_DEV_HOST`
pins it to one host when you would rather it were strict. `make dev` binds the
service to a known port (`DEV_PORT`, 8765) instead of an ephemeral one: the proxy
has to be pointed at it once, at start-up, and an ephemeral port is one the proxy
learns too late.

## 10.9 Events and state

Two halves: `core/events/` is how the world reaches the window, and `stores/` is
what the window remembers. Both are built; both are small on purpose.

### 10.9.1 The event bridge (`core/events/`)

One socket at `/api/v1/ws` carries every event, with the session token in the
query string because a browser cannot set a header on a handshake (`api.md` §6).

| Direction | Frames |
| --- | --- |
| Server → client | `hello` (once: `seq`, `topics`, `heartbeat_seconds`), `event`, `heartbeat` (with `dropped`), `pong`, `resync` (`since`, `events`, `last_seq`, `oldest_seq`, `complete`), `goodbye` |
| Client → server | `ping`, `resync {since}`, `unsubscribe` |

Four rules carry the bridge, and each is the backend's own rule honoured on this
side:

* **Every frame is sequence-checked.** A client that sees `…41, 42, 47` knows it
  lost four events and *which* four, so recovery is a request rather than a
  guess. The arithmetic lives here because nothing downstream can do it: a store
  sees a stream, not a sequence.
* **An event that arrives ahead of the sequence is held, not delivered.** A
  `clip.deleted` that arrives before the `clip.moved` it follows is a timeline
  the user never had. Held events are bounded (512, as the bus bounds its own
  buffer) and drained the moment the hole is filled.
* **A gap is repaired from history, or admitted.** `resync {since}` asks for the
  hole; `complete: false` means history could not reach back that far, and the
  bridge says so through `onStale` instead of pretending. The caller refetches.
  The same callback fires if a replay never arrives, because events held forever
  are worse than events delivered late.
* **A frame we do not recognise is skipped, never fatal.** A server one version
  ahead sends frames this client has never heard of, and closing the socket over
  one is a bug the user pays for.

`protocol.ts` is the only file in `src/` written by hand against the backend
rather than generated from the OpenAPI document — a WebSocket has nowhere in that
document to live. It is therefore the only file that can drift silently, so
`WS_PROTOCOL_VERSION` and the frame kinds are asserted against
`nova_studio.api.ws` by a Python test (`tests/api/test_ws_protocol_mirror.py`):
the same trick as `make contract-check`, applied where the generator cannot reach.

**Health is a published value, not a question you ask twice.** `health()`
returns the *same object* until something changes — status, sequence, drops,
attempts — and `onHealthChange(listener)` hands the changes to as many listeners
as ask. Both halves matter: React compares a snapshot by identity, so a `health()`
rebuilt on every call would re-render a status line on every frame of a scrub,
and a single `onHealth` slot would let the last component to register silence
every other one.

Two more that are the bridge's own:

* **A handler that throws does not take the socket with it.** One panel's bug is
  not an editor-wide outage; the error is reported and delivery continues. A
  health listener that throws is treated the same way.
* **Reconnection backs off** (doubling with jitter, reset by a `hello`), and a
  socket that has gone quiet for three heartbeat intervals is presumed dead —
  silence is the only evidence there is, because nothing arrives to say a socket
  has died.

Handlers subscribe by pattern: an exact topic, a prefix (`timeline.*`), or the
whole stream (`*`). A panel that cares about the timeline is not rewritten when a
topic is added under it.

### 10.9.2 Stores

MVVM as §4.1 specifies it, mapped onto React:

| Role | Where it lives | Example today |
| --- | --- | --- |
| View | `features/**/*.tsx` — renders state, no decisions | `Splash.tsx` |
| View-model | `features/**/use*.ts` — owns one screen's state machine | `useServiceInfo.ts` |
| Model | `stores/*.ts` — domain state, one slice per aggregate | `stores/project.ts` |
| Service | `core/api` + `core/events` — the world outside the window | `client.ts`, `bridge.ts` |

A store is a **zustand vanilla store** (`createStore`) handed to the tree through
a context, the same way the API client is (`useApi`). Two reasons for the
indirection rather than a global: a component that imported a singleton store
could not be rendered in a test, and a store built at module scope cannot be
given the client it should be calling. `useProjectStore(selector)` throws without
a provider, because a store that is not there is a silent no-op and a silent
no-op is the failure nobody traces.

`stores/project.ts` is the first slice — the file menu, as state:

| | |
| --- | --- |
| `refresh()` | `listProjects`, replacing the list with the answer |
| `create(name, path?)` / `open(path)` | adds the project and makes it current; open carries its `warnings` |
| `close(id)` | removes it, and clears the current one if it was |
| `save(id)` / `saveAs(id, path)` | writes, then asks for the summary |
| `checkpoint(id)` | writes a checkpoint now rather than waiting for autosave to owe one |
| `select(id)` | which project the window is showing — the store's own business, no request |
| `applyEvent(envelope)` | a `project.*` event means "ask again" |

Four rules, and each is a bug going the other way:

* **The service is the source of truth.** Nothing writes a project except a
  command or a call, and the answer that comes back replaces what we had. A
  `save` response names the file, not the project's new state — so the store asks
  for the summary rather than flipping `dirty` itself, which would be guessing at
  numbers the service owns.
* **A failed read keeps what it had.** A refresh that failed is not evidence that
  the list is empty, and a UI that claims the user's work is gone because of a
  network hiccup is a UI that lies. The problem is recorded, the list is kept.
* **An event is a notification, not a payload.** `project.*` means "ask again",
  never "here is the new state": the socket carries small envelopes by design,
  and a store that treated them as data would be wrong whenever one is dropped.
* **Refreshes coalesce.** A refresh while one is running *joins* it, and at most
  one catch-up follows — an event that landed mid-request may or may not be in
  the snapshot, so asking once more is honest. Ten events in a tick are two
  requests, not ten.

The first panel that uses all of it is `features/projects/`: `useProjects.ts` is
the view-model (the store's fields plus one `refresh()` on mount, and actions
read from `getState()` rather than from a selector, because an action that is
selected is an action re-rendered on every write), and `ProjectList.tsx` is the
view. A panel that reaches into the store directly would be tested by mounting a
store; this one is tested by handing the view-model a client double.

Still to come, and why they are not here yet: commands, undo/redo and optimistic
updates (stage 7 — the journal lives in the service, and an optimistic update is
only safe once the command log can roll it back), and server state versus UI
state living in separate slices (`stores/` gains `ui`, `timeline`, `media`, … as
those features arrive).

### 10.9.3 Where the two halves are wired together (`app/`)

Neither half may wire itself: a store that subscribed to a socket could not be
built in a test, and a stream that wrote to a store could not be pointed at
another one. So the wiring has a home of its own, `app/providers.tsx`, and it is
the only logic in the file:

1. **One store per client**, memoized on `[client]`.
2. **One socket for the window**, `useEventStream`, opened on mount and closed on
   unmount. Its `onStale` calls `store.getState().refresh()` — a hole the bus
   could not repair is the stream's discovery and the store's problem.
3. **A refresh on mount, before any event arrives**, because a service that has
   been up for an hour has no event to tell us what it is already holding.
4. **A `project.*` subscription**, whose unsubscribe the effect returns. Not `*`:
   a store that refetched on every topic would refetch on every frame of a scrub.
5. **Both objects handed down as contexts** — the store, and the stream.

`useEventStream` itself is small on purpose and defends one invariant: **the
stream is created once, never rebuilt under a re-render**. The callbacks
(`onStale`, `onError`) are read through a ref so a caller may pass an inline
arrow, and the `socketFactory` too — a factory passed as an inline arrow is the
natural way to write it, and a stream rebuilt every render is a reconnect loop
that only shows up under load, where it looks like the service flaking.

`useStreamHealth()` is how a component *below* the provider learns the socket's
state: it takes the stable stream out of context and subscribes to its health
through `useSyncExternalStore`, which is exactly why §10.9.1 publishes a stable
snapshot. A status line needs the health; it should not be the reason a socket
stays open.

```
main.tsx                 config → client → ApiContext → <App/>
  App.tsx                useServiceInfo → Splash | <WorkspaceProviders>
                                                 store ─┐
    app/providers.tsx    useEventStream ──── stream ────┤ one refresh on mount,
                                                        │ project.* → refresh(),
                                                        │ gap → onStale → refresh()
                         EventStreamContext ────────────┘
                         ProjectStoreContext
      features/**        panels, each with its own view-model
```

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

Suites today (130 tests, 11 files, ≈ 6 s):

| Suite | Covers |
| --- | --- |
| `core/result.test.ts` (7) | The combinators, including that `map` leaves a failure untouched |
| `core/api/client.test.ts` (16) | URL building, path params, headers, token, JSON and blob reads, timeouts, cancellation, and every `ApiProblem` kind — against a `fetch` double, so no service is needed |
| `core/shell/config.test.ts` (5) | Token consumption, URL rewriting, `VITE_API_BASE` |
| `core/events/protocol.test.ts` (25) | Every frame kind, and that each shape of nonsense — a newer server's frame, malformed JSON, an event with no topic — comes back as `null` rather than an exception |
| `core/events/url.test.ts` (9) | `wss` under https, the token in the escaped query string, and the relative URL a desktop window needs |
| `core/events/bridge.test.ts` (27) | The sequence arithmetic against a socket double: a gap is held and requested, a replay fills the hole, an incomplete replay is admitted, a handler that throws does not kill the stream, silence reconnects, the retry backs off, and the health snapshot is stable between changes while every listener is told |
| `stores/project.test.ts` (18) | The service's answer wins, a failed refresh keeps the list, refreshes coalesce, ten events are two requests, and a save asks for the summary instead of inventing one |
| `app/providers.test.tsx` (5) | The wiring: a refresh on mount, the socket opening and going live, `project.*` asking again while another topic does not, an unrepairable gap refreshing, and the subscription coming back on unmount |
| `features/splash/Splash.test.tsx` (5) | All three splash states, including that a timeout is not reported as a crash |
| `features/splash/useServiceInfo.test.ts` (4) | The boot request: a connecting start, a ready service, a failure that names its code, and the abort signal handed to the client when the window gives up |
| `features/projects/ProjectList.test.tsx` (9) | The panel against a scripted client double: rows, the empty state, a failed refresh that keeps the list, create, close, and the error a rejected create leaves behind |

Type-level strictness means a test can fail to compile rather than fail to assert, which
is why the tests route values through helpers: `const good = asResult(ok(42))` keeps the
type checker from narrowing a literal two lines earlier and proving the branch for us.

Deliberately untested here, and where it belongs instead: pixel output (goldens in stage
8), the WebSocket bridge (stage 5, against a real service), and canvas rendering (stage 7,
with a headless canvas harness).

## 10.12 Performance strategy

| Rule | Why |
| --- | --- |
| The bundle is budgeted, not measured afterwards | Today: 248 kB raw / 77 kB gzip for a boot screen, a client, a socket and one panel. A route-level split comes with routing (stage 6). |
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
| `make dev` | `npm run dev` | Service and Vite dev server together, proxied, with the token attached |

`make check` runs the backend gates and, **where npm is installed**, `frontend-check` —
so a backend-only contributor is not blocked by a toolchain the backend does not use,
while CI, which has both, always runs the whole thing.

## 10.14 What is not built yet

| What | Stage |
| --- | --- |
| Commands, undo/redo and optimistic updates in `stores/` — the loop the timeline is edited through | 7 |
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
| `tests/api/test_ws_protocol_mirror.py` | The WebSocket frames, held against `nova_studio/api/ws.py` because they cannot be generated |
