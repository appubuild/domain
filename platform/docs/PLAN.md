# AURA — Implementation Plan

AURA (Adaptive Unified Reasoning Agent) is the Personal AI Agent Platform. This monorepo
lives in `platform/` next to the pre-existing marketing site so the product is isolated.

## Ground truth about this environment (read before judging completeness)

| Capability | Available here | Consequence |
| --- | --- | --- |
| Node 22.22 (`node:sqlite` with FTS5) | Yes | Real SQLite persistence, real server, real API tests |
| npm registry | Yes | Frontend + server dependencies install and build |
| Rust / cargo | **No** | Tauri/Windows code ships as source; cannot be compiled or run in this sandbox |
| Browsers (Chromium/Firefox) | **No**, and browser CDNs are blocked | Playwright E2E specs ship ready-to-run; executed suites are Vitest (node + jsdom) and API integration tests |
| Provider API keys | None | Provider adapters are tested against recorded fixtures + a live "test connection" path; no fake "connected" state is ever shown |
| VRM character assets | None licensed | Ships a real procedural skeletal avatar system (7 distinct families) + a full VRM loading pipeline; VRM files are user-importable |

## Target architecture

```
platform/
  packages/core        Provider-independent domain logic (strict TS, no React, no Tauri)
    src/avatar         State machine, expression controller, viseme/lip-sync, skeleton
    src/characters     7 template families, zod schemas, import/export
    src/memory         Extraction, scoring, dedupe, hybrid search, retention
    src/providers      OpenAI / Anthropic / Google / OpenAI-compatible adapters
    src/router         Model router + fallback chain
    src/agent          Planner, orchestrator, permissions, verification, stop control
    src/skills         Skill registry, default catalog, tool-call bridge
    src/voice          Voice session state, VAD, transcript, interruption
    src/licensing      Entitlements, signed-license verification, offline grace
    src/platform       Capability interfaces + Windows/macOS/Web/iOS adapters
    src/db             Versioned SQL migrations + repositories (node:sqlite driver)
  apps/server          Local-first HTTP + SSE + WebSocket server (Node, zero framework)
  apps/app             React + Vite + Tailwind + R3F desktop/web UI
  apps/desktop         Tauri 2 shell + Rust backend (source only in this sandbox)
```

## Phases

1. **Foundation** — monorepo, TS strict, Tailwind design tokens, migration runner, server skeleton, app shell, dashboard.
2. **Characters** — 7 families with distinct geometry/palette/personality, Character Studio, persistence, switching, import/export.
3. **Avatar** — procedural rig, idle/breathing/blink, expressions, visemes, speech-driven lip sync, state machine, display modes.
4. **AI providers** — adapters, encrypted credentials, router, streaming chat, real model listing/testing, usage accounting.
5. **Memory** — 4 layers, extraction, importance, consolidation, FTS5 + embeddings, Memory Center, isolation guarantees.
6. **Voice** — mic capture, VAD, Gemini Live proxy, OpenAI audio, browser TTS fallback, interruption, transcript, avatar sync.
7. **Skills + Agent** — registry, tool calling, MCP client, planner, queue, pause/resume/cancel/retry, verification, Teach My Agent.
8. **Automation** — Playwright (server), Windows UI Automation adapter (via PowerShell/UIA), file ops, permission gates, emergency stop.
9. **Auth + licensing** — Google OAuth, dev local license, signed entitlements, device activation, subscriptions.
10. **Hardening** — tests, security review, docs, packaging instructions.
