# Nova Studio — System Architecture

**Version:** 1.0.0 · **Status:** Approved · **Owner:** Architecture Group
**Supersedes:** — · **Applies to:** all of `nova_studio`, `frontend`, `apps/desktop`

---

## 1. Purpose of this document

This is the single source of truth for *how Nova Studio is put together*. Every module,
class, table, event and endpoint in the codebase must be traceable to a decision recorded
here or in `docs/architecture/adr/`.

If you are about to write code that this document does not describe, **write the document
first**. Architecture drift in a ten-year codebase is caused by undocumented decisions far
more often than by bad ones.

---

## 2. Product definition

Nova Studio is a **professional, offline-first, non-linear video editor** for desktop
(Windows portable EXE first, macOS/Linux supported by the same codebase), whose
differentiator is the **AI Caption Studio** — a speech-to-caption authoring environment of
a quality that standalone captioning tools do not reach.

| Property | Commitment |
| --- | --- |
| Offline | 100% of editing, rendering and ASR runs locally. Network is used only for optional model/template downloads and update checks. |
| Latency budget | UI input → visible response < 16 ms; any operation > 50 ms must be a background job with progress. |
| Data safety | No user action may lose project data. Autosave ≤ 30 s, crash recovery to last checkpoint. |
| Extensibility | Every subsystem is behind a port; every port has a default adapter and may be replaced by a plugin at runtime. |
| Portability | Single self-contained directory; no installer, no registry writes, no admin rights. |

### Non-goals (v1)

Real-time collaborative editing, cloud rendering, browser-only operation, mobile.
The architecture does not preclude any of them — see §12.

---

## 3. Top-level system view

```
┌───────────────────────────────────────────────────────────────────────────┐
│  Nova Studio Desktop (single OS process group)                            │
│                                                                           │
│  ┌─────────────────────────────┐        ┌──────────────────────────────┐  │
│  │  Native shell (pywebview)   │  JS    │  React 19 + TS + Tailwind 4  │  │
│  │  window mgmt, menus, tray,  │◄──────►│  UI layer (View + ViewModel) │  │
│  │  file dialogs, GPU surface  │ bridge │  Canvas/WebGL preview        │  │
│  └─────────────┬───────────────┘        └──────────────┬───────────────┘  │
│                │ spawn + supervise                     │ HTTP/WS (loopback)│
│                ▼                                       ▼                  │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │  Nova Core Service (Python) — FastAPI + uvicorn, 127.0.0.1           │ │
│  │                                                                      │ │
│  │  api/         REST + WebSocket (thin, no business logic)             │ │
│  │  services/    application services (use cases) + engines             │ │
│  │  domain/      pure entities, invariants, value objects (no I/O)      │ │
│  │  core/        event bus, DI container, commands, jobs, errors, ids   │ │
│  │  ports/       abstract interfaces (dependency-inversion seam)        │ │
│  │  infra/       adapters: SQLite, PyAV, OpenCV, Whisper, caches        │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                │                                       │                  │
│                ▼                                       ▼                  │
│  ┌───────────────────────────┐        ┌─────────────────────────────────┐ │
│  │  Media subsystems         │        │  Compute workers                │ │
│  │  FFmpeg (PyAV + static    │        │  ThreadPool: decode/composite   │ │
│  │  binary), OpenCV, NumPy,  │        │  ProcessPool: export/AI (GIL)   │ │
│  │  Pillow, GPU (optional)   │        │  JobScheduler with priorities   │ │
│  └───────────────────────────┘        └─────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────┘
                 │
                 ▼   %LOCALAPPDATA%/NovaStudio  (portable: ./NovaData)
     projects/  media-cache/  proxies/  thumbnails/  waveforms/  models/
     plugins/   templates/    fonts/    logs/        crash/       autosave/
```

### 3.1 Why a local HTTP/WS service instead of only the pywebview JS bridge

The pywebview bridge (`window.pywebview.api`) is synchronous-ish, single-channel, has no
back-pressure, no streaming and no cancellation. A video editor needs all four — progress
streams during export, live waveform data, cancellable ASR jobs, and high-frequency
timeline updates.

**Decision (ADR-0005):** the *only* channel between frontend and backend is
**HTTP/2-style REST + WebSocket over loopback**. The pywebview bridge is used solely for
native window concerns (minimise, fullscreen, native file dialogs, focus). Consequences:

* the frontend is fully testable in a browser against a real backend (headless mode),
* the same backend can be driven by a CLI or a future remote client,
* every capability is versioned, documented and rate-limited in one place,
* a plugin cannot monkey-patch the bridge and silently break the UI.

