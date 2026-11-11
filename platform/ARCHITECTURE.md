# AURA — Architecture

AURA is a **local-first desktop application** built as a small monorepo with hard seams:
a domain library, a server, a UI, and a thin native shell. This document explains what each
layer owns, how a request flows through them, and why the boundaries are where they are.

---

## 1. Deployment shapes

The same code runs in two shapes. Nothing about the domain logic changes between them.

```
┌──────────────────────────── Browser (dev / server mode) ────────────────────────────┐
│  Vite dev server :5173  ──proxy──▶  AURA server :8787  ──▶  node:sqlite (your disk)  │
└─────────────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────── Windows desktop (Tauri 2) ──────────────────────────────┐
│  ┌──────────────────────────┐   IPC (allow-listed)   ┌──────────────────────────┐    │
│  │ WebView: apps/app dist   │ ─────────────────────▶ │ Rust shell               │    │
│  │ (React + three.js)       │                        │  • supervises server     │    │
│  └──────────────────────────┘                        │  • control bridge        │    │
│             │  HTTP/WS to 127.0.0.1:8787             │  • emergency stop flag   │    │
│             ▼                                        └────────────┬─────────────┘    │
│  ┌──────────────────────────┐      child process                 │ Win32 (gated)     │
│  │ AURA server (Node 22)    │ ◀──────────────────────────────────┘                   │
│  │ node:sqlite + FTS5       │                                     │                  │
│  └──────────────────────────┘                                     ▼                  │
└────────────────────────────────────────────────────────────────  OS ────────────────┘
```

**Why a separate server process instead of embedding everything in Rust?** The domain logic
(providers, memory, planning) is TypeScript and heavily tested. Keeping it in one place — a
process the desktop shell *supervises* rather than reimplements — means the browser build and
the desktop build execute identical code. The Rust shell only does what TypeScript cannot:
OS-level automation, process supervision and secure local storage.

---

## 2. Layers

### 2.1 `@aura/core` — the domain library

No React, no Tauri, no HTTP. Pure functions and classes with injected dependencies, so every
rule is unit-testable.

| Module | Responsibility |
| --- | --- |
| `characters/` | Zod schemas for the whole character contract, seven template families, import/export |
| `db/` | Schema migrations (v1–v3), repositories for characters, conversations, memories, documents, skills, tasks, credentials, usage, audit, licensing; `SqlDriver` abstraction with a Node driver (`node:sqlite`) and a Tauri driver |
| `memory/` | Extraction heuristics, importance scoring, dedupe, decay, hybrid retrieval, deterministic embeddings |
| `avatar/` | State machine, expression controller, viseme tables + lipsync engine, VAD, `AvatarEngine` (the single source of pose truth) |
| `providers/` | Adapters for OpenAI, Anthropic, Google and OpenAI-compatible endpoints; SSE parser; pricing table |
| `router/` | Chooses a provider/model per request; fallback chain; typed failures |
| `skills/` | Skill types, registry, 15 built-ins with declared permissions + verification |
| `agent/` | Planner, permission engine, verification, orchestrator, system-prompt assembly with injection scanning |
| `voice/` | Voice session phases, transcript accumulation, interruption semantics |
| `chat/` | Streaming chat service that stitches prompt + memory + knowledge + tools |
| `licensing/` | Signed-license verification (Ed25519), offline grace, entitlement mapping |
| `secrets/` | AES-256-GCM vault, key-shape validation, hinting |

### 2.2 `apps/server` — HTTP + WebSocket surface

`node:http` with an explicit route table (no framework), Zod validation on every body, and a
single error envelope. Two WebSocket endpoints:

- `/ws/events` — one-way broadcast of `task.*`, `character.updated`, `settings.changed`,
  `emergency-stop`, `skill.*`, `slow.request`.
- `/ws/live-voice` — the Gemini Live bridge. The provider key stays in this process; the
  browser sends 16 kHz PCM and receives 24 kHz PCM, transcripts and interruption signals.

Serving: the server also hosts the built UI (`apps/app/dist`) with a traversal-guarded static
handler and SPA fallback, so `npm start` gives you a complete app on one port.

### 2.3 `apps/app` — the UI

React 19 + Vite. Zustand for cross-page state (active character, connection), TanStack Query
for server state, React Router 7 for navigation, Tailwind for the dark-navy/cyan design
system, React Three Fiber for the avatar stage.

**Rule: the UI never fakes state.** Loading, empty, error and "not configured" are distinct
rendered states. When the server is unreachable the shell says so and offers a retry — it does
not show stale demo data.

### 2.4 `apps/desktop` — Tauri shell

- `server.rs` — spawns `node apps/server/dist/main.js`, tracks liveness via `try_wait`, kills
  the child on window destroy, and reports real status to the UI.
- `bridge.rs` — the computer-control bridge. Every command checks the emergency-stop flag,
  validates bounded inputs (coordinates, key allow-list, app allow-list), resolves workspace
  paths with canonicalisation + prefix checks, and appends an audit record. **There is no
  generic `run_command`.**
- `capabilities/*.json` — the webview gets `core:default` plus dialogs; it does *not* get
  arbitrary shell, filesystem, or process permissions.

---

## 3. Data model

SQLite, WAL mode, foreign keys on, FTS5 virtual tables for messages and memories.

