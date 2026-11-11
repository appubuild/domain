# AURA — Testing

AURA ships **170 automated tests** across three suites plus a set of ready-to-run specs for
the parts this environment cannot execute. This document says what each suite proves, how to
run it, and what it deliberately does not cover.

```bash
cd platform
npm run typecheck   # strict TS across core, server, app (and desktop shim)
npm run test        # 110 core + 35 server + 25 app
npm run build       # core dist → UI bundle → server dist
```

---

## 1. Suites

### `packages/core` — 110 tests, 9 files

Pure domain logic against a real SQLite database (a temp file per test, migrated through the
real migration chain).

| File | Proves |
| --- | --- |
| `db.test.ts` | Migrations v1→v3 apply on a fresh DB, are idempotent, and expose the expected schema version; repositories round-trip characters, conversations, memories, documents, skills, tasks, credentials, usage and audit; cascade delete removes dependent rows; FTS5 queries work |
| `memory.test.ts` | Embeddings are deterministic and unit-normalised (`aura-hash-v1`, 256 dims); extraction produces candidates from real sentences; importance scoring is bounded; dedupe collapses near-identical memories; hybrid retrieval ranks pinned/important items higher; retention prunes expired rows and keeps pinned ones |
| `avatar.test.ts` | State machine accepts only legal transitions and refuses `IDLE → INTERRUPTED`; expression blending converges; viseme tables are normalised 0..1; amplitude lipsync responds to RMS; VAD decides on real energy/zcr characteristics |
| `providers.test.ts` | SSE parsing handles split chunks, multi-line data, comments and `[DONE]`; request bodies for OpenAI/Anthropic/Google match each API's shape; typed provider errors (auth, rate limit, context overflow) are classified; pricing estimates are monotonic in token count |
| `agent.test.ts` | Planner produces ordered steps with risk + verification; permission engine refuses `deny`, honours `ask`, and emergency stop blocks all; verification rejects steps whose assertions fail; injection scanner flags override attempts |
| `licensing.test.ts` | Ed25519 signatures verify; tampered payload, wrong device, expired license and missing key are each rejected with distinct reasons; dev mode is explicit and never grants a "purchased" state |
| `voice.test.ts` | Session phases follow the documented order; transcripts accumulate; interruption resets playback state and marks the turn interrupted |
| `knowledge.test.ts` | Text extraction detects formats; chunking respects paragraph boundaries and size limits with overlap; unsupported binaries are rejected rather than silently producing empty text |
| `filesystem.test.ts` | The workspace adapter against a **real temp directory**: `*`/empty/`*.md`/substring search semantics, reads and writes, lexical traversal refusal, symlink escape refusal, and the pure `isWithinRoot` guard (including the `/work/agent` vs `/work/agentical` prefix case) |

### `apps/server` — 35 tests, 2 files

An **API integration** suite. Each test boots the real app with a temp data directory, real
migrations and a real HTTP listener on an ephemeral port, then talks to it with `fetch`. No
mocks of the server internals.

Coverage highlights:

- health + `system/info` honesty (server mode never claims computer control)
- settings merge semantics
- seven templates with distinct palettes and five render families
- character create / duplicate-name 409 / **deep-merge config patch** / duplicate / default /
  export / import / cascade delete
- memory isolation between characters, CRUD, consolidation, retention, export/clear
- conversation CRUD and full-text search
- SSE returns a typed error when no provider key exists (never a fake answer)
- provider key encryption: stored ciphertext starts with `v1.`, response contains only the
  hint, plaintext never appears in any response
- key-shape rejection, base-URL requirement for OpenAI-compatible endpoints
- skill run, permission gate, computer-mode block, untrusted import starts disabled
- task planning, cancellation, end-to-end execution, confirmation, emergency stop
- document ingest / search / unsupported-type 422
- licensing honesty, no simulated subscription, OAuth-unconfigured → 503
- integrations honesty, stdio MCP refusal
- voice availability, 501 when unconfigured, viseme endpoint
- redacted backup, reset confirmation requirement
- the task **scheduler**: a due scheduled task is enqueued exactly once, future ones keep
  waiting, and a task whose character was deleted fails with a clear reason

### `apps/app` — 25 tests, 4 files

Two kinds of test:

1. **Client logic** (`api.test.ts`, `utils.test.ts`) — the fetch wrapper's URL prefixing, JSON
   handling, typed errors, 428 confirmation detection and non-JSON error fallback; formatting
   helpers (including "tiny cost must not round to $0.00").
2. **Real component rendering** (`uiSmoke.test.tsx`, `avatarRig.test.tsx`) — the actual React
   tree mounted in jsdom against shape-accurate API stubs:
   - all twelve sidebar destinations render as links
   - the dashboard renders server data and does **not** claim computer control in server mode
   - the character grid renders per-character metadata
   - Character Studio exposes all ten tabs and switching to Personality edits the real prompt
   - a save issues a PATCH whose body carries `config.personality`
   - the avatar engine produces a finite, bounded pose in every reachable state; the mouth
     closes when audio stops; amplitude drives openness; barge-in moves through `INTERRUPTED`

