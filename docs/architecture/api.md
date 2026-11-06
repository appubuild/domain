# The API layer (L4)

**Status:** Living document · **Owner:** Architecture Group · **Last reviewed:** 2026-11-06

The layer that turns Nova Studio from a library into an application. Everything
the frontend can do, it does through this layer, over one loopback HTTP socket
and one WebSocket (ADR-0005). This document is the house style for
`nova_studio/api/` and the record of what it owns.

Companion artefacts:

* [`adr/ADR-0005-local-http-ws-transport.md`](adr/ADR-0005-local-http-ws-transport.md) — the decision this layer implements.
* [`api-contract.json`](api-contract.json) — the **generated** OpenAPI contract. Regenerate with `make openapi`; a test fails when the committed copy is stale.

---

## 1. Purpose and rules

An editor's backend is a *service*, not a set of functions the UI calls. It has
background work (renders, transcriptions, autosave), it outlives the window that
started it, and it has to be drivable by something that is not a window at all —
a browser in `make dev`, a Playwright test in CI, a script.

Four rules, all enforced by `scripts/check_layering.py`:

1. **May import `core`, `domain`, `ports`, `services`, `infra`.** It is the
   outermost ring: it translates, orchestrates and nothing else.
2. **No domain logic.** If a rule about timelines or captions is being decided
   here, it is in the wrong ring. The API asks a service and maps the answer.
3. **One translator per concern.** One place a `Result` becomes a response
   (`errors.py`), one place a token is checked (`auth.py`), one place a bus event
   becomes a frame (`ws.py`). Drift in an API layer is always drift between two
   copies of the same rule.
4. **No globals.** The session — bus, token, data directory, port — is a value
   created at startup and injected. A module global would be shared by the second
   window in this process, and "open this project in a new window" is a normal
   thing to want.

**Error discipline.** Services return `Result[T]`; `respond()` turns that into
either a body or a `problem+json` document. Routers never raise a domain error
and never invent an error body. Every failure the frontend can see — including a
404 from the framework and a 422 from a query string — has one shape (§5).

**Database schema.** None. The API owns no tables; the per-project SQLite store
and its schema belong to `infra/persistence` (ADR-0004 §3,
[`project-file-format.md`](project-file-format.md)). What the API *does* own is
the `SessionState`, which is per-process and never persisted.

---

## 2. Folder structure

```
api/
├── app.py        the one ASGI factory: settings, lifespan, routers, guard
├── server.py     running it: ephemeral port, endpoint, endpoint file
├── openapi.py    the generated contract, corrected for what the wire sends
├── auth.py       the session token, and the loopback guard
├── errors.py     the one place a Result becomes a response
├── state.py      SessionState — everything one running instance is
├── ws.py         EventBridge — one bus, many sockets, recoverable loss
├── workspace.py ProjectWorkspace — every open project in this session (§8)
├── exports.py   ExportJobFactory — how a worker's job body is built (§11)
├── media_jobs.py  MediaJobFactory — how a proxy/thumbnail job body is built (§10, §7.18)
├── job_events.py   JobEventBridge — the executor's events, onto the bus (§11)
├── dependencies.py  the FastAPI dependencies (session, workspace, jobs, exports)
├── schemas/      DTOs: the wire contract, documented field by field
│   ├── system.py    health, identity, capabilities
│   ├── projects.py  the project DTOs: summary, open, save, checkpoint, audit
│   ├── timeline.py  the edit, its history, and the seven commands (§9)
│   ├── media.py     the bin: asset rows, and the import report (§10)
│   ├── export.py    the export dialog: the request, and the job it got (§11)
│   ├── jobs.py      a job row: progress inside it, not beside it (§11)
│   └── problem.py   the error body (RFC 9457)
├── mappers/      entity ↔ DTO translation, one module per resource
│   ├── projects.py  Project ↔ ProjectSummary, ProjectAudit → sentences
│   ├── timeline.py  Timeline → summary, wire command → domain command
│   ├── media.py     MediaAsset → row, IngestReport → import answer
│   ├── export.py    "MP4, high quality" → an OutputSpec the domain can build
│   └── jobs.py      JobRecord → the row the panel draws
├── routers/      HTTP endpoints
│   ├── system.py    /healthz, /api/v1/system/{info,capabilities,cache}
│   ├── events.py    /api/v1/events, and the /api/v1/ws endpoint
│   ├── projects.py  /api/v1/projects/* (§8)
│   ├── timeline.py  /api/v1/projects/{id}/{timeline,commands,undo,redo} (§9)
│   ├── media.py     /api/v1/projects/{id}/media{,/import,/ensure} (§10)
│   ├── render.py    /api/v1/projects/{id}/preview/{frame,warm,cache} (§7.14)
│   ├── export.py    POST /api/v1/projects/{id}/exports (§11)
│   └── jobs.py      /api/v1/jobs{,/{id},/{id}/cancel} (§11)
└── (to come)     captions/, plugins/, resources/
```

Two rules for `schemas/`, stated in that package's `__init__.py`:

* **A DTO is not an entity.** It is a wire shape, versioned with the contract;
  the domain model evolves on its own schedule.
* **Every field carries a `description`.** The frontend generates its client and
  its developer tooltips from this file; an undocumented field is a field someone
  will guess about. A test enforces it.
* **`extra="forbid"`** everywhere except `ProblemResponse`, where extension
  members *are* the mechanism RFC 9457 provides for carrying context.

---

## 3. The application (`app.py`)

```python
app = create_app(bus, session=state, settings=ApiSettings(...))
```

| Part | Responsibility |
|---|---|
| `ApiSettings` | Transport configuration: allowed hosts, topics, buffer size, heartbeat interval, whether docs are served. Every default is correct for a desktop session. |
| `app.state.session` | The `SessionState`, read by the `session_state` dependency rather than captured in a closure. |
| `app.state.bridge` | The `EventBridge` the WebSocket serves from. |
| `app.state.workspace` | The `ProjectWorkspace`: every project open in this session (§8). Created *before* the app, closed by the lifespan, handed to routers by a dependency. |
| `app.state.jobs` | The `ConcurrentJobExecutor`: the pools, and the job history behind them (§11). Created before the app, shut down by the lifespan. |
| `app.state.exports` | The `ExportJobFactory`: how the body of an export job is built for a worker (§11). |
| `app.state.media_jobs` | The `MediaJobFactory`: how the bodies of proxy and thumbnail jobs are built (§10, §7.18). |
| `install_error_handlers(app)` | Three handlers: `HTTPException`, `RequestValidationError`, `Exception`. |
| `guard.as_middleware()` | Host/Origin check on every HTTP request (§4). |
| `dependencies=[Depends(token_dependency(...))]` | Applied to the *router*, not to handlers, so an endpoint cannot forget to ask. |
| `/healthz` | Registered outside every router — the one endpoint without a token. |
| `_lifespan` | Start the bus if nobody has, reconcile the job history, publish `api.started`, then on the way out: unsubscribe the job bridge, shut the pools down, close every open project, publish `api.stopped`, shut the bus down. |

