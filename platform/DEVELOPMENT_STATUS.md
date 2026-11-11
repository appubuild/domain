# AURA — Development Status

**As of: 2026-11-11.** This file is the honest ledger. If something is not listed as working,
it either is not implemented or could not be verified in the authoring environment.

Legend: **✅ working & tested** · **🟡 implemented, unverified here** · **⛔ blocked by the environment** · **⬜ not implemented**

---

## 1. Environment ground truth (why some things are unverified)

| Capability | Present in the authoring sandbox? | Consequence |
| --- | --- | --- |
| Node.js 22.22 | ✅ | Server, DB, tests all execute for real |
| npm registry | ✅ | Dependencies install and build |
| `node:sqlite` + FTS5 | ✅ | Real persistence, real full-text search |
| Rust / `cargo` | ⛔ **no** | The Tauri shell is authored, not compiled |
| Chromium / Firefox binaries | ⛔ **no** (downloads blocked) | No browser E2E; jsdom component tests instead |
| WebGL / GPU | ⛔ **no** | 3D rig verified through the engine→pose contract, not pixels |
| Provider API keys | ⛔ **none** | No live provider call was made |
| Windows APIs | ⛔ **no** (Linux) | Computer control cannot run; bridge refuses cleanly |

---

## 2. Feature status

### Characters & Character Studio

| Item | Status | Evidence / note |
| --- | --- | --- |
| Seven distinct character templates | ✅ | API test asserts 7 palettes, 5 render families |
| Full character contract (identity, personality, voice, intelligence, memory, permissions) | ✅ | Zod schemas in `core/src/characters/types.ts` |
| Create from template, duplicate, set default, rename, export, import | ✅ | Server integration tests |
| Cascade delete (conversations, memories, documents, tasks) | ✅ | Asserted in `api.test.ts` |
| Deep-merge config patching with validation | ✅ | Regression test for the shallow-merge bug |
| Character Studio — 10 editors with live preview | ✅ | UI test asserts all ten tabs + a real PATCH on save |
| Profile image support | 🟡 | Schema accepts a data URL; no image cropper UI |

### Avatars & animation

| Item | Status | Evidence / note |
| --- | --- | --- |
| Procedural 3D rig from `AvatarSpec` | ✅ | `AvatarModel.tsx`; geometry families for head/hair/body/accessory |
| Head-shape families, hair silhouettes, outfits, accessories, palettes | ✅ | Driven by spec; template test asserts family variety |
| Idle breathing, blink, gaze, expression blending | ✅ | `avatarRig.test.tsx` asserts bounded, finite poses |
| Viseme-driven mouth shapes | ✅ | `VISEME_SHAPES` normalised; mouth follows the lipsync engine |
| Validated state machine (`IDLE…ERROR`) | ✅ | Tests assert illegal transitions are refused |
| Barge-in → `INTERRUPTED` → `LISTENING` | ✅ | Tested with a fake-timer-free wait |
| WebGL rendering in a browser | ⛔ | No GPU/browser here; falls back to a clear message, never a blank canvas |
| VRM import of user-licensed models | 🟡 | Loader path and `avatarModel: 'vrm'` exist; no VRM file was available to test |
| Phoneme-accurate lip sync | ⬜ | Deliberately not claimed; amplitude + estimated visemes only |

### Voice

| Item | Status | Evidence / note |
| --- | --- | --- |
| Gemini Live duplex bridge (server-side key) | 🟡 | Implemented (`ws/liveVoice.ts`, `GoogleLiveBridge`); no key to verify |
| 16 kHz PCM up / 24 kHz PCM down playback | 🟡 | Implemented with a real `AudioContext` + PCM queue |
| Provider transcripts + interruption events | 🟡 | Wired; unverified without a key |
| OpenAI TTS with viseme header | 🟡 | Proxy implemented; requires an OpenAI key |
| Browser speech synthesis fallback | ✅ | Real `SpeechSynthesis`; used when no key exists |
| Browser dictation (`SpeechRecognition`) | ✅ | Feature-detected, errors surfaced verbatim |
| VAD / turn detection | ✅ | `EnergyVad` unit-tested (core) |
| Microphone permission failure handling | ✅ | Session refuses with a typed error and the UI shows it |

