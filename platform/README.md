# AURA — Personal AI Agent Platform

A local-first AI companion **and** agentic computer assistant. It runs on your machine, keeps
its memory in SQLite you own, uses **your** model-provider keys, and animates a real 3D
character that talks with you in real time.

> **Status: working software, with clearly marked external blockers.** Everything in this
> document that is described as working is executed by the test suite or was run by hand.
> Everything that cannot be verified in this environment (Rust/Tauri compilation, real
> provider calls, browser automation) is listed in
> [`DEVELOPMENT_STATUS.md`](./DEVELOPMENT_STATUS.md) and never presented in the UI as if it
> worked.

---

## What it is

| Area | What actually happens |
| --- | --- |
| **Characters** | 7 distinct templates (holographic analyst, natural male/female, two anime, coding expert, corporate assistant). Every character owns its avatar spec, personality, voice, model, memory scope and permissions. |
| **Character Studio** | 10 real editors — identity, avatar rig, personality, voice, intelligence, memory policy, skills, knowledge, behaviour, permissions — with a live 3D preview. Saving PATCHes the server and validates the merged config. |
| **Avatars** | A procedural WebGL rig (Three.js / React Three Fiber) generated from the character's `AvatarSpec`: head-shape families, hair silhouettes, outfits, accessories, palettes. Driven by an avatar engine with breathing, blink, gaze, expression blending and viseme mouth shapes. |
| **State machine** | `IDLE → LISTENING → THINKING/PROCESSING → SPEAKING → INTERRUPTED → ERROR`, with **validated transitions** (the machine refuses `IDLE → INTERRUPTED`). |
| **Voice** | Gemini Live duplex streaming through a server-side WebSocket bridge (key never reaches the browser), plus a genuine browser-speech fallback (`SpeechSynthesis` + `SpeechRecognition`). OpenAI TTS returns audio **and** estimated viseme timings. |
| **Memory** | 4 layers (short-term, long-term, episodic, knowledge), hybrid keyword + vector search with a **local deterministic embedding** (no data leaves the machine to build the index), dedupe, decay, pinning, consolidation, retention. |
| **Agent core** | Provider-independent. Model router over OpenAI / Anthropic / Google / OpenAI-compatible, streaming, typed errors, usage accounting. |
| **Skills** | 15 built-in skills with JSON-schema inputs, declared permissions and verification rules; registry, per-character overrides, import with untrusted-by-default handling. |
| **Tasks** | Deterministic planner → permission gate → executor with per-step verification and an event log. High-risk steps stop for approval; emergency stop blocks everything. |
| **Desktop** | Tauri 2 shell: supervises the local server, exposes a permission-gated, audited computer-control bridge, imports no ambient shell/FS capability into the webview. |

## Quick start

```bash
cd platform
npm install

# build the shared library once (the apps import its compiled output)
npm run build -w @aura/core

npm run dev          # server on :8787 + Vite UI on :5173
# or run the production build:
npm run build && npm start   # http://localhost:8787
```

Requirements: **Node.js ≥ 22.5** (uses the built-in `node:sqlite` with FTS5). No database
server, no Docker, no cloud account.

Optional, for real AI answers: open **AI Models** and paste an OpenAI, Anthropic or Google
API key. Until then the app runs fully — memory, characters, knowledge, skills, tasks — but
chat returns a **typed "no provider configured" error** instead of inventing a reply.

### Desktop (Windows)

```bash
npm run desktop:dev      # requires Rust 1.77+ and the Tauri prerequisites
npm run desktop:build    # produces MSI + NSIS installers
```

The Rust shell could not be compiled in the environment where this was authored — see
[`DEVELOPMENT_STATUS.md`](./DEVELOPMENT_STATUS.md#what-could-not-be-verified).

## Repository layout

```
platform/
  packages/core/        Domain library — no React, no Tauri, strict TS
  apps/server/          HTTP + WebSocket server (node:http), API integration tests
  apps/app/             React 19 UI (Vite, Tailwind, R3F, Zustand, TanStack Query)
  apps/desktop/         Tauri 2 shell (Rust) — server supervision + control bridge
  docs/                 ARCHITECTURE, DEVELOPMENT_STATUS, TESTING, PLAN
```

The repository root also contains the **pre-existing Safe Home Network marketing site**
(static pages + PHP `api/`). It is untouched and remains deployable; AURA lives entirely in
`platform/`.

## Documentation

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — layers, data model, request flows, design decisions
- [`SECURITY.md`](./SECURITY.md) — threat model, secret handling, permission model, what is *not* protected
- [`TESTING.md`](./TESTING.md) — what is tested and how to run it
- [`DEVELOPMENT_STATUS.md`](./DEVELOPMENT_STATUS.md) — honest feature-by-feature status
- [`docs/PLAN.md`](./docs/PLAN.md) — environment ground truth and original plan

## Verification

```bash
npm run typecheck    # core, server, app, desktop — all clean
npm run test         # 95 core + 33 server + 25 app tests
npm run build        # emits core dist, UI bundle and server dist
```

## License and third-party assets

No third-party character models, art or fonts are bundled. All avatar geometry is generated
procedurally at runtime from data, which keeps the asset licensing story simple: what you see
is produced by this codebase. See [`SECURITY.md`](./SECURITY.md#assets-and-licensing) for the
policy on user-supplied VRM models.