Lifespan does those things and nothing else. It opens no project and warms no
cache: that would be work the user did not ask for before they had a window to
see it in. Closing what is open is different — it is the process dropping what it
was holding, and it happens in a `finally`, so it happens on the way out even
when startup failed.

### Class diagram

```
                    create_app(bus, session=None, settings=None)
                                     │
        ┌────────────────────────────┼─────────────────────────────┐
        ▼                            ▼                             ▼
  SessionState  ◄──── session_state(request) dependency     EventBridge
  (frozen)             reads app.state.session               (ws.py)
   ├ data_dir                                                 ├ bus
   ├ bus ───────────────────────────────┐                     ├ topics
   ├ token ── token_dependency(token) ──┤                     ├ max_buffered
   ├ host, port, started_ms             │                     ├ heartbeat_seconds
   └ app_version                        │                     └ serve(websocket)
                                        ▼
               routers/system.py    routers/events.py
               routers/projects.py  routers/timeline.py
                                        │
                                        ├────────────► /api/v1/*  (token required)
                                        │
                                        ▼
                        LoopbackGuard (middleware + handshake)
                        SessionToken  (constant-time compare)
```

---

## 4. Security: the token and the guard

ADR-0005 §4 is blunt: **loopback is not a trust boundary**. Binding to
`127.0.0.1` stops other machines and nothing else — not the other processes on
this one, and not the browser, which a web page can point at
`127.0.0.1:<port>` and often make same-origin through DNS rebinding.

Two independent defences:

| Defence | Stops | Where |
|---|---|---|
| **Session token** — 256 bits from `secrets`, generated per launch, handed to the window once | a local process that knows the port | `auth.SessionToken`, `token_dependency()` |
| **Host/Origin guard** | a web page that does not have the token but can make the user's browser send a request anyway | `auth.LoopbackGuard` |

Details that earn their place:

* **Comparison is constant-time** (`hmac.compare_digest`). `==` on a secret leaks
  its length and its prefix through timing — a small leak, and a silly one to leave.
* **REST reads `Authorization: Bearer`; the WebSocket reads the query string or a
  subprotocol.** A browser cannot set a header on a handshake. One verifier, two
  transports.
* **The WebSocket is authorised before `accept()`.** Accepting first and refusing
  after hands an unauthenticated caller a socket, a file descriptor and a slot —
  precisely the resource it should not be able to take.
* **The guard is asked by the handshake, not only by middleware.** HTTP
  middleware does not run for a WebSocket upgrade; a guard that lived only there
  would leave the socket wide open. There is a test named for this.
* **An absent `Origin` is allowed.** A native client and a same-origin `file://`
  fetch send none, and refusing them would break the very shell the guard protects.
* **`/healthz` is the one exception**, because the shell polls it *before* it has
  a token. It discloses a version string and a process id, it is still behind the
  guard, and there is a test that it discloses nothing more.

---

## 5. Errors (`errors.py`)

Every failure is RFC 9457 `application/problem+json`, with the Nova extensions
spread at the top level — a client reads `body["code"]`, not
`body["extensions"]["code"]`, and the extra hop is where a code gets lost.

| Situation | Code | Status | Domain |
|---|---|---|---|
| No token, or the wrong one | `NS-TRANSPORT-401` | 401 | TRANSPORT |
| Host/Origin is not this session | `NS-TRANSPORT-4030` | 403 | TRANSPORT |
| No such route | `NS-TRANSPORT-404` | 404 | TRANSPORT |
| Request did not match the schema | `NS-VALIDATION-4220` | 422 | VALIDATION |
| Requested range already evicted | `NS-TRANSPORT-416` | 416 | TRANSPORT |
| Unexpected exception | `NS-TRANSPORT-5000` | 500 | TRANSPORT |
| A service refusal (any domain) | the service's own `NS-<DOMAIN>-<NNNN>` | from severity | that domain |

**The status comes from `ErrorSeverity`, not from a router's mood.** The mapping
lives in L1 (`core/errors.py`) so a job failure broadcast over the socket carries
a status the frontend can treat the same way even though no HTTP request was
involved: `warning → 409` (a toast the UI carries on from), `error → 422`,
`critical → 500` (a blocking banner).

A `NovaError` is **not** registered as an exception handler, deliberately: it is
a value, it arrives inside a `Result`, and `respond()` is what maps it.
Registering a handler would imply the opposite — that services raise refusals
across the wire.

The generated contract documents these as `ProblemResponse` with the
`application/problem+json` media type, corrected in `openapi.py` because FastAPI
documents extra responses as `application/json` whatever the handler sends.

---

## 6. The WebSocket protocol (`ws.py`)

One socket at `/api/v1/ws` carries every event. A socket per topic would multiply
the handshakes, the token checks and the places a gap can appear.

**Server → client**

| Frame | When | Carries |
|---|---|---|
| `hello` | once, on connect | `seq`, `topics`, `heartbeat_seconds` |
| `event` | on each bus event | `seq`, `topic`, `ts`, `payload`, `source` |
| `heartbeat` | when idle for `heartbeat_seconds` | `seq`, `dropped`, `at_ms` |
| `pong` | in answer to a `ping` | `seq` |
| `resync` | in answer to a `resync` | `since`, `events`, `last_seq`, `oldest_seq`, `complete` |
| `goodbye` | the socket is closing | `seq` |

**Client → server:** `ping`, `resync {since}`, `unsubscribe`. Anything else —
malformed JSON, a frame that is not an object, a request from a future version —
is ignored rather than punished: a newer client must keep working.

Three decisions carry the weight:

1. **Sequence numbers, and a client that checks them.** A client seeing
   `…41, 42, 47` knows it lost four events and *which* four, so recovery is a
   request rather than a guess.
2. **A gap is repaired from history, or admitted.** `resync` replays what is
   retained and answers `complete: false` when the gap predates it — the signal to
   refetch over REST. A partial replay dressed up as complete is a UI showing a
   state that never existed.
3. **The socket is a notification channel, not a data pipe.** Payloads are small.
   Preview frames and waveforms go over a binary channel or a REST response
   (ADR-0005 §5). A socket carrying frame buffers would need congestion control
   and would get it wrong during a scrub.

Back-pressure is the bus's: a stream drops its *oldest* buffered event when a
client falls behind and counts it, because for a progress stream the newest
position is the one that matters. The count is forwarded on every heartbeat, so
"the UI is behind" is a number somebody can read.

The bridge closes its own side after `goodbye` — nothing else will, and a socket
left open is a connection the client holds until its own timeout.

---

## 7. State management (`state.py`)