Loopback binding plus a per-session bearer token (issued at window creation, injected into
the frontend) prevents other local processes from driving the editor. See ADR-0005 §Security.

---

## 4. Layered architecture

Nova Studio uses **Clean Architecture** with four dependency rings. The rule is absolute:

> **Dependencies point inward. Never outward. Never sideways across a feature.**

```
        ┌──────────────────────────────────────────────────────┐
        │  L4  INTERFACE ADAPTERS      api/, infra/, apps/     │
        │      ┌──────────────────────────────────────────┐    │
        │      │  L3  APPLICATION        services/        │    │
        │      │      ┌──────────────────────────────┐    │    │
        │      │      │  L2  DOMAIN   domain/, ports/ │    │    │
        │      │      │      ┌──────────────────┐    │    │    │
        │      │      │      │ L1  CORE  core/  │    │    │    │
        │      │      │      └──────────────────┘    │    │    │
        │      │      └──────────────────────────────┘    │    │
        │      └──────────────────────────────────────────┘    │
        └──────────────────────────────────────────────────────┘
```

| Ring | Package | May import | Must never import | Contains |
| --- | --- | --- | --- | --- |
| L1 | `nova_studio/core` | **stdlib only** | domain, ports, services, infra, api, pydantic | Event bus, DI container, command/undo, errors, result type, clocks, ids, timecode. *Still to build:* job primitives, typed config |
| L2 | `nova_studio/domain`, `nova_studio/ports` | L1 | services, infra, api | Entities, value objects, invariants, domain events, **abstract** port protocols |
| L3 | `nova_studio/services` | L1, L2 | infra, api | Use cases, engines (render, caption, effects, transitions, text, audio, colour, animation, export, AI, plugin manager) |
| L4 | `nova_studio/infra`, `nova_studio/api` | L1, L2, L3 | — | Concrete adapters (SQLite, PyAV, OpenCV, Whisper, caches), FastAPI routers, DTO mappers |

`domain/` and `ports/` are both L2: the domain owns *what things are*, ports own *what the
outside world must provide*. Services depend only on ports; the DI container in L4 wiring
binds ports to infra adapters. **No service may `import av`, `import cv2`, `import
faster_whisper`, or `import sqlite3`.** This is enforced mechanically, not by convention, by
two gates that check different things: `scripts/check_layering.py` parses the import graph
with `ast` and rejects banned imports, ring-direction breaches, impure `domain`/`core`,
cross-feature imports inside `services` and package-escaping relative imports;
`tests/core/test_public_api.py` inspects the *loaded* module graph in a fresh subprocess,
which is what catches a transitive dependency no module names explicitly. Both run in
`make check`.

### 4.1 MVVM inside the frontend

The frontend mirrors the same discipline:

| MVVM role | Implementation |
| --- | --- |
| **Model** | `src/core/api/` typed client + `src/core/types/` — mirrors the backend DTOs, generated contract. |
| **ViewModel** | `src/stores/` — Zustand slices holding UI-observable state; all mutation goes through *actions* that call the API and apply optimistic updates + command/undo coordination. |
| **View** | `src/features/*/components` — presentational React components, no `fetch`, no business rules. |

A View may read a store and dispatch an action. It may **not** call the API client directly.
This keeps every interaction replayable and testable, and makes the backend the single
authority for project state (no split-brain between JS and Python).

---

## 5. Cross-cutting core mechanisms

These five mechanisms are what make the rest of the system possible. They are implemented
once, in `core/`, and reused everywhere.

### 5.1 Event Bus (`core/events.py`)

Typed, in-process publish/subscribe with three delivery modes.

```
Publisher ──► EventBus.publish(topic, payload)
                 │
                 ├─ sync handlers        (called inline; must not block > 1 ms)
                 ├─ queued handlers      (single-consumer loop; ordering guaranteed)
                 └─ outbox               (appended to WS bridge for the frontend)
```

* **Topics** are dot-namespaced constants declared in `domain/events.py`
  (`project.saved`, `timeline.clip.moved`, `render.frame.completed`, `caption.segment.updated`, …).
  Typos are impossible because topics are enum members, not strings.
* **Payloads** are frozen, slotted dataclasses deriving from `core.events.EventPayload`; a
  handler receiving an event cannot mutate it, and an undeclared field is a `TypeError` at
  construction rather than a silently ignored attribute. They are *not* pydantic models:
  `core` is stdlib-only, because a module-scope pydantic import in the kernel was measured
  to raise the L1 footprint from 51 modules (~50 ms) to 203 (~150 ms) and to pull in
  `socket`, `ssl`, `subprocess` and `urllib` — a cost every render worker and plugin host
  would pay (ADR-0002 rule 6). `EventEnvelope.to_wire()` duck-types `model_dump()`, so an
  outer ring may still publish a pydantic payload and have it serialised correctly.