### Memory

| Item | Status | Evidence / note |
| --- | --- | --- |
| Four layers with per-character isolation | ✅ | Repo + service tests |
| Hybrid retrieval (FTS + vector), importance/pin boosting | ✅ | `memory.test.ts` |
| Local deterministic embeddings (no network) | ✅ | Determinism + dimension tests |
| Automatic extraction & importance scoring | ✅ | Heuristic extraction tested |
| Dedupe, consolidation, retention pruning | ✅ | Tested, including pinned-row survival |
| Memory Center UI (search, filter, pin, edit, delete, export) | ✅ | Rendered in UI tests; mutations hit real endpoints |
| Neural-quality embeddings | ⬜ | Not used by design (privacy); interface allows a swap |

### Intelligence & providers

| Item | Status | Evidence / note |
| --- | --- | --- |
| OpenAI / Anthropic / Google adapters | 🟡 | Request/response shapes tested against fixtures; no live call |
| OpenAI-compatible endpoints (custom base URL) | ✅ | Validation + base-URL requirement tested |
| Model router + fallback chain | ✅ | Unit-tested selection and failure classification |
| Streaming chat with SSE | ✅ | Server streams deltas; tested for the no-key error path |
| Usage accounting + cost estimation | ✅ | Recorded per request; summary endpoint tested |
| Provider key encryption (`v1.` AES-GCM ciphertext) | ✅ | Asserted that plaintext never appears in DB or responses |
| Key "Test connection" | 🟡 | Implemented; needs a real key |
| Live model list from provider | 🟡 | Implemented with a documented catalogue fallback |

### Agent, skills & automation

| Item | Status | Evidence / note |
| --- | --- | --- |
| 15 built-in skills with schemas, permissions, verification | ✅ | Registry + builtin tests |
| Skill registry, per-character overrides, global enable/disable | ✅ | API tests including permission gate |
| Untrusted skill import (starts disabled, shell refused) | ✅ | Tested |
| Deterministic planner with risk + verification | ✅ | Unit-tested |
| Orchestrator with confirmation gate and event log | ✅ | End-to-end task test |
| Restart recovery for interrupted tasks | ✅ | `recoverOrphans()` fails tasks left `running`/`queued` by a dead process with a reason; live-verified across a server restart |
| Scheduled tasks (`scheduledFor`) | ✅ | Real 15s scheduler releases due tasks exactly once; on boot overdue tasks run too. Verified live: a task scheduled 40s out fired and completed on its own |
| Emergency stop (global kill switch) | ✅ | Blocks tools server-side; tested |
| Audit log of privileged actions | ✅ | Written on every mutation; endpoint tested |
| Filesystem sandbox inside the workspace | ✅ | `filesystem.test.ts` runs against a real temp dir: lexical traversal **and** symlink-escape refusal (containment is checked against `realpath`); Rust duplicate guard with tests |
| Desktop computer control (mouse/keyboard/windows) | ⛔ | Rust bridge refuses off-Windows; Win32 calls are behind `cfg(windows)` and were not compiled |
| Browser automation (Playwright) | ⛔ | Requires the desktop runtime; no browsers in this sandbox |
| MCP over HTTP/SSE | 🟡 | Persisted config + encrypted token; handshake implemented, unverified against a live server |
| MCP over stdio | ⛔ | Refused by design in server mode (would execute local binaries) |
| "Teach My Agent" skill proposals | ✅ | Proposal endpoint; approval required before enabling |

### Desktop shell