`SessionState` is a frozen, slotted dataclass: `data_dir`, `bus`, `token`,
`host`, `port`, `started_ms`, `app_version`, with derived `origin` and
`uptime_ms`.

* **Frozen, so a handler cannot rebind it.** A mutation that survives to the next
  request is a defect that appears an hour later in a different feature.
* **One object, not several globals.** Two bridges in one process — a test, a
  future multi-window shell — would both otherwise see the last one's bus.
* **It carries the address it bound**, so "which port did this instance get" is
  answered by the instance that knows rather than by a file two instances race over.
* **The data directory is resolved at construction**, so a test can set
  `NOVA_DATA_DIR` and get an answer that reflects it.

---

## 8. The project ring (`workspace.py`, `routers/projects.py`)

The first resource: the file menu, and the guarantees behind it. It is where the
promises of ADR-0015 — a damaged project still opens, nothing is lost that was
acknowledged, a crash is a restart — stop being prose and become code the
frontend can call.

**Where the logic is not.** `ProjectWorkspace` decides *when* a file is written
and *what* the user is told. It does not decide what a project *is*
(`domain/project.py`), how a `.nova` file is laid out
(`infra/persistence/archive.py`), or how a command is journalled
(`infra/persistence/journal.py`). It owns one thing: the set of open projects in
this session, and the order in which the durable facts are established.

### The one transaction

Every operation that changes durable state is the same three steps, in this order:

1. **Write the durable thing** — the archive, or the journal entry — and only
   then
2. **Move the in-memory truth** (a counter, a sequence, a handle), and
3. **Publish the event** last, so a listener that reacts by reading gets the
   state the event describes.

A crash between 1 and 2 is recovered from; a crash between 2 and 1 is a lie.

### Endpoints

| Method and path | Returns | Notes |
|---|---|---|
| `GET /api/v1/projects` | `{"projects": [ProjectSummary]}` | What is open right now. |
| `POST /api/v1/projects` | 201 `OpenProjectResponse` | Empty, dirty, no file. |
| `POST /api/v1/projects/open` | `OpenProjectResponse` | Warnings included when the file is imperfect (ADR-0015 rule 3). |
| `GET /api/v1/projects/{id}` | `ProjectSummary` | 404 when it is not open. |
| `DELETE /api/v1/projects/{id}` | 204 | **Does not save.** See below. |
| `POST /api/v1/projects/{id}/save` | `SaveProjectResponse` | 409 `NS-PROJECT-4091` when there is no file yet. |
| `POST /api/v1/projects/{id}/save-as` | `SaveProjectResponse` | The id travels; only the location changes. |
| `POST /api/v1/projects/{id}/checkpoint` | `CheckpointResponse` | A revision now, regardless of policy. |
| `POST /api/v1/projects/{id}/autosave` | `CheckpointResponse` (`taken: false` when nothing is owed) | The tick the timer calls. |
| `GET /api/v1/projects/{id}/audit` | `AuditResponse` | Health, as sentences the domain wrote. |
| `GET /api/v1/projects/{id}/recovery` | `RecoveryResponse` | What a crash left, and what can be done with it. |

### Class diagram

```
        routers/projects.py                 api/workspace.py
   ┌──────────────────────────┐      ┌──────────────────────────────────┐
   │ _answer(result, to_body) │─────►│ ProjectWorkspace(bus, data_dir,  │
   │ _status_for(error)       │      │   autosave_policy,               │
   └────────────┬─────────────┘      │   archive_factory, journal_factory)│
                │                    │                                  │
        mappers/projects.py          │  open: dict[str, _OpenProject]    │
   ProjectSummary ◄── Project        │  ├ project: Project               │
   AuditResponse  ◄── ProjectAudit   │  ├ archive: ZipProjectArchive     │
   CheckpointResponse ◄── Checkpoint │  ├ journal: Journal               │
                                     │  └ counters: sequences, revisions │
                                     └───────┬──────────────────────────┘
                                             │ publishes
                       project.created / opened / saved / checkpointed / closed
```

### Two rules this ring enforces

1. **A close is not a save.** `DELETE` drops the project and writes nothing. An
   implementation that "saved for you" on the way out would destroy the one
   thing a close is for: abandoning an edit. Recovery offers are still available
   from the journal afterwards, which is how the user gets another chance.
2. **A path must be absolute.** A relative path resolves against the process'
   working directory — for a packaged build, wherever the shortcut happened to
   point. `AbsolutePath` in `schemas/projects.py` refuses one at the boundary,
   so "no such file" is never a lie told about a file written somewhere nobody
   looked.

### Errors

| Code | Status | Meaning |
|---|---|---|
| `NS-PROJECT-4090` | 409 | The file is already open here; two handles on one archive would disagree. |
| `NS-PROJECT-4091` | 409 | Never saved, so there is nothing to write to. |
| `NS-PROJECT-4040` | 404 | Not open in this session. |
| `NS-PROJECT-4041` | 404 | No such file — a distinct answer from "not a project". |
| `NS-PROJECT-4005` | 400 | The journal could not be written; the edit was not acknowledged. |
| `NS-PROJECT-4220` | 422 | The archive refused the file (corrupt, or not a Nova Studio project). |

The status is the transport's choice, not the domain's: `errors.STATUS_FOR_CODE`
maps a code to a status where the severity-derived default would mislead, and
every router falls through to `errors.ERROR_STATUSES` otherwise — one table, so
two routers cannot end up serving the same code as two different statuses.

### Caching and performance

* **Nothing about an open project is cached.** The workspace holds the project it
  is editing; the counts in a `ProjectSummary` are read off it, not remembered.
* **Writes are ordered, not batched.** A save fsyncs the archive before it moves
  the dirty flag; a checkpoint truncates the journal only after the revision is
  in. Batching would be faster and wrong.
* **Handlers are `def`, not `async def`**, so Starlette runs them in the thread
  pool and a blocking `fsync` does not stall the event loop.
* **Autosave is a policy, not a timer.** `CheckpointPolicy` decides when
  (`commands_between_checkpoints`, `seconds_between_checkpoints`); the endpoint
  only asks. A tick that found nothing owed takes nothing.

---

## 9. The timeline ring (`routers/timeline.py`, the editing half of `workspace.py`)

The edit, over HTTP. If §8 is the file menu, this is the keyboard and the mouse —
and it is built on one rule, because every other rule follows from it:

    **The timeline is changed by commands and by nothing else.**

A client that could `PUT` a whole new edit would step around validation, undo,
the journal and the preview cache in one request, and each of those is a
guarantee the rest of the system is built on. So what crosses the wire is *what
the user did* — "move this clip to frame 40" — in the domain's own vocabulary,
and `services/timeline` decides whether it is allowed.

### Endpoints