* **Guarantees:** at-least-once for queued handlers, ordering per topic, handler exceptions
  are isolated (logged + counted, never propagated to the publisher).
* **Bridge:** every event carries `EventEnvelope{ topic, seq, ts, payload }`; `seq` is a
  monotonically increasing counter so the frontend can detect loss and request a resync.
* **Why not asyncio-native pubsub:** ASR, decode and export workers run in threads and
  processes; the bus must be safe from any context and must not require a running loop.

### 5.2 Dependency Injection container (`core/di.py`)

A small, explicit, typed service locator with three lifetimes:

| Lifetime | Meaning | Example |
| --- | --- | --- |
| `SINGLETON` | created once, shared | `EventBus`, `SettingsService`, `CacheManager` |
| `SCOPED` | one per project session | `ProjectService`, `TimelineCommandStack`, `AutosaveService` |
| `TRANSIENT` | new per resolution | `FrameRequest`, `RenderPass` |

Rules: registration is declarative in one composition root (`services/container.py`);
factories receive the container; cycles are detected **at registration time**, not at first
use; a plugin may `rebind(port, adapter)` which re-resolves scoped instances lazily.
No decorator magic, no import-time side effects — the graph is readable in one file.

### 5.3 Command pattern + Undo/Redo (`core/commands.py`)

**Every** mutation of project state is a `Command`:

```python
class Command(Protocol):
    command_id: str           # stable, for telemetry & shortcut mapping
    display_name: str         # shown in the Edit ▸ Undo menu
    def execute(self, ctx: CommandContext) -> Result[CommandOutcome]: ...
    def undo(self, ctx: CommandContext) -> Result[None]: ...
    def merge_with(self, previous: Command) -> Command | None: ...   # coalescing
    scope: CommandScope       # GLOBAL | TRACK | CLIP | CAPTION | NODE
```

* `CommandContext` exposes only ports the command needs (repositories, engines, clock) —
  a command cannot reach into infra directly, which keeps commands unit-testable.
* `merge_with` implements **coalescing**: dragging a clip emits 200 position updates that
  collapse into one undoable step. Merge policy is per-command, not global.
* The `UndoStack` is **per scope**: global timeline undo, plus independent stacks for the
  caption editor and the node/colour graph, so that undoing a colour tweak never destroys
  an edit decision.
* Commands publish `command.executed` / `command.reverted` events; autosave, WS broadcast
  and dirty-tracking are *subscribers*, not call sites. Adding a new reaction to edits
  requires zero changes to editing code (Open/Closed).

### 5.4 Job scheduler (`core/jobs.py`)

Long work never runs on the request path.

```
JobQueue(priority, kind) ──► JobScheduler ──► WorkerPool
   CRITICAL  user is waiting (thumbnail of a just-dropped clip)     thread pool
   HIGH      preview render of visible range                        thread pool
   NORMAL    export / proxy transcode                               process pool
   LOW       background AI (captions, scene detect)                 process pool
   IDLE      cache warm-up, waveform pre-generation                 thread pool
```

* Every job reports `progress(0..1)`, `stage`, `eta`, is **cancellable** (cooperative flag +
  hard-kill for processes), and persists its record to `ai_jobs`/`export_jobs` so a crash
  leaves an auditable trail.
* Job events flow to the frontend over the WS bridge → progress bars are reactive, not polled.
* Back-pressure: per-kind concurrency caps derived from CPU/GPU capability detection, with
  explicit reservation of one core for the UI/preview path.

### 5.5 Errors and Results (`core/errors.py`, `core/result.py`)

Two channels, deliberately separated:

* **Expected failure** → `Result[T] = Ok(T) | Err(NovaError)`. Used for anything the user
  can act on: unsupported codec, missing file, cancelled job, licence check.
* **Invariant violation** → exception from the `NovaError` hierarchy, translated at the API
  boundary into a stable RFC-7807-style `problem+json` body with a `code` the frontend maps
  to a localised message.

Error codes are stable strings (`NS-MEDIA-4001`), never HTTP-status-only, so the UI can show
"HEVC 10-bit is not supported by your GPU decoder — switch to software decoding" instead of
"Error 500".

---

## 6. Data architecture

Full DDL: `docs/architecture/database-schema.md`. The strategy:

**Hybrid normalised/document model.** Relational tables hold everything that must be
*queried, indexed, joined or listed* — projects, assets, tracks, clips, captions, jobs,
settings, export history, cache entries, plugins, fonts, templates. The *timeline graph*
additionally has an authoritative **versioned JSON document** (`.nova` project file, and a
`timeline_document` table row per revision).

Rationale (ADR-0004): an NLE timeline is a graph read and written **as a whole** at
60 Hz-ish cadence during playback and editing. Normalising every keyframe into rows would
turn a seek into hundreds of queries. Conversely, listing "all assets tagged `b-roll`" over
a JSON blob would be a full scan. The hybrid gives O(1) document load *and* indexed queries.
The two representations are kept in sync by the same commands, inside one SQLite
transaction — the document is derived state, the tables are the queryable index, and a
validator (`ProjectIntegrityChecker`) can rebuild either from the other.

SQLite runs in **WAL mode**, `synchronous=NORMAL`, with a single writer connection
(serialised through `SqliteGateway`) and multiple readers. No ORM: hand-written, reviewed
SQL behind repository ports. An ORM's identity map is a liability when frames and documents
are large; explicit SQL is auditable and fast.

---

## 7. Media & rendering architecture

### 7.1 Toolchain discovery

`infra/media/ffmpeg.py` resolves a toolchain in strict priority order and records the
decision:

1. `NOVA_FFMPEG` env var (explicit override),
2. bundled binary shipped inside the portable EXE (`apps/desktop/resources/bin/`),
3. `imageio-ffmpeg` static binary (guaranteed present, FFmpeg 7.0),
4. system `ffmpeg` on `PATH`,
5. **PyAV's linked libraries only** — no CLI; used when everything above is absent.

Every decode/encode path has both a **PyAV implementation** (in-process, zero-copy-ish,
needed for frame-accurate compositing) and a **CLI implementation** (needed for filters that
only exist in `libavfilter` graphs, and for multi-pass export). The `MediaBackend` port
abstracts the choice; a probe cache means the discovery runs once per session.

### 7.2 Frame pipeline

```
Clip(source, in, out, speed) ─┐
Clip ─────────────────────────┤   TimelineResolver
Clip ─────────────────────────┘        │  resolves time t → ordered list of
                                       ▼  visible contributions
                             ┌──────────────────────┐
                             │  FrameSourcePool     │  per-asset decoders, LRU,
                             │  (PyAV DemuxCache)   │  keyframe-index aware
                             └──────────┬───────────┘
                                        ▼
                             ┌──────────────────────┐
                             │  DecodeStage         │  seek(to keyframe ≤ t) then
                             │                      │  step to exact frame (verified
                             │                      │  necessary: GOP=30 seek lands
                             │                      │  up to 1 s early)
                             └──────────┬───────────┘
                                        ▼
                             ┌──────────────────────┐
                             │  SpeedStage          │  constant + ramped (curve)
                             └──────────┬───────────┘
                                        ▼
                             ┌──────────────────────┐
                             │  EffectChain         │  ordered EffectOps (NumPy/OpenCV)
                             └──────────┬───────────┘   GPU path optional
                                        ▼
                             ┌──────────────────────┐
                             │  TransformStage      │  position/scale/rotate/crop/anchor
                             └──────────┬───────────┘
                                        ▼
                             ┌──────────────────────┐
                             │  Compositor          │  painter's algorithm bottom→top,
                             │                      │  blend modes, opacity, masks
                             └──────────┬───────────┘
                                        ▼
                             ┌──────────────────────┐
                             │  TransitionStage     │  A/B overlap window resolution
                             └──────────┬───────────┘
                                        ▼
                             ┌──────────────────────┐
                             │  OverlayStage        │  text, captions, motion graphics
                             └──────────┬───────────┘   (RGBA, SDF text, animation eval)
                                        ▼
                             ┌──────────────────────┐
                             │  ColourStage         │  LUT / curves / wheels, applied once
                             └──────────┬───────────┘   at the end for correctness
                                        ▼
                                 FrameBuffer (rgb24 / rgba)
                                        │
                        ┌───────────────┴────────────────┐
                        ▼                                ▼
                 PreviewSink                      ExportSink
                 (JPEG/WebP over HTTP,            (PyAV/CLI encoder,
                  or shared-mem in desktop)        audio muxed separately)
```

Design invariants:

* **Frame-accurate by construction.** Time is represented as integer frame numbers at a
  project timebase; `Timecode` converts to/from seconds only at the edges. Floats never
  accumulate across the timeline (ADR-0006).