| Item | Status | Evidence / note |
| --- | --- | --- |
| Tauri 2 project (config, capabilities, icons, Rust sources) | 🟡 | Authored; **never compiled** — no Rust toolchain |
| Server supervision (`spawn`, `try_wait`, kill on close) | 🟡 | Written; not executed |
| Permission-gated, audited control bridge | 🟡 | Pure-Rust unit tests included for traversal/audit/stop |
| Capability allow-list (no ambient shell/FS in webview) | 🟡 | `capabilities/*.json` restricts the webview |
| Installers (MSI/NSIS) | ⛔ | `tauri build` was not run |
| Tray icon, global hotkeys registration | ⬜ | Settings are stored and the UI says so; OS registration is not wired |

### Licensing & accounts

| Item | Status | Evidence / note |
| --- | --- | --- |
| Ed25519 license verification, device binding, expiry | ✅ | Unit tests for valid/tampered/wrong-device/expired |
| Development mode (opt-in, labelled) | ✅ | `AURA_DEV_LICENSE=1`; UI explains it is not a purchase |
| Subscription state from a real backend | 🟡 | Refresh implemented; no backend URL configured → reports unconfigured |
| Google OAuth sign-in | 🟡 | Full code exchange implemented; 503 without `GOOGLE_OAUTH_CLIENT_ID/SECRET` (tested) |
| Checkout / payment | ⬜ | Intentionally absent — no fake payments anywhere |
| License issuance UI/admin | ⬜ | Out of scope for the client build |

### UI/UX

| Item | Status | Evidence / note |
| --- | --- | --- |
| 12-item sidebar, dark-navy/cyan design system | ✅ | Test asserts all twelve render as links |
| Dashboard with live server truth, clock, usage, task summary | ✅ | Rendered against stubbed API in tests |
| Command palette (Ctrl/Cmd-K) with local search | ✅ | Wired to memory + conversation search |
| Every button performs a real action | ✅ | Audited during development; no `onClick={() => {}}` placeholders remain |
| Accessible labels on interactive controls | ✅ | Queried by role/label in UI tests |
| Reduced-motion support | ✅ | Media query + engine flag |
| Tailwind compiled into the bundle | ✅ | 38 KB of real utilities (was a bug: plugins were empty) |
| Light theme | ⬜ | Only the dark holographic theme is production-ready |

---

## 3. What could not be verified

These are the gaps a reviewer should treat as "written but unproven", not "done":

1. **Tauri compilation.** No `cargo`. Possible issues: Tauri 2 API drift, plugin versions,
   capability schema details, or Windows-only code paths.
2. **Win32 automation.** The mouse/keyboard/window commands return `Unsupported` on non-Windows
   and the real implementations are not present. The *permission, bounds and audit* logic
   around them is real and unit-tested.
3. **Live provider behaviour.** Auth, rate limits, streaming quirks and model names may have
   changed; adapters reflect the documented APIs at authoring time.
4. **Gemini Live.** Protocol fields (`realtimeInput.mediaChunks`, transcription flags) match
   the documented v1beta shape but were never exercised against the service.
5. **WebGL rendering.** Three.js scene composition is code-reviewed, not pixel-verified.
6. **Installer packaging.** Icon files are real PNG/ICO, but the bundle was never produced.

---

## 4. Known limitations (by design, not defects)

- Amplitude/estimated-viseme lip sync, not phoneme analysis.
- Local hash embeddings, not a neural embedding model (privacy trade-off).
- Development mode grants entitlements; it is explicitly labelled and disappears when the env
  var is removed. It is not a substitute for a license.
- Text-only knowledge ingestion (txt/md/json/csv/html). PDF/DOCX extraction is not implemented
  and unsupported types are rejected with a clear message rather than silently ignored.
- Server mode has no OS automation by definition — the UI says so instead of offering dead
  controls.

---

## 5. Suggested next steps

1. Compile the desktop shell on Windows (`npm run desktop:dev`), fix API drift, ship an installer.
2. Implement the Win32 input/window commands behind the existing gated commands.
3. Add Playwright E2E for the critical paths once a browser is available.
4. Wire tray icon + global hotkey registration in the Rust shell.
5. Add PDF/DOCX extraction to the knowledge pipeline (pure-JS, no cloud).
6. Consider a neural embedding provider behind the existing interface, opt-in per character.