| Method and path | Returns | Notes |
|---|---|---|
| `GET /api/v1/projects/{id}/timeline` | `TimelineResponse` | The edit, its tracks and clips, and the history — one request, because a screen that needs six round trips before it can draw is a screen that flickers on every undo. |
| `POST /api/v1/projects/{id}/commands` | `CommandResponse` | One command, journalled. 409 when the edit is refused; 422 when the command does not exist. |
| `POST /api/v1/projects/{id}/undo` | `UndoResponse` | `undone: false` on an empty stack, which is a 200 and not a mistake. |
| `POST /api/v1/projects/{id}/redo` | `RedoResponse` | The same shape as the undo that undid it. |

### The commands

| `type` | Command | Notes |
|---|---|---|
| `move-clip` | `MoveClipCommand` | `gesture` coalesces a drag into one undo step. |
| `trim-clip` | `TrimClipCommand` | `edge` is `start` or `end`. |
| `slip-clip` | `SlipClipCommand` | Slides the source window; neither end moves. |
| `split-clip` | `SplitClipCommand` | `new_clip_id` is generated when the client leaves it blank, and recorded in the journal so a replay does not invent another. |
| `lift-clip` | `LiftClipCommand` | Removes the clip and leaves the gap. |
| `ripple-delete` | `RippleDeleteCommand` | Closes the gap **the clip left**, not the space the editor put between two clips. |
| `replace-track-clips` | `ReplaceTrackClipsCommand` | Makes one track hold exactly these clips: the caption engine's door, and the only command that writes a whole track at once. |

The union is discriminated by `type`, and `type` is also the name the journal
records — one vocabulary, so a replay rebuilds the command the frontend asked
for rather than looking it up in a second table that could drift.

### Class diagram

```
  routers/timeline.py            mappers/timeline.py            api/workspace.py
  ┌──────────────────────┐  decode  ┌──────────────┐   apply    ┌──────────────────┐
  │ CommandRequest       │─────────►│ DecodedCommand│──────────►│ editor_for(entry) │
  │  (discriminated)     │          │ command/name/ │           │  TimelineEditor   │
  └──────────────────────┘          │ payload       │           │  ├ TimelineStore  │
                                    └──────────────┘           │  └ CommandHistory │
                                                                └────────┬─────────┘
                                                            1. execute   │
   timeline_response ◄── TimelineSummary ◄── Timeline        2. with_timeline
   command_response  ◄── CommandOutcome                      3. journal (fsync)
   undo/redo_response                                        4. publish
```

### The one transaction, again

`ProjectWorkspace.apply` is the project ring's `store` with a command in front of
it, and the order is the whole method:

1. **Run the command.** It validates itself against the timeline as it stands
   and changes the editor's store, or refuses and changes nothing.
2. **Move the project onto the new timeline** (`with_timeline`, which also prunes
   effects, transforms, masks and blends belonging to clips that are gone).
3. **Journal it**, fsynced, so a crash replays it.
4. **Publish**, last, so a listener reading the project sees the edit.

If the journal write fails the edit is **rolled back** — the command is undone
and the project put back — and the caller is told. An editor that kept an edit it
could not replay would be an editor that lies after a crash: the user would be
shown work that the recovery dialog cannot offer them.

### Undo and redo are edits

Both are journalled, as `undo` and `redo` entries. The journal is append-only and
its sequences are never reused, so a reverted command becomes *another* entry
rather than a deletion — and a replay, which folds the journal onto the last
checkpoint (command → apply, `undo` → drop the last command applied, `redo` →
re-apply it), reproduces the edit **including what the user threw away**. A
replay that skipped the undo would hand back work they deliberately discarded.

The undo stack belongs to the session, not to the request: `ProjectWorkspace`
keeps one `TimelineEditor` per open project, created on first use and held until
the project closes. An editor rebuilt per request is an undo stack that is always
empty.

### Errors

| Code | Status | Meaning |
|---|---|---|
| `NS-COMMAND-4104` | 409 | The command was refused: the clip is not there, the frame is outside it, the move would overlap. A conflict with what is on the timeline, which is what 409 means — the domain calls it a warning because for the domain it is a normal answer. |
| `NS-TIMELINE-4090` | 409 | Somebody tried to replace the timeline wholesale while an editor owns it. |
| `NS-PROJECT-4005` | 500 | The journal could not be written; the edit was rolled back. |
| `NS-PROJECT-4040` | 404 | The project is not open in this session. |

Which status a code is served as is decided once, in `errors.py::STATUS_FOR_CODE`.
Two routers that each decided would eventually disagree, and a frontend that has
to know which router it called in order to read a status is a frontend with a bug
waiting.

### Caching and performance

* **One editor per project**, so the history is not rebuilt on every call.
* **Commands carry what changed.** `affected`, `invalidate` and `rerender` let the
  frontend redraw two clips instead of refetching the timeline, which is what
  makes a drag feel like a drag.
* **Gestures coalesce.** A drag sends a command per frame; `merge_key` collapses
  the ones sharing a `gesture` into a single undo step, so one drag is one Ctrl+Z.
* **Handlers are `def`**, so a long command runs in the thread pool and does not
  stall the socket carrying render progress.

---

## 10. The media ring (`routers/media.py`, `infra/media.py`)

The bin: getting footage into a project and showing it once it is there. Three
endpoints, and one rule that decides what the second returns.

    **An import is a report, never a failure.**

Somebody drops forty files on a panel. One of them is a text file. An endpoint
that answered 400 would be an endpoint that trains its users to import one file
at a time and guess which one was bad — so a failure travels *inside* a 200, one
entry per path, each carrying the code the frontend maps to a local sentence. The
only thing that makes the endpoint fail at all is the project not being open.

| Method and path | Returns | Notes |
|---|---|---|
| `GET /api/v1/projects/{id}/media` | `MediaListResponse` | Every asset, in import order, each row carrying the probe that was stored with it. |
| `POST /api/v1/projects/{id}/media/import` | `ImportResponse` | `assets`, `failures`, `duplicates` and a `summary` sentence — whatever the files turned out to be. |
| `POST /api/v1/projects/{id}/media/ensure` | 202 `EnsureMediaResponse` | Queue whatever the project is missing: one job per proxy, one per thumbnail strip. |
| `GET /api/v1/system/cache` | `MediaCacheResponse` | What the install is holding, oldest use first. |
| `DELETE /api/v1/system/cache` | `MediaCacheDroppedResponse` | Free it — `?kind=proxy` or `?kind=thumbnail` to free one kind. |
| `POST /api/v1/system/cache/trim` | `MediaCacheTrimResponse` | Bring it back within the budget: LRU first, and `shortfall_bytes` when even that was not enough. |

### Where the probe happens

```
  routers/media.py          api/workspace.py           services/media
  ┌────────────────┐  import_media  ┌──────────────┐  ingest  ┌────────────────┐
  │ ImportRequest  │───────────────►│ MediaIngestor│─────────►│ probe each path│
  │  paths: [...]  │                │ (one, shared)│          │ (-ing port)    │
  └────────────────┘                └──────┬───────┘          └────────────────┘
                                           │ adds the assets, then            ▲
                                           ▼                                  │
                                    project.with_asset  ────── journal ────┐   │
                                                                           │   │
                                                          infra/media.py ──┴───┘
                                                          PyAVProber
```