* **Proxies are transparent.** A clip references an asset; the asset resolves to
  `original | proxy | thumbnail` by a `ProxyPolicy` decided from the preview scale factor.
  Nothing downstream knows which it decoded.
* **The compositor is pure.** Given `(timeline, t, resolution)` it returns a frame and
  mutates nothing. This is what makes the preview cache, the export, the thumbnail service
  and the test-suite all use the *same* code path — the classic NLE bug class "preview looks
  different from export" is structurally impossible.
* **Colour stage runs last** so grading applies to the composited result (matching Resolve's
  node graph semantics) unless a per-clip grade is explicitly requested.

### 7.3 GPU strategy

GPU is an *acceleration*, never a *requirement*. `ports/gpu.py` defines `GpuBackend` with
capability probes; adapters: `NullGpu` (default, CPU/NumPy+OpenCV), `CudaBackend`
(NPP/nvcodec when `av` reports `h264_cuvid`/`hevc_cuvid`), `OpenCLBackend`, and
`WebGLOverlay` for the frontend-side preview compositor. Each declares supported ops; the
`EffectChain` planner partitions ops between GPU and CPU and falls back per-op, not
per-frame. Capability is detected once and cached in `settings`.

### 7.4 Audio

Audio is **not** composited per video frame. The `AudioEngine` resolves the same timeline
into an independent sample graph, mixes at the project audio rate in float32, applies
per-clip gain/fade/EQ/compression, then a master chain (EQ → compressor → limiter →
normalise target LUFS). Preview streams a rolling window; export writes a WAV stem that is
muxed by the export pipeline. Beat/silence detection run as IDLE jobs and cache results in
`audio_analysis`.

### 7.5 The media record and the media port

Two L2 modules carry everything that is true about footage before a single packet is
decoded. They are the seam the whole frame pipeline in §7.2 reads through.

**`domain/media.py` — what footage *is*, with no I/O at all:**

| Object | Role |
| --- | --- |
| `ColourSpace` / `ColourRange` / `ColourPrimaries` / `ColourTransfer` | Container colour signalling, values read back from the bundled FFmpeg 7.0.2 (§7.6) |
| `ColourMeta`, `FrameBuffer` | The four tags every frame carries, and the pixels they describe (ADR-0007 §6) |
| `ContentHash` | Identity of a file's bytes, algorithm travelling with the digest |
| `VideoStreamInfo` / `AudioStreamInfo` | Per-stream geometry, rate, codec, colour, SAR/rotation |
| `MediaInfo` | The probe summary — the only part of a probe that is persisted |
| `AudioBuffer` | Decoded audio: float32, `(n_samples, n_channels)`, nominal ±1.0 |
| `MediaAsset` | The project's reference: `asset_id`, path, kind, hash, link state, probe |
| `NDArray` | The one third-party type allowed in port signatures, re-exported so frames have a single home (ADR-0002 rule 2) |

State changes on `MediaAsset` are methods, not attribute assignment, because two fields are
coupled: a content hash and a probe summary describe the same bytes, so a relink that cannot
prove the content is unchanged discards both. This is what makes "the path moved but the
probe says 1920×1080" a provable statement rather than a hope (ADR-0015 rule 3).

**`ports/media.py` — how footage is read, without naming a library:**

| Protocol | Lifetime | Answers |
| --- | --- | --- |
| `MediaProber` | stateless, shared | "what does this file say about itself" |
| `MediaDecoder` | one per process | "open me a handle" |
| `DecodedMedia` | one per asset, pooled | "give me stream N" |
| `VideoFrameSource` / `AudioSampleSource` | one per open stream | frames, or blocks of samples |
| `AudioResampler` | one per mixer | rate and channel conversion |

Contract rules an adapter must honour:

1. **Entry points return `Result`.** `probe()` and `open()` answer I/O failure with `Err`
   carrying a `MediaErrorCode` (`NS-MEDIA-4001` unreadable, `-4003` unsupported; `-4002`
   belongs to the render port's missing-encoder case, per ADR-0007 §7).
2. **A failure *during* reading is latched, not raised.** An `Iterator[FrameBuffer]` has no
   `Result` channel, and allocating one `Result` per frame buys nothing on a 60 fps path; the
   source latches the error and the consumer reads `last_error()` once after the loop.
   `frame_at()` returning `None` means "no frame"; `last_error()` says whether that was the
   end of the stream or damage.
3. **Positions are integers** — frames for video, samples for audio (ADR-0006). No method
   takes seconds.
4. **Sequencing is the fast path.** `frame_at()` may cost a whole GOP; `keyframe_indices()`
   tells a scrubber where the cheap landing spots are and may be empty when the container
   exposes no index — never fabricated.
5. **Handles are closed**, idempotently: a pooled handle may be closed by the pool and by a
   `finally` in the same stack.
6. **No third-party types.** Frames are `FrameBuffer`, audio is `AudioBuffer`, both from
   `domain`.

*Still to build:* `infra/media/pyav/` and `infra/media/cli/` (the two adapters), the
`FrameSourcePool` that owns handle lifetimes, and
`tests/media/test_backend_conformance.py`, which runs both backends over the same generated
assets and asserts identical output metadata (ADR-0007).

### 7.6 Colour truth

Every frame carries `(space, range, primaries, transfer)` — ADR-0007 §6 — and the enum
values are **measured, not recalled**. On 2026-09-24 they were read back from the bundled
FFmpeg 7.0.2 two ways: libavutil's `av_color_*_name` tables via `ctypes` on the PyAV wheel's
`libavutil`, and an encode/decode round-trip through libx264. Key values:

* space: `1 bt709`, `5 bt470bg`, `6 smpte170m`, `9 bt2020nc`, `10 bt2020c`, `14 ictcp`
* primaries: `9 bt2020`, `22 ebu3213`
* transfer: `16 smpte2084` (PQ/HDR10), `18 arib-std-b67` (HLG)
* range: `0 unspecified`, `1 limited` (ffprobe prints `tv`), `2 full` (ffprobe prints `pc`)

**Known divergence, pinned by a test:** PyAV 18.1's `Colorspace.SMPTE170M` is `5`, which is
`bt470bg` in FFmpeg — `smpte170m` is `6`. An encode/decode round-trip proves FFmpeg's
numbering, and the domain follows FFmpeg. `tests/media/test_av_colour_contract.py` pins
PyAV's values *as shipped*, so a library fix flips the test instead of silently changing the
look of every SD clip.

Rules that follow: never trust a binding's alias over the measured toolchain; conversions
happen explicitly at the compositor boundary, never implicitly in `swscale`; and an
unspecified tag means "choose a defined default", not "a distinct colourspace".

---

## 8. Caption engine architecture

The heart of the product. Full detail: `docs/architecture/module-catalog.md#caption-engine`
and `services/captions/`.

```
  Media ──► AudioExtractor (16 kHz mono f32, PyAV resample)
                 │
                 ├─► VAD (Silero via faster-whisper) ──► speech regions
                 │
                 ▼
        TranscriptionProvider  (port)
          ├─ FasterWhisperProvider   word_timestamps=True, beam_size=5,
          │                          vad_filter=False during alignment pass
          ├─ ExternalSrtProvider     (import user-supplied script)
          └─ ManualProvider          (typed-in transcript for tests/offline)
                 │
                 ▼
        TranscriptGraph { segments[], words[], chars[] }
                 │
    ┌────────────┼───────────────┬──────────────────┬─────────────────┐
    ▼            ▼               ▼                  ▼                 ▼
 Refiner    SpeakerDiariser  Translator      LineBreaker        EmojiInjector
 (punct,    (embedding +     (port: local    (greedy width +    (sentiment +
 casing,    clustering,      MT / provider)  semantic break,    lexicon, opt-in)
 profanity) port)                            CJK aware)
    │            │               │                  │                 │
    └────────────┴───────┬───────┴──────────────────┴─────────────────┘
                         ▼
              CaptionSegment[]  (authoring model)
                         │
        ┌────────────────┼────────────────────┬──────────────────┐
        ▼                ▼                    ▼                  ▼
  SmartPositioner   Highlighter         AnimationBaker      CollisionResolver
  (safe areas,      (per-word active    (word/letter/key-   (track stacking,
  speaker side,     state, karaoke)     frame generation    overlap avoidance)
  face detection                        from a template)
  anchor)
                         │
                         ▼
              CaptionDocument (JSON, versioned)
                         │
        ┌────────────────┼─────────────────────────┐
        ▼                ▼                         ▼
   OverlayStage     Exporters                 Timeline bridge
   (rendered into   SRT · VTT · ASS ·         (each segment becomes a clip
    the composite)  TXT · JSON · burned-in     on a caption track, fully
                    video                      editable, undoable)
```

Key decisions:

* **Three granularities are first-class:** segment, word, character. The animation baker
  works at character level so "letter animation" is not a special case.
* **Alignment safety:** word timestamps are produced with `vad_filter=False` on the
  alignment pass (VAD frame removal desynchronises token↔time mapping in ~20% of real
  audio), while VAD *is* used earlier for silence trimming. Audio is always resampled to
  16 kHz mono float32 by us before it reaches the provider.
* **Styling is data, not code.** A `CaptionTemplate` is a declarative document (fonts,
  colours, stroke, shadow, glow, gradient, animation curves, safe-area rules). Templates
  are the unit of the marketplace and of plugin contribution.
* **Everything is non-destructive and reversible.** Regenerating captions from ASR creates a
  new `CaptionDocument` revision; user edits are stored as an overlay of deltas so a
  re-transcription can be *merged* with human corrections instead of destroying them.

---

## 9. Plugin architecture

```
plugin/
  manifest.json      id, name, version, min_nova_version, author, licence,
                     entrypoints[], permissions[], contributes{}
  backend/           Python package (entry: nova_studio.plugins.Plugin subclass)
  frontend/          optional JS bundle (ESM, sandboxed by capability, not by iframe)
  assets/            icons, presets, templates, LUTs
  README.md
```

Contribution points (all registry-based, all optional):

| Point | Interface | Examples |
| --- | --- | --- |
| `effect` | `EffectOp` | custom blur, stylise, warp |
| `transition` | `TransitionOp` | liquid, 3D cube, mask wipe |
| `caption.template` | `CaptionTemplate` doc | "TikTok Bold", "Netflix Sub" |
| `caption.animation` | `AnimationSpec` | bounce-word, karaoke-sweep |
| `caption.provider` | `TranscriptionProvider` | alternative ASR engine |
| `export.preset` | `ExportPreset` | platform-specific targets |
| `export.target` | `ExportTarget` | upload integrations |
| `ai.task` | `AiTask` | custom AI Studio entry |
| `theme` | `ThemeDocument` | UI theme |
| `locale` | translation bundle | UI language |
| `ui.panel` | frontend component | custom inspector section |

Isolation & safety (ADR-0011): plugins run **in-process** (a video editor cannot afford IPC
per frame) but under a declared **permission set** — `fs.read`, `fs.write.workspace`,
`net`, `gpu`, `process`, `project.read`, `project.write`. The `PluginSandbox` installs an
audit hook that denies undeclared capabilities and records violations. Misbehaving plugins
are disabled automatically after N faults (`circuit breaker`) and their state is preserved
for the user to review. Plugins are loaded lazily, in dependency order, and a plugin crash
must never take down the editor: every entrypoint call is guarded and counted.

---

## 10. Frontend architecture

```
frontend/src
├── app/            shell: routing, providers, window chrome, dock manager host
├── core/
│   ├── api/        typed REST + WS client, retry, cancel, token, request ids
│   ├── types/      DTOs mirroring the backend contract
│   ├── events/     WS event bridge → store dispatch (topic → handler map)
│   ├── timecode/   frame-math shared with backend semantics
│   └── utils/
├── stores/         Zustand slices: project, timeline, media, playback,
│                   captions, export, ai, settings, ui, plugins, performance
├── ui/             design system: Button, Slider, ColorPicker, Menu, Modal,
│                   Tooltip, VirtualList, Dock, Splitter, Icon, Toast …
├── features/
│   ├── splash/  home/  project-manager/
│   ├── editor/
│   │   ├── toolbar/    left-sidebar/   preview/   inspector/
│   │   ├── timeline/   ← ruler, tracks, clips, keyframes, markers, snapping
│   │   └── status-bar/
│   ├── captions/       ← Caption Studio (transcript, styling, animation, layers)
│   ├── ai-studio/  plugins/  templates/  fonts/  export/  settings/
│   └── shortcuts/  about/
└── styles/         Tailwind v4 @theme tokens, CSS variables, themes
```

* **Docking:** a `DockManager` owns a tree of panels; every panel is resizable, collapsible,
  draggable between docks, and its layout is persisted per-project (`ui_layout` table).
  Layout is *data*, so themes/plugins/users can ship layouts.
* **Timeline rendering:** DOM for the track headers and clip chrome; **Canvas 2D** for the
  ruler, waveforms and thumbnail strips (thousands of elements — DOM would not survive).
  Virtualised by visible time range; redraws are batched in `requestAnimationFrame` and
  driven by a dirty-region model.
* **Preview:** the backend composites; the frontend displays. Two transports:
  (a) HTTP MJPEG/WebP frame stream for compatibility, (b) shared-memory/binary WS frames in
  the desktop shell for zero-copy. A WebGL layer on top handles preview-only overlays
  (guides, safe areas, selection outlines, transform gizmos) at display refresh rate
  without a backend round-trip — so dragging a transform handle feels instant while the
  authoritative frame still comes from the compositor.
* **Theming:** all colours/spacing/radii are CSS custom properties defined once in a
  Tailwind v4 `@theme` block; a theme is a JSON document that overrides those properties.
  No component hardcodes a colour — enforced by lint (`no-restricted-syntax`).
* **i18n:** no literal user-facing strings in components; `t('key')` with ICU plurals,
  bundles in `nova_studio/i18n/*.json`, hot-reloadable, plugin-contributable.

---

## 11. Desktop packaging

* `apps/desktop/nova_desktop.py` — starts the core service on an ephemeral loopback port,
  waits for `/health/ready`, issues a session token, then opens the pywebview window with
  the built frontend injected (and the token in the query string, consumed once).
* Splash screen is a separate frameless window shown before the service is ready; it
  receives progress over the same WS once up.
* **Portable EXE:** PyInstaller onedir layout (`NovaStudio/NovaStudio.exe` + `_internal/`),
  because onefile's per-launch extraction costs 3–8 s and breaks FFmpeg/CUDA DLL locality.
  The FFmpeg static binary, Whisper model downloader, and frontend `dist/` are bundled as
  data files. User data lives in `./NovaData` next to the EXE when the directory is
  writable (true portable behaviour), else `%LOCALAPPDATA%/NovaStudio`.
* Single-instance lock via a named pipe / lockfile; a second launch focuses the first.
* Updater: `services/updater` checks a signed manifest, downloads a delta, verifies
  SHA-256 + Ed25519 signature, stages it, and swaps on next launch. Never auto-applies.

---

## 12. Extensibility & future-proofing

Ten-year maintainability rests on the seams, not on today's features:

| Future capability | Already provided by |
| --- | --- |
| New ASR engine (Whisper-X, cloud, on-device NPU) | `TranscriptionProvider` port + provider registry |
| GPU compositing (Vulkan/Metal/D3D12) | `GpuBackend` port + per-op capability partitioning |
| Node-based colour graph | `EffectGraph` is already a DAG, not a list |
| Nested sequences / compounds | `Sequence` is a `MediaSource`; a clip can reference a project |
| Collaboration | Commands + event log are already an append-only op stream (CRDT-ready) |
| Cloud render farm | `ExportTarget` port; job graph is serialisable |
| Scripting/automation API | Commands are the public API; a scripting host just builds them |
| New container/codec | `MediaBackend` + capability probe table |
| Mobile/remote client | The only frontend↔backend channel is already HTTP/WS |
| Plugin marketplace | Manifest + signature verification already specified |

Versioning: the project file carries `format_version` and a migration chain; every DTO has
a schema version; API is versioned under `/api/v1`. Deprecation policy: two minor versions.

---

## 13. Quality gates

| Gate | Tool | Threshold |
| --- | --- | --- |
| Format | `ruff format` | no diff |
| Lint | `ruff check` | 0 errors |
| Types | `mypy --strict` | 0 errors |
| Layering | `scripts/check_layering.py` | 0 violations |
| Unit tests | `pytest -m "unit or integration"` | pass, ≥ 85% branch coverage on `core/`, `domain/`, `services/` |
| Media tests | `pytest -m media` | pass (real encoded assets, generated not committed) |
| Frontend types | `tsc --noEmit` (strict, `exactOptionalPropertyTypes`) | 0 errors |
| Frontend lint | `eslint` | 0 errors |
| Frontend build | `vite build` | succeeds |
| Perf | `scripts/bench_*` | regression budget vs baseline JSON |
| Packaging | `apps/desktop` smoke | window opens, project loads |

CI runs these in order and stops at the first failure. `make check` runs all of them locally.

---

## 14. Where to read next

| Document | Contents |
| --- | --- |
| `adr/README.md` | All architectural decision records with context/consequences |
| `module-catalog.md` | Every module: purpose, folder structure, backend/frontend architecture, DB schema, class diagram, state, functions, events, APIs, error handling, caching, performance, testing, docs, future expansion |
| `domain-model.md` | Entities, value objects, invariants, aggregates |
| `event-catalog.md` | Every event topic, payload and publisher |
| `api-contract.md` | REST + WebSocket surface |
| `database-schema.md` | Normalised DDL, indexes, migrations |
| `project-file-format.md` | `.nova` container specification |
| `plugin-sdk.md` | How to write a plugin |
| `frontend-architecture.md` | UI layer detail |
| `render-pipeline.md` | Frame pipeline detail |
| `testing-strategy.md` | Test pyramid, fixtures, media generation |
| `performance-budgets.md` | Measured budgets per subsystem |
