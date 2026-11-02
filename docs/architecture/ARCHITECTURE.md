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

### 5.4 Job scheduling (`core/jobs.py` policy · `ports/jobs.py` seams · `services/` scheduler)

Long work never runs on the request path.  ADR-0010 names one scheduler with five
priority classes; it is realised in three pieces, because a scheduler that also owns
thread and process pools cannot live in L1.

```
  core/jobs.py          the vocabulary and the four decisions (pure, no I/O)
  ─────────────────────────────────────────────────────────────────────────
  JobSpec(kind, priority, isolation, memory_class, affinity, retry, …)
  ProgressThrottle      ≤ 20 Hz, but a stage change and the final report always go out
  decide_admission()    ADMIT · DEFER · REJECT — defers, never kills
  RetryPolicy           only WORKER_LOST is retried by default, and only if idempotent
  CircuitBreaker        2 consecutive worker losses disable the kind, with a reason

  ports/jobs.py         the seams an adapter fills (I/O lives behind here)
  ─────────────────────────────────────────────────────────────────────────
  JobContext   what a running job sees: is_cancelled, report, checkpoint, heartbeat
  JobHandle    what the submitter keeps: status, cancel(grace), wait, record
  JobObserver  the push channel — the WS bridge implements it
  JobExecutor  the pools: submit, subscribe, running, capacity, drain, shutdown
  JobStore     ai_jobs / export_jobs: history, reconcile_interrupted, prune

  services/jobs/        the object that owns queues and runs the admission loop
```

Priority classes and the pool each one defaults to (ADR-0010 §1):

| Priority | Semantics | Pool | Examples |
| --- | --- | --- | --- |
| `CRITICAL` | the user is blocked waiting | threads | thumbnail of a just-dropped clip, probe |
| `HIGH` | next frames needed for playback | threads | preview render of the visible range |
| `NORMAL` | user-initiated long work | processes | export, proxy transcode |
| `LOW` | background AI | processes | ASR, scene detect, auto-reframe |
| `IDLE` | opportunistic | threads | waveform pre-generation, cache warm-up |

Decisions worth the lines they cost:

* **Preemption is admission, never killing.**  `decide_admission` defers a request; a
  running job keeps its slot, because killing one corrupts its output and throws away
  everything it had already done.  A job also defers while anything *more urgent* is
  waiting — without that, eight background waveform jobs fill the thread pool and a
  dropped clip waits for its thumbnail.
* **Cancellation is cooperative with a hard deadline.**  `ctx.is_cancelled()` is polled at
  points the job chooses; `cancel()` arms a watchdog for the spec's grace period
  (5 s, 30 s for an export mid-mux).  A cancelled job ends `Err(NS-JOB-5005)` — the
  UI says "stopped", not "failed" — and its partial output is never promoted.
* **A dead worker is a value, not an exception.**  A codec that segfaults becomes
  `Err(NS-JOB-5003)`; retrying is the scheduler's decision, made with `RetryPolicy` and
  the circuit breaker, never the adapter's.  Two consecutive losses disable the kind and
  record *why*, so the UI can offer a way out instead of failing a third time.
* **Only an idempotent job may be retried** — enforced when the spec is built, because a
  retried non-idempotent export is silent corruption.
* **Nothing starts before it is recorded.**  `JobStore.put` runs first, which is what makes
  post-crash reporting possible; on the next start, every non-terminal record becomes
  `INTERRUPTED` and is offered back to the user as resumable.
* **Progress is a value, not a callback.**  A job in another process can report it, the
  executor throttles it, and the WS bridge coalesces it — none of the three knows about
  the others.
* **Capacity is measured, and a user override may only tighten it**:
  `cpu_workers = max(1, physical_cores − 1)` with one core reserved for UI/preview,
  `gpu_workers = 1` and `0` where no GPU was detected (which *rejects* GPU work at
  admission rather than failing it halfway — ADR-0012 §2), I/O capped separately.

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

### 6.1 The persistence port and what it stores

`ports/persistence.py` declares four protocols; `domain/persistence.py` holds the
vocabulary they move. Neither names SQLite, ZIP or a filesystem.

| Protocol | Lifetime | Answers |
| --- | --- | --- |
| `UnitOfWork` | one save / one command batch | "commit these together or not at all" |
| `ProjectArchive` | one per open project | "read/write/checkpoint this `.nova` container" |
| `Journal` | one per open project | "what has happened since the last checkpoint" |
| `CacheIndex` | one per install | "what derived bytes do we hold, and how old are they" |