`services/media` decides *what a file is* and what is odd about it;
`infra/media.py` is the only thing that opens one. The workspace holds one
`MediaIngestor` for the session, built with the prober as a constructor argument,
so a test can import into a project without a codec in the room.

### What the prober decides

| Question | Answer |
|---|---|
| Is this video, audio, an image or nothing? | Decided by the streams, never by the suffix: an MP3 with cover art is audio, a PNG is an image, a file with neither is `UNKNOWN` and still imports (greyed, with a reason). |
| What is the rate? | An exact `Timebase`. 29.97 stays `30000/1001`, because a frame count derived from a rounded rate drifts by a frame every few minutes of footage. |
| How long is it? | The container's word, then the longest stream's. An unknown frame count stays `0` rather than being guessed from a bitrate. |
| Why can I not read it? | `NS-MEDIA-4001` (unreadable — the user's problem) and `NS-MEDIA-4003` (no decoder in this build — ours) are different answers, and a prober that collapsed them would send somebody looking for a file that is fine. |

Two limits are recorded rather than papered over: **rotation** comes from the
`rotate` tag, because PyAV 18 exposes no stream side data, so phone footage that
carries rotation only in a `DISPLAYMATRIX` reports `0` until the FFmpeg-CLI
adapter lands; and **frame counts** a container does not report stay `0`, which
the domain already reads as "unknown" rather than "empty".

### Caching and performance

* **The bin is the cache.** The probe summary is the one part of a probe the
  project file persists (ADR-0015), which is why a project opens with correct
  geometry while the originals are still on a camera card.
* **Import is one container open per file and no decode** — the probe port is
  defined that way, so forty files cost forty opens and not forty decodes.
* **Nothing is recorded when nothing changed.** An import that added no assets
  does not journal and does not make the project dirty; an autosave indicator
  that counted failed imports as work would be a liar.

### Ensuring the media a project needs

Importing a file does not make it playable. A 4K long-GOP clip is hostile to
scrubbing and a media bin without tiles is a list of file names, so the editor
needs proxies and thumbnails — minutes of work that cannot happen inside a
request.

    **Asking what is missing is a question, not a command.**

`POST .../media/ensure` is therefore *idempotent and cheap*:
`MediaJobFactory.plan(project, cache)` runs the two pure planners of §7.18,
groups the stills per asset, and returns a `PlannedJob` per unit of work; the
router submits them
and answers `202` with what it started. A project that already holds everything
queues nothing and says so in `summary`, which is why the frontend may call it
on an import, on a repaint, or on a timer without counting or debouncing
anything itself.

```
  routers/media.py        api/media_jobs.py          services/media        worker
  ┌───────────────┐ plan  ┌────────────────┐  ┌──────────────────┐  ┌──────────────┐
  │ EnsureMedia-  │──────►│ MediaJobFactory│─►│ proxy_requests   │  │ own decoder, │
  │  Request      │       │ (frozen, holds │  │ thumbnail_reque- │  │ own cache    │
  └───────┬───────┘       │  data_dir and  │  │ sts (pure)       │  │ index from   │
          │ 202           │  module-level  │  └────────┬─────────┘  │ data_dir     │
          ▼               │  factories)    │           ▼            └──────▲───────┘
  jobs.submit(spec, body) │                │  ProxyJob / ThumbnailJob      │ pickled
          │               └────────────────┘                               │
          ▼                                                                │
  EnsureMediaResponse{ jobs, proxies, strips, summary } ───────────────────┘
```

| Decision | Why |
|---|---|
| 202, never a wait | A transcode is minutes. A handler that did the work inline would hold a connection and be indistinguishable from a hang (ADR-0010). |
| One job per proxy, one per strip | A proxy is minutes of CPU on the process pool; a strip of eight stills is eight seeks on the thread pool. A job per frame would pay eight pickles to open one file eight times. |
| Deduped by artefact | The key is `proxy:<cache key>`, so a different target size is different work, and twenty panels asking for the same clip share one transcode. |
| `data_dir`, not a `MediaCache` | The workspace's cache holds a SQLite connection, and a connection does not pickle. `partial(new_cache, data_dir)` runs inside the worker. |
| A mid-list refusal answers at once | 503 says "ask again"; the jobs already queued are named in the caller's previous response, not in this one. |

The two flags exist because the two halves are needed at different moments:
after an import the bin wants tiles now and proxies can wait, and a panel that
only draws tiles should not be able to start a transcode.

### What the cache holds, and how to let it go

The cache is **install-wide** — one project's proxies are not another's — so
its verbs live on the system router.

| Method and path | Returns | Notes |
|---|---|---|
| `GET /api/v1/system/cache` | `MediaCacheResponse` | Entries oldest-use-first, plus the `total` and the bytes they name. |
| `DELETE /api/v1/system/cache?kind=` | `MediaCacheDroppedResponse` | How many entries and bytes went. `kind` may be `proxy` or `thumbnail`; a kind we do not have is a 422. |
| `POST /api/v1/system/cache/trim` | `MediaCacheTrimResponse` | Evict least-recently-used entries until the budget is met. |

**The budget is enforced where the bytes arrive, not on a timer.** Every job
carries it (`MediaJobFactory.budget`) and calls `enforce_budget` the moment it
has recorded a new artefact, naming that artefact in `keep` so a job cannot
evict its own work — an entry is least-recently-used the instant it is created.
`trim` is therefore for the two states a job is not running to fix: **a budget
that was just lowered**, and **bytes admitted before there was a budget at all**.

What is deliberately missing: **no per-project delete.** An entry belongs to the
install, not to a project, so deleting by project would leave entries no project
claims and reclaim nothing. And **no "evict this entry"**: a cache is derived
data, and a user picking individual files out of it is a user doing the LRU
policy's job worse (§7.19).

---

## 11. The job ring (`routers/export.py`, `routers/jobs.py`, `api/exports.py`, `api/job_events.py`)

Everything in §8–§10 answers inside the request. This ring is the first that
does not, and it is where ADR-0010 stops being a document about a scheduler and
becomes a contract a window can call.

    **An export is a job, not a request.**

It takes minutes. A handler that rendered one inline would hold a connection,
block a worker in the ASGI pool, and be indistinguishable from a hang while it
did — so `POST .../exports` answers `202` with a job id, and the work is
followed on the socket. The three endpoints that remain exist for the two
moments a *request* is genuinely the right shape:

| Method and path | Returns | Notes |
|---|---|---|
| `POST /api/v1/projects/{id}/exports` | 202 `ExportSubmission` | The job id, the project, the frame count, one line for the status bar. |
| `GET /api/v1/jobs` | `JobListResponse` | The history, newest first — including jobs a previous run started. |
| `GET /api/v1/jobs/{id}` | `JobRecordView` | One job, progress inside it. The resync read. |
| `POST /api/v1/jobs/{id}/cancel` | `JobCancelResponse` | `cancelled: true` means the request was *made*, not that the job has stopped. |

### What is deliberately not here

* **No "wait for the job" endpoint.** A request that blocked for nine minutes is
  a hang with a nicer name, and it holds a connection the socket already
  replaced.
* **No retry endpoint.** Whether a failure deserves another attempt is the
  scheduler's decision, made from the record — a button that retried a job which
  failed because the destination is read-only would fail identically, ninety
  seconds later.
* **No cancel-and-delete.** Cancelling does not remove the record: a job the user
  stopped is a job the history should still be able to explain.
* **No progress endpoint.** Progress is `job.progressed` on the socket, throttled
  to ≤ 20 Hz per job by the executor. A polling endpoint would re-add the 60 Hz
  request storm the event bus exists to remove.

### Class diagram

```
   routers/export.py              api/exports.py                 the worker
  ┌────────────────────┐   ┌──────────────────────────┐   ┌──────────────────┐
  │ StartExportRequest │   │ ExportJobFactory         │   │  ExportVideoJob  │
  │  path, container,  │──►│  renderer/ops/decoder    │──►│  project (frozen)│
  │  codec, crf, range │   │  = module-level fns      │   │  request, cache  │
  └─────────┬──────────┘   └──────────────────────────┘   └────────┬─────────┘
            │ mappers/export.py                                    │ pickled
            ▼                                                      ▼
     ExportRequest + OutputSpec                          spawn context, own
            │                                            decoders and encoder
            │  jobs.submit(export_job_spec(), body)
            ▼
   ┌────────────────────────────────────────────────────────────────────┐
   │ ConcurrentJobExecutor  (app.state.jobs)                            │
   │   record → admit → thread pool or one process per job              │
   └───────────┬──────────────────────────────┬─────────────────────────┘
               │ JobObserver                  │ reads and writes
               ▼                              ▼
      api/job_events.py              JsonJobStore → <data>/jobs.json
      JobEventBridge                  (one document, one lock, staged writes)
      job.progressed / job.status / job.failed
               │
               ▼
        EventBus → /api/v1/ws → the panel
```

### Validation happens before a worker exists

The container, the codec, the priority and the frame range are all checked in the
handler, against the open project, so a typo costs a `422` now instead of a
failed job ninety seconds from now. The range is *resolved* here too —
`ExportRequest.frames_for(project)` is what counts the frames the response
reports — which is why an export of an empty project is refused rather than
queued.

Two defaults live in `mappers/export.py` and nowhere else: the size defaults to
the project's own, and the timebase to the project's own. A default duplicated
into a client is a default two clients will eventually disagree about, and the
disagreement looks like two exports of the same project that do not match.

### Overwriting is allowed, and safe

The renderer writes beside the target and promotes on success
(`media-and-rendering.md` §7.7), so a failed export leaves the previous file
exactly as it was. Refusing to overwrite would be the worse deal: the user would
rename files by hand to buy the safety atomic promotion already gives them.

### Errors

| Code | Status | Meaning |
|---|---|---|
| `NS-PROJECT-4040` | 404 | No project with that id is open, so there is nothing to export. |
| `NS-VALIDATION-4220` | 422 | A container, a codec, a priority or a range the domain cannot build. |
| `NS-JOB-5001` | 503 | No slot. Nothing was started, so submitting again is safe. |
| `NS-JOB-5002` | 503 | The kind's circuit breaker is open, so this kind is disabled. |
| `NS-JOB-5006` | 409 | Cancelling a job that has already stopped. |
| `NS-JOB-5007` | 500 | A job body that cannot cross the process boundary — a bug in a factory. |
| `NS-JOB-5008` | 503 | The job history could not be written, so no job was started. |

The status is the transport's choice: `errors.STATUS_FOR_CODE` maps each code,
because a severity-derived default would call "no slot right now" a 500 and a
client would stop retrying something it should retry. A refusal from the executor
arrives as `Err` and is served with *its* remedy attached; the router never
rewrites the sentence.

### Caching and performance

* **Nothing is cached.** A job record is the truth about a job, and a second copy
  with an invalidation rule would be a second thing to keep in step.
* **The history is bounded at the edges**: `store.by_kind(kind, limit=…)` and a
  `HISTORY_LIMIT` of 50 rows, because a month of exports is thousands of records
  and a panel that fetched all of them to show the last twenty would cost the
  user a megabyte to save itself a filter.
* **Handlers are `def`, not `async def`**, and `submit` does no I/O beyond one
  write of one small JSON document, so the request path stays off the event loop.
* **The expensive parts happen in a worker the API never waits for**: the
  project is frozen into the job body, so an edit made while an export runs
  changes the editor and not the file being written.

---

## 12. Running the service (`server.py`, `cli.py`)

```bash
make serve                     # or: python -m nova_studio serve
python -m nova_studio serve --endpoint-file /tmp/session.json
python -m nova_studio serve --allow-host tablet.local      # adds, never replaces
python -m nova_studio openapi --out docs/architecture/api-contract.json
python -m nova_studio openapi --check docs/architecture/api-contract.json
```

`--allow-host` is for a development server reached from another machine, and it
**adds to** the guard's loopback set rather than replacing it
(`allowed_hosts_for`): a flag that quietly removed `127.0.0.1` would turn "let
me test from my tablet" into "the service is down". `make dev` passes it when
`DEV_HOST` is set, and a packaged shell passes nothing.

| Piece | Responsibility |
|---|---|
| `serve(app)` | Async context manager: start uvicorn on loopback, yield once listening, stop on exit. |
| `RunningServer.port` | Read from the *bound* socket. Binding to 0 and re-binding to "the port that was free" is a race with every other process on the machine. |
| `RunningServer.endpoint` | `SessionEndpoint(url, ws, token)` derived from the app's own session, so a shell cannot announce a token the service will refuse. |
| `write_endpoint_file()` | 0600, opened with the mode — for the moment the file exists with a wider mode, another user can read the token out of it. |

A desktop shell does not use the CLI: it calls `serve()` on its own event loop
and hands `endpoint` to the window. The CLI exists for `make dev`, for CI, and
for the day somebody wants to drive the editor from a script.

Uvicorn is configured with `access_log=False`: a desktop application's console
belongs to nobody, and an access log line per scrub request would be the loudest
thing in the process.

---

## 13. Caching strategy

None in this layer, on purpose. A cache in front of a service is a second copy of
the service's truth with an invalidation rule that is always slightly wrong. The
caches that exist live with their owners: the media proxy cache, the render
frame cache, the bus's retained history (which is a cache of *events*, sized and
evicted by L1).