```
characters ─┬─< conversations ─< messages
            ├─< memories (layer, embedding vector, pinned, importance)
            ├─< documents ─< document_chunks (FTS5)
            └─< tasks ─< task_events

app_settings        key → JSON (appearance, voice, memory, privacy, hotkeys…)
credentials         provider → AES-GCM ciphertext + hint (never plaintext)
permissions         permission → allow | ask | deny
usage_events        provider/model tokens + cost per request
audit_log           every privileged action with actor + outcome
license_state       signed license + account binding
skills              installed/overridden skill records
mcp_servers         endpoint, transport, encrypted bearer token, tool list
integrations        per-integration status + last error
```

Cascade behaviour is explicit: deleting a character removes its conversations, memories and
documents (tested), while provider credentials and installed skills survive.

---

## 4. Request flows

### 4.1 Text chat (streaming)

```
UI ──POST /api/chat/stream──▶ server
                              ├─ load character (config, permissions)
                              ├─ build system prompt (personality, traits, style)
                              ├─ retrieve memories (if memoryAccess)   ← hybrid search
                              ├─ retrieve knowledge chunks             ← FTS + vector
                              ├─ wrap untrusted content, scan for injection
                              ├─ choose model via router (provider/model/fallback)
                              └─ stream SSE: {type:'delta'} … {type:'done'}
                                     ▲
                                     └── persist user + assistant messages,
                                         record usage, extract memory candidates
```

Failures are streamed as `{type:'error'}` with the provider's message. With no key configured
the first event is a typed `not_configured` error — never a canned reply.

### 4.2 Live voice (duplex)

```
UI mic ─16k PCM─▶ /ws/live-voice ─▶ GoogleLiveBridge ─▶ Gemini Live
UI      ◀─24k PCM / partial transcripts / interrupt─ bridge
```

The `AvatarEngine` is fed *measured* mic RMS during listening and *measured* output amplitude
during playback. Viseme timing from TTS is used when available; otherwise the mouth is driven
by amplitude. The UI labels the mode, because amplitude-driven mouth motion is not
phoneme-accurate lip sync.

### 4.3 Agent task

```
POST /api/tasks
  ├─ planDeterministic(goal, availableSkills, permissions)   → steps with risk + verification
  ├─ persist task (status queued)
  └─ enqueue ─▶ orchestrator
        for each step:
          permission check ─▶ denied? emit event and stop
          high risk or 'ask'? ─▶ status awaiting_confirmation
          execute skill ─▶ verify output ─▶ append task_event
        emergency stop engaged anywhere? ─▶ abort immediately
```

Two lifecycle edges are handled explicitly rather than left to chance:

- **Scheduling.** A task created with `scheduledFor` is persisted as `queued` and *not* enqueued.
  A server-side interval (`apps/server/src/services/scheduler.ts`, 15 s) releases tasks whose
  time has arrived — clearing `scheduledFor` first, so a task can never be enqueued twice — and
  ticks once on boot, so a task that came due while the app was closed still runs.
- **Restart.** `running`/`queued` rows from a dead process have no runtime and would otherwise
  show "in progress" forever. `recoverOrphans()` marks them failed with an explicit reason.
  Tasks with a `scheduledFor` are deliberately exempt: they are *waiting*, not orphaned.

### 4.4 Character edit

```
Studio draft ─PATCH /api/characters/:id {config}─▶ server
   ├─ deep-merge patch onto stored config (arrays replace, undefined ignored)
   ├─ validate the MERGED object with the Zod character schema
   ├─ 400 with issues if invalid — nothing partial is written
   └─ persist + broadcast character.updated
```

The deep merge exists because patching `personality.humor` must not erase
`personality.systemPrompt`. The Zod pass exists because a merge can still produce an invalid
combination.

---

## 5. Design decisions worth knowing

**Deterministic local embeddings.** `aura-hash-v1`, 256 dimensions, no network call. Retrieval
quality is below a neural embedding model, but it keeps the promise that indexing your memory
never sends text anywhere. The interface allows swapping in a provider embedding later.

**Explicit route table.** A framework was unnecessary for ~50 endpoints, and a hand-written
`matchRoute` made the ordering bug class visible (static paths must be matched before `/:id` —
this is enforced by tests that hit `/api/conversations/search` and `/api/memory/export`).

**Capabilities are derived, never assumed.** `/api/system/info` reports
`computerControl: capabilityMode === 'desktop' && bridge URL present`. The UI shows "Server
mode" with an explanation instead of a dead button.

**Licensing without pretending.** The verifier checks a real Ed25519 signature and a device
binding. With no signing key configured the app reports `unlicensed`, and development mode is
opt-in via `AURA_DEV_LICENSE=1` and labelled as development in the UI. There is no simulated
checkout anywhere in the codebase.

**One avatar engine, many views.** The dashboard, Character Studio preview and Live Voice all
render from the same `AvatarEngine` contract, so the character cannot animate differently in
different pages. Rendering reads pose data; it never invents motion.

---

## 6. Deliberate non-goals (this build)

- No cloud sync service, no AURA-hosted inference, no telemetry endpoint.
- No community skill marketplace — import is a reviewed JSON manifest.
- No phoneme-accurate lip sync; the amplitude/viseme-estimate approach is what ships.
- No VRM assets bundled; the loader path exists for user-supplied licensed models.