| Vocabulary (domain) | Role |
| --- | --- |
| `ProjectManifest` | Format level, project id, app version, created/modified |
| `RevisionRef` | One numbered checkpoint; `document_name` is where it lives in the archive |
| `JournalEntry`, `JournalWindow` | One logged command, and a resumable read of them |
| `CacheEntry`, `CacheKind`, `CacheBudget` | Derived artefacts, what kind they are, how much is allowed |
| `CheckpointPolicy`, `select_for_eviction`, `revisions_to_prune` | Pure policy: when to checkpoint, what to evict, what history to keep |
| `is_valid_document_name`, `revision_document`, `caption_document` | Entry naming — including the zip-slip guard |

The byte-level contract of the container — entry layout, canonical JSON, the
migration chain and the integrity rules — is specified separately in
[`project-file-format.md`](project-file-format.md), which is the document
ADR-0015 points at.

Rules the port makes mechanical rather than conventional:

1. **Writes are staged; `commit()` is the atomic step.** A crash may leave a
   `.nova.tmp-<rand>` file, never a truncated project (ADR-0015 rule 4).
2. **Commit the document before the rows.** The document is authoritative, the tables are
   a derived index (ADR-0004 §3), so the only divergence a crash can produce is *rows
   behind*, which the integrity checker repairs by rebuilding. The reverse order can lose
   an edit the user was told had been saved.
3. **A newer format version is refused whole** — `NS-STORAGE-4003`, never a partial parse
   (ADR-0015 rule 5).
4. **A torn journal tail is data, not an error.** Dying mid-write is the normal state of a
   journal, so `read_since` returns what parsed and sets `JournalWindow.torn_tail`.
5. **Entry names are validated** by the domain predicate before anything is written.

*Open decision — needs a call before `infra/persistence` is written:* ADR-0004 §6 calls the
per-project store a SQLite container while ADR-0015 defines `.nova` as a ZIP of
canonical-JSON documents. SQLite's WAL and shared-memory files cannot live inside a ZIP
member, which argues for **a sidecar SQLite database in the project's data directory with
the archive kept as the portable artefact** (and the tables rebuilt from the document when
the sidecar is missing — which is the recovery path anyway). The port accepts either
answer as one adapter, not one rewrite, but the choice should be made explicitly.

---

## 7. Media & rendering architecture

Section 7 lives in its own file — [`media-and-rendering.md`](media-and-rendering.md) —
with the same subsection numbers. What follows is the map.

The frame pipeline is the spine of the application: **decode → transform →
effect → blend → composite → encode**, with every stage a port so that PyAV,
FFmpeg and the GPU are interchangeable rather than load-bearing. Frames — never
seconds — are the unit of time throughout (ADR-0006), and the compositor works
in the project's own coordinate space, so a layer 100 px right of centre means
the same thing in the 960×540 preview and the 3840×2160 export (ADR-0012).

| § | Subject | Code |
| --- | --- | --- |
| 7.1 | Toolchain discovery | `infra/media` |
| 7.2 | Frame pipeline | `ports/render.py` |
| 7.3 | GPU strategy | `infra/render` |
| 7.4 | Audio | `infra/media` |
| 7.5 | The media record and the media port | `domain/media.py`, `ports/media.py` |
| 7.6 | Colour truth | `domain/media.py` |
| 7.7 | The render port and the export vocabulary | `ports/render.py`, `domain/export.py` |
| 7.8 | The edit decision list | `domain/timeline.py` |
| 7.9 | The effect and animation model | `domain/animation.py`, `domain/effects.py` |
| 7.10 | The project aggregate root | `domain/project.py` |

---

## 8. Caption engine architecture

### 8.1 The ASR half of the pipeline (`ports/asr.py`, `domain/asr.py`)

Six protocols cover the stages of ADR-0009 §3 that touch a model — `Extract → VAD →
Transcribe → Refine → Diarise → Translate` — with the rest of the pipeline
(`Break → Emoji → Highlight → Position → Resolve → Bake`) pure and built later on
`domain/captions.py`.

| Protocol | Stage | Answers |
| --- | --- | --- |
| `VoiceActivityDetector` | VAD | "where is the speech" |
| `TranscriptionProvider` | Transcribe | "audio in, normalised `Transcript` out" |
| `WordAligner` | Refine | "put times on the words that are already there" |
| `SpeakerDiariser` | Diarise | "who said it" |
| `Translator` | Translate | "the same transcript in another language" |
| `ModelResolver` | — | "which models exist, and are the weights here" |

`domain/asr.py` is the vocabulary: `Transcript` → `TranscriptSegment` → `TranscriptWord`,
plus `SpeechRegion`, `TranscriptionOptions`, `AsrModelRef`, `AsrCapability` and the pure
helpers `merge_regions`, `validate_transcript`, `frames_for_ms`. ADR-0009 §1 calls the
provider's output a `TranscriptGraph`; the code spells it `Transcript` — it is a document,
not a graph.

Rules the port makes mechanical:

1. **Time in a transcript is integer milliseconds.** A transcript does not know the
   project's edit rate, so frames would be meaningless and float seconds would drift.
   Conversion to frames happens once, at the caption boundary, with a stated rounding
   mode (`frames_for_ms`, ADR-0006).
2. **Audio arrives at 16 kHz mono float32** (ADR-0009 §4). Anything else is
   `NS-CAPTION-4001`, never a silent resample.
3. **The alignment pass runs with VAD off** — `TranscriptionOptions.alignment()` is the
   only sanctioned way to build it, because VAD frame removal desynchronises the
   token↔time mapping. Silence trimming happens earlier and its offsets are applied to
   the timings.
4. **A broken result is reported, not returned** — empty word lists and timings past the
   end of the audio become `NS-CAPTION-4004` with the sentence
   `validate_transcript` wrote.
5. **A missing model is a state with a remedy**, not a crash: `NS-CAPTION-4002` carries
   "connect to download" and the UI offers the download.
6. **No module outside an adapter names a model framework.** `tests/ports/test_asr_ports.py`
   parses the port's imports to enforce it, and `make check` runs that test.

The decisive consequence (ADR-0009): because every stage after `Transcribe` is pure, the
caption engine is verifiable in CI **with no model weights and no network** — which is why
`ManualProvider`, the typed transcript, is both a real implementation and the deterministic
test double.

### 8.2 The authoring model (`domain/captions.py`)

What the user edits. A `Transcript` is ASR truth and is never edited in place; a
`CaptionDocument` is the editor's, and survives re-transcription.

```
CaptionDocument ──► CaptionSegment ──► CaptionWord ──► CaptionChar
   layers              index, text,       text, timing,    one grapheme,
   language            timing, words,     confidence,      timing,
   revisions           speaker, layer,    speaker,         estimated
   edits (deltas)      position, style    chars, highlight
```

Decisions that decide whether the Caption Studio is trustworthy:

1. **A character is what a person sees.** `graphemes()` does not split a flag, an
   accented letter or a ZWJ emoji sequence, because animation animates characters
   and a half-glyph mid-animation is a visible bug.
2. **Derived timings are labelled as derived.** `split_chars()` distributes a word's
   interval across its characters weighted by character class — a vowel is held
   longer than a consonant, a CJK glyph longer than a letter — and marks every
   result `estimated`, so the UI says "estimated" rather than presenting a weighted
   guess as a measurement. A provider that supplies real character timings overrides
   it, and `has_measured_char_timings` tells the two apart.
3. **A cue is never silently truncated.** `wrap_caption()` balances lines (29 + 29,
   not 40 + 2), breaks CJK between glyphs because it has no spaces to break on, and
   returns *more* lines rather than dropping words. Splitting the cue is the caller's
   decision; losing text is not an option a breaker may take.
4. **Human edits are an overlay, not a rewrite.** A re-transcription produces a new
   base revision; `merge_deltas()` re-attaches each correction by alignment key
   (normalised text plus a 500 ms bucket, so a small drift still matches), falls back
   to a text match within 2 s, and returns what it could not place in `unmatched`
   instead of guessing — a correction attached to the wrong cue is a wrong caption
   with the user's name on it. Deltas *anchor*: once one has landed on a cue, later
   deltas with the same key follow it, even though the first edit changed its key.
   The single destructive rule is deliberate and reported: a text edit discards word
   timings that no longer describe the text, and every such cue is listed in
   `timings_dropped`.
5. **Readability is checked, not assumed.** `validate_caption_document()` names the
   first problem — overlapping cues, a cue shorter than 500 ms, a cue read faster
   than 20 characters per second — and a document that fails it must not reach the
   renderer.
6. **Geometry is vocabulary, not policy.** `SafeArea`, `CaptionRect.overlaps()` and
   `CaptionPosition` are what the Position and Resolve stages compute with; the
   strategies (speaker side, face avoidance, stacking) live in those stages.

Deliberately not here: how a cue is *drawn*. Typography, decoration and animation are
data — `CaptionTemplate` and the `AnimationBaker` (ADR-0009 §5, §6) — and arrive with
the styling module.


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
| `project-file-format.md` | `.nova` container specification · **written** |
| `services.md` | The L3 service layer: conventions, the effect registry, the project lifecycle · **written** |
| `media-and-rendering.md` | §7 of this document: the frame pipeline, the domain model, the render port · **written** |
| `services.md` | L3: feature layout, `Result` discipline, the effect and project catalogues |
| `plugin-sdk.md` | How to write a plugin |
| `frontend-architecture.md` | UI layer detail |
| `render-pipeline.md` | Frame pipeline detail |
| `testing-strategy.md` | Test pyramid, fixtures, media generation |
| `performance-budgets.md` | Measured budgets per subsystem |