What the API does instead of caching:

* **`ETag` / `304` later, per resource**, once the resource routers land — for
  reads where the client already has the bytes (thumbnails, waveform peaks).
* **Nothing on the preview.** `GET …/preview/frame` answers `Cache-Control:
  no-store`, because a frame is a rendering of a timeline that is being edited
  and has no identity to be cached under. The cache that makes scrubbing cheap
  is the render pool's, it lives behind the endpoint, and an edit clears it —
  which is the one invalidation rule that is never wrong, because the command
  that changed the timeline is the thing that declared it (§10, and
  `media-and-rendering.md` §7.14).
* **Warming is told the panel size.** `POST …/preview/warm` requires `width` and
  `height` rather than guessing them: a frame is decoded from one copy of an
  asset and cached under it, so a warm that picked a different scale would fill
  the pool with frames nobody will ask for and evict the ones they will
  (`media-and-rendering.md` §7.17).
* **Sequence numbers on the socket**, which let a client skip a refetch entirely
  rather than re-validate one.
* **The derived-media cache is budgeted, and admission enforces it.** A job that
  has just recorded bytes evicts least-recently-used entries until the install
  is back within `CacheBudget` (8 GiB by default), so the cache cannot be the
  reason a disk filled up. `POST /api/v1/system/cache/trim` is the manual half.