---

## 2. What is *not* covered here

| Gap | Why | What exists instead |
| --- | --- | --- |
| Browser E2E (Playwright) | No browser binaries and CDN downloads are blocked in the authoring sandbox | Component-level rendering tests in jsdom + a documented manual checklist (`TESTING.md` §5) |
| Rust/Tauri compilation and bridge tests | No `cargo` in the sandbox | `bridge.rs` contains unit tests for traversal, audit ring and emergency stop; they run with `cargo test` once a toolchain exists |
| Live provider calls | No API keys | Adapters tested against fixtures; a "Test connection" button performs a real call when you add a key |
| Real WebGL rendering | jsdom has no WebGL | `AvatarStage` is stubbed in component tests; the engine→pose contract is tested directly |
| OS automation | Linux sandbox, Windows-only bridge | The bridge refuses cleanly (`Unsupported`) off-Windows, which is itself tested behaviour |

---

## 3. Running individual suites

```bash
npm test -w @aura/core                                   # domain
npm test -w @aura/server                                 # API integration
npm test -w @aura/app                                    # UI + client logic
npm test -w @aura/server -- test/api.test.ts -t "memory" # one group
```

Notes:

- `@aura/core` must be built (`npm run build -w @aura/core`) before the apps resolve it — the
  barrels point at `dist/` with declaration files.
- Server tests run with `pool: 'forks'` and `fileParallelism: false` because they open real
  SQLite files; this is intentional, not a workaround for flakiness.
- Every Vitest config sets `css.postcss.plugins` explicitly. The repository root contains the
  legacy marketing site's `postcss.config.js`, and Vite walks upward looking for it.

---

## 4. Regression tests worth keeping

These exist because the corresponding bug actually happened during development:

| Test | Bug it guards |
| --- | --- |
| `characters > updates, duplicates…` | A partial config patch wiped `systemPrompt`/`traits` → shallow merge. Now deep-merged **and** re-validated with Zod |
| `characters > creates from template` duplicate name | The template path skipped the 409 name-conflict check |
| `conversations` / `memory` / `documents` search | Static routes were shadowed by `/:id` matching. Route order is now asserted by these tests |
| `health + system` capabilities | The endpoint reported character-level capability gating as platform truth |
| `uiSmoke > character grid` | `IdentityTab` crashed on a partial detail payload → optional chaining + a "—" fallback |
| `api > tiny cost` | `$0.0004` rendered as `$0.00`, hiding real spend |
| `agent > keeps function handlers intact when queueing through enqueue()` | `TaskOrchestrator.enqueue` JSON-round-tripped its input, dropping the `buildContext` **function** → every queued task failed step 1 with `buildContext is not a function` |
| `agent > marks tasks interrupted by a restart as failed…` / `…future-scheduled tasks untouched` | Tasks persisted as `running`/`queued` had no runtime after a restart and stayed "in progress" forever. `recoverOrphans()` now fails them with a reason — but must *not* touch `scheduledFor` tasks |
| `scheduler > enqueues a due scheduled task once…` | `scheduledFor` was stored by the API and shown in the UI but **nothing ever executed it**. A real interval scheduler now releases due tasks exactly once |
| `filesystem > refuses a symlink that points outside the workspace` | Workspace containment was lexical only, so a symlink planted inside `workspace/` read real files outside it. Containment is now checked against the resolved real path |
| `filesystem > lists everything for a wildcard query` | `files.search` treated `*` as a literal substring → the planner's "inspect my folder" step always reported "Found 0 matching files" |
| `KnowledgeTab` upload (`fileName`) | The upload sent `filename`; the API requires `fileName` → every document upload failed validation |
| `SettingsPage` permission toggle | The page hard-coded permission ids (`filesystem`, `shell`…) that are not in the server enum → `PUT /api/permissions` always 400 |
| `documents/search` merge | Lexical hits were keyed by id and semantic hits by a composite key → the same chunk was returned twice |

---

## 5. Manual checklist (things only a human with a real desktop can confirm)

Run the Windows build, then verify:

1. **Installer** — MSI and NSIS both install, launch, and the tray icon appears.
2. **Server supervision** — quit the app; confirm no orphaned `node` process holds the DB.
3. **WebGL avatar** — all seven templates render, animate idle, blink, and lip-sync to TTS.
4. **Microphone** — granting, denying and revoking permission mid-session each produce the
   documented state (session refuses, error shown, not a silent hang).
5. **Provider key** — add a real key, run "Test", confirm the models list appears; then read
   the SQLite row and confirm it is ciphertext.
6. **Automation** — with `computer` allowed, ask for a Notepad action; confirm the audit entry,
   then engage emergency stop and confirm the action is refused.
7. **Permission denial** — deny `files.read`, attempt a file task, confirm refusal at the
   server (not just hidden in the UI).
8. **Scheduled task** — schedule a task five minutes out, leave the app open, confirm it starts
   by itself at the scheduled minute; repeat with the app closed for that window and confirm it
   runs on next launch. Cancel a waiting task and confirm it never runs.