* **`GET …/preview/sources` says which copy is being decoded.** A proxy is
  transparent, which is right for a frame and wrong for a status line: the panel
  cannot tell which copy it drew, so it polls this instead of guessing — and it
  is the same question `ensure` answers with jobs, asked without starting any.
* **Capability negotiation once per session** (`/api/v1/system/capabilities`),
  not per operation.

---

## 14. Performance strategy

| Concern | Approach |
|---|---|
| Handshake cost | One socket for every topic, not one per topic. |
| Serialisation | `json.dumps` with separators stripped; payloads are small by contract. |
| Idle cost | A heartbeat every 15 s (configurable), not per-second polling. |
| Back-pressure | Bounded per-client buffer (512 events); the oldest are dropped and counted, not queued forever. |
| Slow clients | Never block the bus: a stream that is full drops for *that* client only. |
| Large payloads | Never on the socket — binary channel or REST (ADR-0005 §5). |
| Long work | Never in a request. An export is a job: `submit` writes one small JSON document and returns, and the minutes happen in a worker the request path never waits for. |
| Progress | Never polled. Throttled to ≤ 20 Hz per job, on the socket; the REST read exists for resync only. |
| Per-request allocation | Dependencies are built once at startup; handlers allocate a DTO and a JSON body. |
| Docs in a packaged build | `ApiSettings(docs=False)`: the schema is a map of the internals and costs nothing to withhold from a user who will never read it. |

The loopback call costs ~0.1–0.5 ms, which is why hot paths (scrubbing) use
optimistic UI on the frontend and binary frames rather than JSON.

---

## 15. Events

| Topic | Published by | Payload |
|---|---|---|
| `api.started` | lifespan, once listening | `version`, `port` |
| `api.stopped` | lifespan, on the way out | `port` |

The project ring adds one family:

| Topic | Published by | Payload |
|---|---|---|
| `project.created` | `ProjectWorkspace.create` | `project_id`, `path` |
| `project.opened` | `ProjectWorkspace.open` | `project_id`, `path`, `warnings` |
| `project.saved` | `ProjectWorkspace.save` / `save_as` | `project_id`, `path` |
| `project.checkpointed` | `ProjectWorkspace.checkpoint` / `autosave` | `project_id`, `sequence`, `revision` |
| `project.closed` | `ProjectWorkspace.close` | `project_id` |

They are session events: what the window's title, dirty marker and recent-files
list are driven by. They are not domain events and they are never journalled —
a replay does not re-open projects.

The job ring adds a third family, and it is the one a progress bar listens to
(`api/job_events.py`, §11):

| Topic | Published by | Payload |
|---|---|---|
| `api.jobs.reconciled` | lifespan, once on startup | `count` — how many jobs a previous run left open |
| `job.progressed` | the bridge, from the executor | `job_id`, `progress` (fraction, stage, detail, eta) |
| `job.status` | the bridge, on every change of state | the whole `JobRecord` |
| `job.failed` | the bridge, when the record went to `failed` | the whole record, under a second name |

`job.failed` is a *second name for a subset of the stream*, not a second stream:
a notifier, a log, a toast — each can subscribe to failures without filtering a
stream it otherwise ignores. Progress is throttled to ≤ 20 Hz per job by the
executor, and a stage change or the terminal report is never dropped, because a
bar that stops moving while the label changes reads as a hang.

Neither the timeline ring nor the media ring adds topics of its own; an import
publishes `project.edited` like any other change, and `media.imported` arrives
with the panel that needs to refresh while another window is importing. `CommandHistory` already publishes
`command.executed`, `command.reverted` and `command.failed`, and an edit also
publishes `project.edited` once it is journalled. Two families, because they
answer different questions: what a command did, and what that means for the file.

The REST read `/api/v1/events?since=&limit=` returns the same frames the socket
would have sent, so a client that cannot hold a socket open — a CLI, a test, a
recovery path after a long gap — is not a second-class citizen.

---

## 16. Testing

`tests/api/`, 309 tests, all of which run in `make check`.

| File | What it pins |
|---|---|
| `test_transport_security.py` | ADR-0005 §4: the token is required everywhere under `/api/v1`, `/healthz` is open and discloses three fields, the guard refuses foreign Host/Origin on **both** transports, two sessions do not share a token. |
| `test_errors.py` | One error shape: a 404, a 422, a service refusal and a genuine bug all produce the same keys; the severity→status mapping; no traceback on the wire. |
| `test_system_router.py` | Health, identity and capabilities; probing never imports what it probes. |
| `test_events_router.py` | The tail of history; a gap older than the retained history is a 416 that names the oldest sequence kept. |
| `test_ws_bridge.py` | hello → event → ping/pong → resync → goodbye; `complete: false` is honest; heartbeats carry the dropped count; a malformed frame does not kill the socket. |
| `test_projects_router.py` | The file menu: a close saves nothing; a second close is a 404; reopening forgets the dirty flag; a checkpoint truncates exactly `sequence - checkpoint_sequence - 1` entries; an edit that cannot be journalled is refused rather than acknowledged; a broken journal arrives through the injected factory, not by reaching inside. |
| `test_timeline_router.py` | The edit: every command applies and is journalled under its wire name with replayable arguments; a split's generated id is recorded; a refused command is a 409 that changes nothing (not even the redo future); undo and redo are journalled too; an edit that cannot be recorded is rolled back; the editor is the same object on the next request, so Ctrl+Z still has something to undo. |
| `test_media_router.py` | The bin, and the batch rule: a file that is not media is one entry in `failures` inside a 200 and not a failed import; a path imported twice is one asset; a relative path never reaches the disk; an import is journalled, and one that added nothing is not. |
| `test_server.py` | A real server on a real port: the port it reports is the port it is on, the token it announces is the token it accepts, the endpoint file is private. |
| `test_openapi.py` | The committed contract matches the routes (`make openapi` after a route change); every path is versioned or public; every field is documented. |
| `test_export_api.py` | The submission: 202 and a job id, never a file; a container, a priority or an empty range is a 422 **before** a worker exists; a range past the last clip is trimmed, not refused; a busy pool is a 503 that started nothing. |
| `test_jobs_api.py` | The history: newest first, readable after a restart, progress carried *inside* the row so one request resyncs a reconnecting client; an unknown id is a 404; cancelling a finished job is a 409 and not a shrug. |
| `test_job_events.py` | The translation: `job.status` carries the whole record, `job.failed` is published beside it and only for a failure, a cancellation is not a failure, the two events do not share a payload, and the bridge can be unsubscribed. |
| `test_export_api.py::test_an_export_really_runs_in_a_worker…` | *(integration)* The wiring with nothing doubled: a real submission runs in a real worker, the file is written where the dialog chose, and the finished record is in the history a restarted editor would read. |

Two `TestClient` quirks are worth knowing before a mysterious 403 costs an hour:

* A client built without `base_url` sends `Host: testserver`, which the guard
  refuses — correctly, because it is not a loopback address.
* `TestClient` does **not** derive a WebSocket handshake's `Host` from its
  `base_url`; every handshake arrives as `testserver` unless the test passes the
  header. `tests/api/conftest.py` exists to say so once.

The doubles in `test_ws_bridge.py` (`ScriptedSocket`, `FakeBus`) exist because
two promises — silence and loss — cannot be arranged through a real socket
without a sleep and a hope.

`tests/api/job_fakes.py` is the stand-in executor the job tests share. It is
worth one paragraph of its own, because what it does *not* fake is the
instructive part: it writes into the **real** `JsonJobStore`, so the history
endpoints are exercised against the same file production writes, and it refuses
on cue so the 503 and 409 paths are reachable without arranging a genuinely full
pool. Whether a worker really starts is the executor's own question, and it is
asked of the real thing with real processes in `tests/infra/test_jobs.py`.

---

## 17. Frontend architecture notes

The frontend (stage 4) consumes this layer under rules that fall out of the above:

1. **One client, one token.** Read it from the endpoint the shell handed you;
   send it as `Authorization: Bearer` and in the handshake query string. Never
   persist it — a token in `localStorage` is a token any script can read.
2. **Watch the sequence numbers.** A gap is not an error, it is a `resync`. If
   `complete` is `false`, refetch the slice over REST and say nothing to the user.
3. **Reconnect with backoff, then resync.** On `hello`, compare its `seq` with
   what you have; the difference is exactly what you missed.
4. **Heartbeats are liveness, not data.** If none arrives within two intervals,
   treat the socket as dead and reconnect.
5. **Optimistic UI for anything at display rate** (transport position, drag
   gestures); the socket is authoritative but not fast enough to be the only
   source during a scrub.
6. **Errors are one shape.** Parse `code` for localisation, `detail` for the
   toast, `remedy` for the action, `retryable` for whether to offer one.
7. **Subscribe to jobs, do not poll them.** `POST .../exports` gives you an id;
   `job.progressed` moves the bar and `job.status` ends it. Read
   `GET /api/v1/jobs/{id}` when you arrive late — a reconnect, a window opened
   over a running export — and never on a timer.
8. **`pywebview.api.*` is for native window concerns only** (ADR-0005 §3):
   show/hide, minimise/maximise/fullscreen, native dialogs, clipboard image,
   focus, title, quit. A lint rule in the frontend will forbid it elsewhere.

---

## 18. Future expansion

| Next | Why the seam is already there |
|---|---|
| Resource routers (captions, plugins) | `include_router` with the token dependency; `respond()` for the mapping; `schemas/` + `mappers/` for the DTOs; `ProjectWorkspace.apply` for anything that edits. Render landed as `routers/render.py` (`media-and-rendering.md` §7.14), export and jobs as §11, and those two are the model for the rest. |
| A transcription job, end to end | `ports/jobs.py` is kind-agnostic and the caption body will be a second `JobBody` with the same shape; `JOB_KINDS` in `routers/jobs.py` is the one line to add. |
| Relinking missing media | `MediaAsset.relink` already couples the hash and the probe correctly; what is missing is a content hash at import (`ports/filesystem.py`) and the endpoint that offers a replacement path. |
| `AudioResampler` | `infra/media.py` has the prober and `PyAVDecoder` implements `MediaDecoder`; the audio half arrives with the audio slice, behind the same port. |
| Replaying a journal | The entries already carry everything a replay needs: the wire name, the arguments, and `undo`/`redo` markers. What is missing is the fold itself (§9), and the recovery dialog that offers it (`services/projects/recovery.py` already returns the plan). |
| A second editing scope (captions, colour) | `UndoScope` already separates the stacks, so a caption editor gets its own history next to the timeline's; `ProjectWorkspace` would hold one editor per scope per project. |
| Multi-window | `ProjectWorkspace` is a value on `app.state`, not a global; two windows in one process would each get one, and the "already open here" rule (4090) is already per-workspace. |
| Command endpoints (`POST /api/v1/timeline/commands`) | Commands are already the public editing API; a router that accepts a serialised command and returns the events it produced is a thin translation. |
| ~~Job endpoints (progress, cancel)~~ | **Landed as §11**: `routers/export.py` submits, `routers/jobs.py` lists, reads and cancels, `api/job_events.py` puts `job.*` on the bus. What is still missing is a *scheduler* — a queue that defers and reorders, which `decide_admission` and `deferral_candidate` already describe from the outside. |
| Binary frame channels (waveforms) | ADR-0005 §5 fixes the three sinks; the socket already separates text and binary frames. Preview chose HTTP-and-`no-store` over the socket for now, so a frame is one cacheable-by-nobody request rather than a subscription the server must keep up with. |
| `ETag`/`304` on media reads | The resource routers will own the validators. |
| PyWebView bridge (`apps/desktop`) | `serve()` runs in-process; `endpoint` is what the window is handed. The bridge carries window concerns only. |
| A second window | `create_app` takes its session as an argument and holds no global; two apps in one process already have two tokens (there is a test). |

---

## 19. Where to read next

* [`ARCHITECTURE.md`](ARCHITECTURE.md) §4 — where L4 sits in the ring model.
* [`adr/ADR-0005-local-http-ws-transport.md`](adr/ADR-0005-local-http-ws-transport.md) — the transport decision and its alternatives.
* [`services.md`](services.md) — what the routers will call.
* [`api-contract.json`](api-contract.json) — the generated contract the frontend compiles against.
