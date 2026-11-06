# The service layer (L3)

**Status:** Living document · **Owner:** Architecture Group · **Last reviewed:** 2026-11-03

The layer between *what a project is* (`domain`) and *how the mechanics work*
(`infra`). This document is the house style for every feature package under
`nova_studio/services/` and the record of what each one owns.

---

## 1. Purpose and rules

A service turns an intent — "export this timeline at 1080p", "caption this clip
and translate it to Japanese", "apply a blur to this clip" — into a sequence of
domain operations and port calls. It owns **workflow**; the domain owns
**truth**; the adapters own **mechanics**.

Four rules, all enforced by `scripts/check_layering.py`:

1. **Depends on `ports`, never on `infra`.** Adapters arrive from the DI
   container. A service that writes `import av` has silently acquired FFmpeg as
   a test dependency and can no longer be exercised without it.
2. **Feature isolation.** A module in `services/render` may not import from
   `services/captions`, and vice versa. Each feature is independently
   replaceable, so they collaborate through `ports` and the `EventBus` rather
   than through each other's internals. The one exception is `services/shared`,
   the deliberate kernel for cross-feature helpers.
3. **May import** `core`, `domain`, `ports`, `services.shared` and its own
   feature package. May not import `infra` or `api`.
4. **Long-running work goes through the job scheduler**, not a bare thread
   (ADR-0010). A service that spawns its own thread cannot be cancelled,
   prioritised, rate-limited or recovered after a crash.

**Error discipline.** Services return `Result[T]` from `core/result.py`. They
reserve exceptions for invariant breaches they cannot recover from, so a caller
can distinguish "this export cannot proceed, here is why" from "this program is
wrong". Every failure carries a stable `NS-<DOMAIN>-<NNNN>` code the UI
localises by; the message is the developer's fallback and the log's text.

**Database schema.** None. Services own no tables: the per-project store is a
derived index rebuilt from `timeline/document.json`, and its schema belongs to
`infra/persistence` (ADR-0004 §3, [`project-file-format.md`](project-file-format.md)).

---

## 2. Folder structure

```
services/
├── shared/       cross-feature helpers (the sanctioned exception to rule 2)
├── projects/     open, save, autosave, crash recovery
├── media/        ingest, probing, thumbnails, proxy generation, the media cache
├── timeline/     edit operations as commands, undo scopes, ripple logic
├── render/       the frame pipeline: decode → graph → composite → encode
├── captions/     the caption pipeline: transcript → cues → styles → timeline
├── effects/      the effect catalogue and the graph it builds   ← built
├── export/       caption sidecars (SRT, VTT) · presets, queueing, packaging
├── ai/           AI Studio orchestration on top of captions and effects
├── plugins/      manifest validation, permission audit, lifecycle
└── jobs/         scheduler, admission control, circuit breaker
```

Each feature package carries a module docstring with the same fourteen headings
used in §3–§9 — purpose, structure, backend/frontend architecture, state,
functions, events, errors, caching, performance, testing, future expansion — so
a feature is documented where it is read.

---

## 3. Feature: `services/effects/`

**Purpose.** Own everything about an effect that is not *what an effect is*
(that is `domain/effects.py`) and not *how an effect is computed* (the render
engine, §7.2 of [`media-and-rendering.md`](media-and-rendering.md)): which
effects this install has, what a fresh instance of one looks like, and whether
an effect found in a project file still matches the spec that describes it.

**Backend / frontend.** The registry is the backend of the effect browser and
the effect inspector. The frontend holds no spec of its own: it asks for
`specs_in(category)` to draw the browser, `specs_for_target` to decide what may
be dropped where, and `instantiate` when the user drops one. A parameter
control is generated from a `ParameterSpec` — kind, range, step, unit, hint and
whether a stopwatch is offered — so a plugin that ships a new effect gets a
finished inspector with no frontend code at all (ADR-0011).

**Class diagram.**

```
EffectRegistry (frozen value)
├── specs: tuple[EffectSpec, ...]        sorted by type
├── spec_for(type) → EffectSpec | None
├── specs_in(category) / specs_for_target(target)
├── register(spec)  → Result[EffectRegistry]     refuses to shadow
├── replace(spec)   → EffectRegistry             explicit override
├── unregister(type)→ EffectRegistry             idempotent
├── instantiate(type, id) → Result[Effect]       spec's defaults
├── validate(effect) → Result[Effect]            missing spec ⇒ Ok
└── validate_chain(chain) → Result[EffectChain]

builtins.py  —  BUILTIN_TYPES, builtin_specs(), builtin_registry()
```

**State management.** No mutable state survives a call. `register`, `replace`
and `unregister` each return a new registry, so a snapshot handed to a render
worker cannot be changed underneath it by a plugin that installs mid-render,
and a test needs no teardown. The DI container holds the current registry;
swapping it is one assignment.

**Functions and APIs.**

| Call | Answers |
| --- | --- |
| `builtin_registry()` | "what do we have before plugins" |
| `register` / `replace` / `unregister` | "add, upgrade or withdraw one effect" |
| `spec_for` / `in` / `types` | "do we have this one" |
| `specs_in` / `specs_for_target` | "what goes in this drawer, what can go here" |
| `instantiate(type, id)` | "give me a fresh one, at its defaults" |
| `validate` / `validate_chain` | "does this one from a project file still make sense" |

**Events.** None yet. When the plugin service gains a lifecycle, publishing will
emit `plugin.effect.registered` / `plugin.effect.withdrawn` on the `EventBus`
(`core/events.py`) so an open project can re-audit its chains. The registry
itself stays silent, so a test never has to drain a bus.

**Error handling.**

| Code | Meaning | Retryable |
| --- | --- | --- |
| `NS-EFFECT-4001` | The effect type is not installed here. | No — install the plugin. |
| `NS-EFFECT-4002` | An effect instance does not match its spec. | No — reset or update. |
| `NS-EFFECT-4003` | Two specs claim one type. | No — a name collision needs a human. |

**Caching.** `as_mapping()` builds a dictionary per call, deliberately: the
mapping is handed to domain validators that must not see it change, and a
registry holds dozens of specs, not thousands. If the catalogue ever grows to
where this matters, the cache belongs in the caller, which knows its own
lifetime.

**Performance.** Lookups are linear over a tuple of specs — tens of entries,
called when a user opens a panel, not per frame. The per-frame path is the
renderer's, and it never sees this module.

**Testing.** `tests/services/test_effects_registry.py` pins immutability, the
refusal to shadow, the "not installed still opens" rule and the error codes.
`tests/services/test_effects_builtins.py` pins that every built-in
instantiates, validates and carries defaults inside its own bounds — the
cheapest guard against a catalogue drifting out of step with the domain.

**Future expansion.**

* **Versioned specs.** `EffectSpec.version` is carried but not yet enforced;
  migrating an older instance belongs here, next to `validate`.
* **Presets.** Named parameter sets (a look, a house style) are a catalogue
  concern and will sit beside `builtins`.
* **Audio effects.** `EffectSpec.is_audio` exists; an audio registry will share
  this one when the mixer lands (§7.4).

---

## 4. Feature: `services/projects/`

**Purpose.** Own the *lifecycle of a file*, as distinct from what a project is
(`domain/project.py`) and how its bytes are stored (`infra/persistence`):
opening one, saving one, deciding whether it is in a good state, checkpointing
it often enough that a crash costs little, and — after a crash — working out
what to offer back. The whole feature is one user-facing sentence: **you lose at
most N commands or T seconds of work.**

**Backend / frontend.** The frontend never opens a file, never decides whether a
project is healthy, and never computes a timestamp. It calls one API per intent
— open, save, checkpoint, audit — and renders what comes back:
`OpenedProject.warnings` in a banner, `ProjectAudit.summary()` in the relink
panel, `RecoveryPlan.offers` as a dialog. Every sentence a user reads about a
damaged file is produced here or in the domain, so there is one phrasing of the
rule and not one per surface.

**Class diagram.**

```
ProjectSession                      session.py
├── open()      → Result[OpenedProject]   refuses only 4001 / 4002 / 4003
├── save(p)     → Result[ProjectManifest] stage all → commit → discard on failure
├── checkpoint(p, label) → Result[RevisionRef]
├── audit(p)    → ProjectAudit            (no I/O)
└── close()

OpenedProject   manifest · project · warnings      → is_clean
ProjectAudit    problem · missing_assets · unused_assets
                clip_count · duration_frames       → summary() : tuple[str, ...]

AutosaveState (frozen)              autosave.py
├── recorded(at_ms, commands) / checkpointed(at_ms) / due(now_ms)
├── commands_until_due()            what the status bar shows
└── revisions_to_drop(revisions)    oldest beyond the bound

plan_recovery(window, checkpoint_sequence) → RecoveryPlan   recovery.py
├── checkpoint_sequence · pending_commands · torn_tail
├── offers   REPLAY_JOURNAL · RESTORE_CHECKPOINT · DISCARD  (best first)
└── detail   one sentence for the dialog
```

**State management.** `ProjectSession` holds the archive, the clock and the
manifest it last saw — nothing else; it is a door, not a copy of the house.
`AutosaveState` and `RecoveryPlan` are frozen values, so a snapshot can be
handed to a worker or compared in a test and no mutable project state lives in
this layer. The autosave counters live in the state rather than in the caller
because three places need the same answer: the tick, the manual checkpoint and
the recovery flow.

**Functions and APIs.**

| Call | Answers |
| --- | --- |
| `open()` | "give me this project, and tell me what is wrong with it" |
| `save(project)` | "make it durable, and tell me when" |
| `checkpoint(project)` | "remember this moment" |
| `audit(project)` | "what should the user fix" |
| `recorded` / `due` / `checkpointed` | "is it time" |
| `plan_recovery(...)` | "what do we offer after a crash" |

**Events.** None yet, and deliberately: opening and saving already return values
to a caller that knows the outcome. When the plugin service gains a lifecycle,
`services/projects` will subscribe to `plugin.effect.*` to re-audit open
projects and to `media.relinked` to clear a missing-asset warning.

**Error handling.** `Result[T]` throughout, `NS-PROJECT-4xxx`:

| Code | Meaning | Retryable |
| --- | --- | --- |
| `NS-PROJECT-4001` | Written by a newer Nova Studio; refused whole. | No — update. |
| `NS-PROJECT-4002` | A required document is missing. | No — restore. |
| `NS-PROJECT-4003` | The project rebuilt into something invalid. | No — restore. |
| `NS-PROJECT-4004` | The save did not become durable; the old file is intact. | **Yes.** |

Everything else — a moved clip, a damaged caption document, a dangling binding —
is a **warning on a project that still opens** (ADR-0015 rule 3). A damaged
caption is isolated per document and named, which is why captions are separate
entries in the container at all (rule 7).

**Caching.** None. A `.nova` file is tens of kilobytes of JSON and a save
rewrites it wholesale; caching a project across a save would be a stale-read
bug wearing a performance badge.

**Performance.** Open is one manifest read, two document reads and one caption
listing; save is two or three document writes plus one commit. The commit is the
atomic replace — the expensive part — which is exactly why autosave checkpoints
every 200 commands rather than every one (ADR-0015 §6).

**Testing.** Three files, no filesystem and no real clock:

* `tests/services/test_projects_session.py` — open, save and round-trip against
  an in-memory archive, plus every warning path: missing media, a dangling clip,
  a damaged caption, a failed commit that leaves the previous file intact.
* `tests/services/test_projects_autosave.py` — pins "at most 200 commands or
  two minutes", the burst case, the idle case, pruning and the backwards clock.
* `tests/services/test_projects_recovery.py` — pins the offers, the
  checkpoint-exclusive cut and the torn tail.

**Future expansion.**

* **Save-as and template export**, which reuse `_documents` verbatim.
* **The autosave service** (ADR-0015 §6) now that `infra/persistence` exists:
  `open_journal()` supplies the log, `plan_recovery` already decides what to
  offer a user after a crash, and `AutosaveState` already answers "is it time".
  What is missing is the one service that owns the clock and calls the three.

---

## 5. Feature: `services/media/`

**Purpose.** Own the three decisions that stand between a file on a disk and a
clip on a timeline: **does this file belong here** (ingest), **which copy of it
should we decode** (the proxy policy), and **which frames should we draw** (the
thumbnail plan). What a file *is* lives in `domain/media.py`; reading bytes is
`infra/`'s job through `ports/media.py`. This layer decides and reports.

**Backend / frontend.** One API per intent. The frontend drops forty files on a
panel and gets one `IngestReport` back: `assets` to add to the project,
`failures` to list with their code mapped to a local message, `duplicates` to
say "already here", and `summary()` for the status bar. It never probes, never
compares paths and never decides a codec is expensive — the policy lives here so
that a laptop build and a workstation build differ by one binding, not by two
code paths.

**Class diagram.**

```
MediaIngestor                         ingest.py
└── ingest(paths, existing) → IngestReport
        entries   : tuple[IngestedAsset]   asset + warnings
        failures  : tuple[IngestFailure]   path + NovaError (code kept)
        duplicates: tuple[str]             paths already present
        → assets · succeeded · is_complete · summary()

ProxyPolicy (frozen)                  proxy.py
├── decide(scale, available) → DecodeSource   ORIGINAL | PROXY | THUMBNAIL
├── plan(info)               → ProxyPlan      needed · reason · target size
└── is_edit_friendly(info)   → bool

thumbnail_indices(count, wanted, keyframes) → tuple[int, ...]   thumbnails.py
snap_to_keyframe(index, keyframes)          → int

proxy_key(asset_id, height) → str                              keys.py
thumbnail_key(asset_id, frame, width) → str
kind_of(key) → CacheKind · is_safe_key(key) → bool

MediaCache (frozen)                       cache.py
├── has(key)                    → bool           entry AND file
├── record(key, size_bytes)     → Result[None]   when the bytes are complete
├── acknowledge(key)                             throttled LRU touch
├── forget(key)                 → Result[None]   file first, then row
├── resolve(project, id, source) → str | None    fallback → the original
├── resolver_for(project)       → SourceResolver live, not captured
└── sources_for(project, scale) → Mapping[str, str]   one frame, one question
```

**State management.** `MediaIngestor` holds an injected prober and id source and
nothing else; every import is independent and repeatable. `ProxyPolicy`,
`ProxyPlan` and the index tuple are frozen values, safe to hand to a render
worker or to cache as part of a job payload. `MediaCache` is frozen too, and the
only mutable thing it carries is the small in-memory note of when each key's use
was last written down — an approximation by design, since two threads racing to
note the same key would write the same value. Everything else is injected: the
bookkeeping is a `CacheIndex` port, the bytes are files under a root, the time is
a `Clock`, and the only two facts about the disk this module needs — *is it still
there*, *delete it* — arrive as `exists` and `unlink`. No handles, no threads:
the only long-running work this feature *causes* is a proxy transcode, and that
goes to the scheduler as a `NORMAL` job (ADR-0010) — never a thread spawned here.

**Functions and APIs.**

| Call | Answers |
| --- | --- |
| `ingest(paths, existing)` | "what did we get, what failed, what was already here" |
| `decide(scale, available)` | "which copy do I decode at this preview scale" |
| `plan(info)` | "is a proxy worth building, and how big" |
| `thumbnail_indices(...)` | "which frames does a strip ask for" |
| `proxy_key(...) / thumbnail_key(...)` | "what this derived artefact is *called*" |
| `has(key)` | "do we actually hold it" (an entry *and* a file) |
| `resolve(project, asset_id, source)` | "which file is this decode's copy" |
| `sources_for(project, scale)` | "which copy should every asset on the timeline use" |

**Events.** None yet. Proxy transcodes will publish `job.*` through the
scheduler; ingest will emit `media.imported` once the media panel needs to
refresh live, and `media.relinked` when the relink flow lands — which is when
`services/projects` starts listening (see §4).

**Error handling.** Ingest never returns a `Result`, because a batch cannot fail
as a batch: failures travel *inside* the report, each carrying the `NovaError`
the probe produced (`NS-MEDIA-4001` unreadable, `-4003` unsupported codec,
`-4004` decode failed). Empty paths are refused without I/O under `-4001`.
`ProxyPolicy` and `thumbnail_indices` raise `NovaInvariantError` for a
nonsensical argument (a non-positive scale, a negative frame count), because
those are bugs in the caller and not states of a file.

**Caching.** None in the code — but the *output* is the cache key.
`thumbnail_indices` is deterministic, so a strip laid out today and the same
strip laid out after a reopen ask for the same frames and hit the same cache
entries instead of repopulating them (ADR-0015 rule 6: the cache is disposable,
and a stable key is what makes a disposable cache useful).

`MediaCache` is where that key becomes a file, and it is deliberately not a
store: bytes live in files, bookkeeping lives in a `CacheIndex`, and both are
handed in. Its one interesting decision is a **fallback towards the original** —
a missing thumbnail answers with the proxy, a missing proxy answers with the
original. The alternative, a cache miss as a *gap* in the composite, would make
a preview disappear because a thumbnail had not been generated yet.

The index is read on the request path and written from a job thread, so the
composition root binds `open_shared_cache_index()`: one connection,
`check_same_thread=False`, and a lock around every statement (§7.17). An ordinary
adapter still gets the single-owner gateway, and that default is a promise rather
than an accident — a private connection used from another thread is refused,
which is how a caller learns it needed the shared one.

A use is noted at most once per key per five seconds. "Which copy should I
decode" is asked sixty times a second while scrubbing, and an `UPDATE` per answer
would make the cache a net cost to the disk it exists to spare: **LRU is a
ranking, not a log.**

**Performance.** Ingest is one container open per file and no frame decode — the
probe port is defined that way on purpose. The thumbnail plan is integer
arithmetic; it exists precisely to keep the decode count down, snapping each
target back to a keyframe so a ten-minute 4K clip costs eight cheap seeks
instead of eight GOP walks. The proxy plan is the other half of the same
argument: never decode more pixels than the preview can show.

**Testing.** `tests/services/test_media_ingest.py` pins the batch rules against
a fake prober and a deterministic id source — including that a duplicate is not
probed twice and that no id is minted for a file that failed.
`tests/services/test_media_proxy.py` pins the fidelity budget, the single
edit-friendly codec vocabulary and the even-dimension arithmetic.
`tests/services/test_media_thumbnails.py` pins the spread, the backwards-only
keyframe snapping and the deduplication.
`tests/services/test_media_cache.py` (36) pins the naming — that a key is
derived, stable and refuses anything that is not a single file name — and the
four rules of the cache: the fallback towards the original, entry-and-file,
forget-bytes-then-row, and the throttled touch. Its doubles are a dict, a set
and a clock. `tests/infra/test_persistence_sqlite.py` pins the shared gateway.
No FFmpeg, no filesystem, no numpy beyond what the domain already carries.

**Future expansion.**

* **Generation**, which is the half of this feature that does not exist yet: a
  `ProxyJob` built from `ProxyPlan`, the thumbnail strips from
  `thumbnail_indices`, and byte-budgeted eviction over `select_for_eviction`.
  All of it as `NORMAL` jobs, and none of it requires a change to `MediaCache` —
  the producer calls `record()` when the file is complete and the planner calls
  `forget()` when the budget says so.
* **Content hashing** once `ports/filesystem.py` exists: duplicates will then be
  matched by bytes, and a relink will be provable rather than hopeful. Until
  then duplicates are matched by path, and the panel says so.
* **Waveform and audio-analysis planning** — the same shape as the thumbnail
  plan: indices in, samples out.
* **A `ProxyJob` builder** turning `ProxyPlan` into a scheduler submission, once
  `services/jobs/` lands.

---

## 6. Feature: `services/timeline/`

**Purpose.** Own the six structural edits — move, trim, slip, split, lift,
ripple delete — the geometry behind them, and the one door they go through.
`domain/timeline.py` decides *what a timeline is*; this decides *what the user
may do to one, and how it is undone*. Nothing here renders and nothing here
saves: an edit ends with a new `Timeline` in the store and an entry on the undo
stack. This is where ADR-0008 rule 1 becomes concrete — there is no other way to
change a timeline.

**Backend / frontend.** The frontend never mutates a timeline. A drag, a razor
cut and a delete each construct a command and hand it to
`TimelineEditor.execute(command)`; what comes back is a `CommandOutcome` naming
the affected ids and the caches to invalidate. The Edit menu reads `can_undo` /
`undo_label` / `can_redo`; the history panel reads `recent()`. A drag sends a
`gesture` token so a hundred mouse-moves become one undo entry.

**Class diagram.**

```
TimelineStore                         store.py
└── timeline: Timeline                the one mutable object in the feature
    current() · replace(next) → previous · reset(timeline)

TimelineEditor                        editor.py
├── store · history · project_id · bus · clock
├── execute(command, ctx?) → Result[CommandOutcome]
├── undo() / redo()        → Result[Command | None]
└── state() · can_undo · undo_label · depth · recent()

TimelineCommand (abstract)            commands.py
├── execute(ctx)   store lookup → _apply → guard → restore on refusal
├── _apply(store, timeline)           the edit itself
├── undo(ctx)                         from the captured delta
└── validate(ctx)                     named preconditions
    ├── MoveClipCommand          to_start_frame / to_track_id · coalescible
    ├── TrimClipCommand          START | END edge · speed-aware · coalescible
    ├── SlipClipCommand          delta_frames · accumulates · coalescible
    ├── SplitClipCommand         at_frame + a caller-supplied new id
    ├── LiftClipCommand          removes, leaves the gap
    ├── RippleDeleteCommand      closes the gap · MemoryClass.MEDIUM
    └── ReplaceTrackClipsCommand "hold exactly this" · a generated track
                                 records `created`, so a refusal undoes nothing

sync.py  —  TrackSync · SyncReport · sync_tracks · sync_report
            one CompositeCommand over several ReplaceTrackClipsCommands

ripple.py  —  lift_clip · reinsert_clip · ripple_delete · undo_ripple
              split_clip · slip_clip · source_frames_for      (pure)
```

**State management.** Exactly one mutable object: `TimelineStore`, which holds a
frozen `Timeline` and replaces it wholesale. Undo deltas are captured scalars —
a move is four values, a ripple is a clip plus the ids that travelled — so undo
memory is independent of project size (ADR-0008 §2). Commands themselves are the
second piece of state: they record what they captured so they can put it back.

**Functions and APIs.**

| Call | Answers |
| --- | --- |
| `TimelineEditor.execute(command)` | "do this edit, or tell me why not" |
| `TimelineEditor.undo()` / `.redo()` | "put that back" / "put it back again" |
| `TimelineEditor.state()` | "what does the Edit menu show" |
| `ripple_delete(timeline, track_id, clip_id)` | the new timeline, plus the delta |
| `split_clip(clip, at_frame, new_id)` | the two halves |
| `slip_clip(clip, delta)` | the same clip, a different source window |
| `source_frames_for(clip, frames)` | how much source a timeline span eats |
| `sync_tracks(editor, tracks, ctx?)` | "make these tracks hold exactly this, in one transaction" |
| `sync_report(editor, tracks)` | "what would a sync change — is it worth doing?" |

**Events.** `CommandHistory` publishes `command.executed`, `command.reverted`
and `command.failed` on the injected `EventBus`, carrying the affected ids and
the invalidation set (`timeline`, `preview`, `thumbnail`). Cache invalidation,
preview re-render, autosave dirty-marking and the WebSocket broadcast are all
*subscribers* to those — never call sites inside a command (ADR-0008 rule 6).

**Error handling.** `Result[T]` end to end, on `CommandError`'s codes:
`NS-COMMAND-4101` execution failed, `-4102` undo failed (critical — state may be
inconsistent), `-4103` undo of a command that never ran, `-4104` precondition
rejected. Preconditions are named, not generic: "track 'v1' is locked; unlock it
to edit", "clip 'c1' would overlap another clip on track 'v1' at frame 40". A
rejected command is never recorded, so trying something impossible costs the
user nothing — not even their redo future.

One guard is inherited by every command: if `validate_timeline` finds a problem
*after* an edit that was not there *before*, the previous timeline is restored
and the command reports a precondition failure. The promise "a command may not
be the thing that breaks the timeline" lives in one place instead of six, and it
fires before the history records anything. A timeline that arrived broken is
still editable — the guard is about what this command did, not about yesterday.

**Caching.** None. An edit invalidates, and the invalidation set is *data on the
outcome*, consumed by a subscriber; no command touches a cache.

**Performance.** Edits are O(clips on the affected tracks) — a ripple walks every
track once. The one superlinear step is the post-edit `validate_timeline` guard,
which is O(n²) per track and runs on an edit, not per frame. Undo deltas are a
handful of integers, so a two-thousand-clip timeline costs the same to undo as a
three-clip one.

**Testing.** `tests/services/test_timeline_ripple.py` pins the geometry —
including that ripple skips locked tracks, that a split respects speed and
reverse, and that every delta inverts.
`tests/services/test_timeline_commands.py` pins each command: validate, execute,
undo, the coalescing rules and the guard.
`tests/services/test_timeline_editor.py` pins the door itself — undo/redo
ordering, the Edit-menu state, and that a rejected command leaves the redo stack
alone.
`tests/services/test_timeline_sync.py` pins the reconciler's transaction: a
multi-track sync is one undo entry, a locked track rolls the whole plan back and
leaves nothing behind, and a second sync of an unchanged document issues no new
version. No FFmpeg, no filesystem, no clock that moves unless told to.

**The reconciler (ADR-0009 §8).** A caption document is the authoring source of
truth, and it is not the timeline — but captions have to be *on* the timeline to
be trimmed, moved and exported with the picture. Two modules keep the two in
step, and neither imports the other:

```
services/captions/commit.py       document + frame rate → the clips it implies
services/timeline/sync.py         SyncReport · TrackSync · sync_tracks → applies
                                  several of them as one transaction
services/timeline/commands.py     ReplaceTrackClipsCommand → applies one
        └── the application layer is the only place that knows about both
            (ADR-0002 rule 4: a feature may not import a sibling feature)
```

Three modules, and the handshake between them is a plain value. `commit.py`
answers *what* a document asks a track to hold; `sync.py` answers *how* the
timeline is made to hold it, and its input — a `TrackSync` of a track id and some
clips — names nothing about captions, which is why neither side imports the
other. A caption layer, a chapter list and a beat grid all reconcile through the
same door.

One cue is one `Clip` of `ClipKind.CAPTION`, with no asset: its content is the
document, which is why the kind counts as generated in the domain. A clip's id is
**derived** from where the cue is, not minted per commit — so committing an
unchanged document produces identical clips, `ReplaceTrackClipsCommand` reports
that nothing changed, and a re-transcription of one cue replaces one clip instead
of rebuilding the track. Applying a commit is one command, therefore one undo
entry, therefore one transaction: Ctrl+Z after a forty-cue commit does not step
through the track rebuilding itself. A locked track is never rewritten, and a
commit of nothing creates no track at all.

`sync_tracks(editor, tracks)` is that transaction for several tracks at once: a
project with a primary caption layer and two translations is three tracks, and
three separate commits would mean Ctrl+Z steps through the rebuild one language
at a time — while a failure after the first would leave a timeline that is
neither the old captions nor the new ones. One `CompositeCommand` gives both
properties at once: all-or-nothing on failure, one undo entry on success. Two
details earn their keep. The report is taken **before** the edit, because asked
afterwards it could only ever answer "nothing changed" — true, useless, and
hiding a re-render. And a command that was *refused* records `created = False`,
so its undo cannot delete the track it never made: a composite rolls back by
asking the failed child to undo itself, and a locked-track refusal that undid
"the track I created" would delete the very track it was refused access to.

**Refine, in one paragraph.** `Refiner` takes fillers ("um", "uh", "er"), false
starts ("we're going to we're going to") and stutters ("I I I") out of a
document — fillers first, so an "um" inside a false start does not hide it — and
then tidies what is left: collapsed whitespace, no space before punctuation, a
capital at the start of each sentence. It never changes a word it keeps, never
re-times a segment, never raises a confidence, and never touches a locked line.
Two rules keep it from doing damage: a word repeated **twice** is kept ("very
very" is emphasis, not a stutter), and the filler sets are deliberately small —
a missing entry costs a filler that survives, which a human deletes in a second,
while a wrong entry deletes a real word, which a human may never notice. A
stutter's surviving word keeps its start and stretches to the end of the run, so
karaoke highlight sweeps across it instead of leaving a hole.

**Highlight, in one paragraph.** `Highlighter` sets `CaptionWord.highlight` — the
flag the templates and the animation baker consume — from five signals, each
switchable: **numbers** ("47", "3.5", "30%"), the **unit** beside them ("5
minutes"), words the speaker **held** (far longer than their own median word,
which is the only signal here that hears the performance rather than reading
it), a **name** the first time it is said, and a **term** said three or more
times across the piece. Candidates are *scored*, not fired in order, and the
best two win: a cue with six highlighted words is a cue with none. A highlight a
human set is never unset and never spends the cap, and a filler is never the
word of the line even with `Refine` switched off.

**Emoji, in one paragraph.** `EmojiDecorator` sets `CaptionSegment.emoji` — a
field on the *content* side of the model, so it travels with the text and
survives a template change — from a **map** of words and phrases to emoji,
matched longest-phrase-first ("happy birthday" is a cake, not a smiley and a
cake). A map rather than a model, because a model would be a network call in the
middle of a pure pipeline, wrong in ways nobody could predict, and uncorrectable
by the user; a map is data a project extends with
`EmojiRules().with_mapping({...})`. The default is deliberately concrete — nouns
and unambiguous emotions, never "no" or "yes", because a cross on every "no" is
what makes a professional caption look automated. An emoji a human chose is kept.

**Database schema.** None — see the note in §1.

**Future expansion.**

* **Ripple across targeted tracks only.** Today a ripple moves every unlocked
  track, because `Track.locked` is the only flag the domain has; track targeting
  will narrow it to the armed tracks.
* **Roll and slide**, the two remaining four-point edits, in `ripple.py`.
* **A `PasteClipsCommand`** — the first `MemoryClass.HEAVY` command, and the
  reason the stack bounds heavy entries separately.
* **Journal replay**, once `services/projects/recovery.py` gains an executor:
  the command log is already a replayable list of these objects.

---

## 7. Feature: `services/render/`

**Purpose.** Own the three decisions that stand between a project and a picture:
**what one composed frame is made of** (`frames.py`), **how big to draw it**
(`preview.py`) and **what the composed frame looks like** (`composite.py`,
`kernels.py`, `pool.py`, `loop.py`). `domain/` owns what a clip, an effect, a
grade and a transition *are*; `ports/render.py` owns where composed frames *go*;
`ports/imaging.py` owns the six pixel primitives a compositor borrows. This owns
the recipe that all of them read from — which is what makes the
`media-and-rendering.md` §7.2 promise structural rather than aspirational:
**preview and export use the same code path.**

Completing a transition is part of that. A transition is a recipe for *two*
pictures, but the domain hangs it off one clip and `Timeline.resolve` only
reports clips that contain the frame — so the second half of a centred dissolve
would have one image and the first half none. `plan_frame` finds the clip on the
other side of the cut and plans both, outgoing below incoming, carrying the same
`TransitionMix`.

```
services/render/
├── frames.py     FramePlan · LayerPlan · DecodeRequest — the recipe
├── preview.py    Viewport · fit_scale · preview_size · warm_frames · PreviewPlan
│                 PreviewRenderer · resolve_asset — one frame, for a panel
├── kernels.py    the arithmetic behind the effect catalogue, and its registry
├── composite.py  composite_frame · apply_grade — the plan, turned into pixels
├── pool.py       FrameSourcePool — decode requests, served with bounded seeks
├── loop.py       render_frames · render_preview_frame — one loop, any sink
└── export.py     ExportVideoJob — that loop, as a cancellable job
```

**The full contract** — per-module responsibilities, the class diagram, the
function table, dependency injection, error handling, performance and the test
index — is the docstring of `nova_studio/services/render/__init__.py`, which is
the file a contributor reads first and the one place a change has to be kept
current. The reasoning behind the two decisions that are not obvious — why the
compositor orders its passes the way it does, and why pixel primitives are a
port at all — lives in `media-and-rendering.md` §7.12 and §7.13. What follows
here is only what a reader needs in order to know which door to open.

**Backend / frontend.** One API per intent: the preview panel calls
`plan_preview(...)` and gets the size, the scale, the letterbox offset and the
frames to warm; a single frame on screen is one `render_preview_frame(...)`; an
export is one `render_frames(project, frames, pool=…, ops=…, sink=…)`. Preview
and export differ *only* in the sink, which is the whole of the promise.

**State management.** Everything on the planning side is a frozen value: a
`FramePlan` can be cached, handed to a worker or compared in a test, and
`plan_frames` is a generator. The two stateful pieces are explicitly owned and
explicitly bounded — `FrameSourcePool` holds a few open decoders and a
byte-budgeted picture cache, and both are released by `close()`.

**API surface.** `PreviewRenderer` is what the preview panel talks to, and the
workspace owns exactly one per open project (`api/workspace.py`): it holds the
decoders, and a renderer built per request would reopen a file per frame. Three
endpoints sit on top of it in `api/routers/render.py` — `GET …/preview/frame`
(an image, with the geometry in headers), `POST …/preview/warm` (decode ahead,
in a batch, outside the request path) and `DELETE …/preview/cache` (drop the
pictures, keep the decoders). An edit invalidates through the command's own
`invalidate` set, so a pure selection change costs no re-decode.

**Events.** The preview publishes nothing, because it is a loop the UI drives
rather than a task the scheduler owns. An export *is* a job (ADR-0010) and
reports through `JobContext.report`, which the executor throttles to 20 Hz and
the bus carries to the socket — so progress, stage changes and completion arrive
as events the window subscribed to, not as answers to requests it polls.

**Testing.** `tests/services/test_render_frames.py` pins the recipe,
`test_render_preview.py` the geometry and the renderer — never upscaled, a
missing asset is a gap and not a failure, warming ten frames costs one seek —
`test_render_composite.py` the pixels at 64x48, `test_render_pool.py` the *seek
counts* — a pool is a performance component, and thirty frames of one clip
costing thirty seeks is the bug it exists to prevent — and `test_render_loop.py`
the promise itself: the same compositor, one code path, preview frame and export
frame byte-identical. `tests/api/test_render_api.py` drives both through real
HTTP against a clip encoded in a temporary directory: the frame arrives as JPEG
with `no-store`, and warming ten frames over the wire still costs one seek.
`tests/infra/test_imaging.py` checks the OpenCV adapter against a second,
plain-NumPy implementation of the port. No FFmpeg, no clock.

**Database schema.** None — see the note in §1.

**Future expansion.**

* **Blend modes and masks**, which the domain already models and the compositor
  does not yet apply: they slot into one step of one function.
* **A GPU imaging adapter**, implementing the same six methods of
  `ports/imaging.py` and bound at composition time — no renderer changes
  (ADR-0012 §2).
* **Audio**, which resolves the same timeline into a sample graph rather than a
  layer stack (`media-and-rendering.md` §7.4).

## 8. Feature: `services/captions/`

**Purpose.** Own everything that happens to a caption *after* the words exist.
`domain/captions.py` owns the document — cues, words, characters, layers,
revisions, deltas; `domain/asr.py` owns what a provider returns; `ports/asr.py`
owns how audio becomes a transcript. This owns the opinions: **which words a
viewer reads together**, **how long a cue stays up**, **where it sits**, **what a
house style does to it**, and **the order in which all of that happens**.

The order is `CaptionPipeline` — twelve named stages, `Extract → VAD →
Transcribe → Refine → Diarise → Translate → Break → Emoji → Highlight →
Position → Resolve → Bake` (ADR-0009 §3), each a pure function from one
immutable document to the next. That is the decision that makes the engine
verifiable in CI on a machine with no model weights, and the decision that lets a
plugin insert a stage without touching any other.

**Folder structure.**

```
services/captions/
├── __init__.py       the feature's contract
├── codes.py          CaptionErrorCode — NS-CAPTION-4010 and up
├── pipeline.py       CaptionPipeline · StageContext · stage_failed
├── timing.py         chars_per_second · time_to_read · held_until
├── segmentation.py   CueRules · CueSpan · cue_spans · build_cues
├── build.py          transcript → CaptionDocument
├── merge.py          regeneration: a new transcription that keeps the edits
├── positioning.py    CuePlacer · cue_box — where a cue sits, and what moves it
├── highlight.py      Highlighter — which word a viewer's eye should land on
├── emoji.py          EmojiDecorator — the picture that goes with the words
├── refine.py         Refiner · RefineRules — speech as spoken, text as read
├── commit.py         what a document asks a caption track to hold (ADR-0009 §8)
├── cues.py           CueBreaker — the Break stage
├── bake.py           AnimationBaker · AnimationSpec — a caption, as keyframes
├── styles.py         CaptionTemplate · CaptionLook · apply_look · StyleStage
├── assembly.py       default_pipeline — the twelve names, wired in order
└── runner.py         CaptionRunner — the five stages that need a machine
```

**Backend / frontend.** The frontend never breaks a cue or invents a style. It
picks a template and shows the cues that came back, with the reading rate each
one implies. `CueRules` *is* the settings panel: every field is something an
editor argues about, so every field is data — a podcast house style and a TikTok
one differ by one object, not by a second code path. The same goes for
`CaptionLook`: a look is a frozen value, which is what lets a plugin ship one
(`plugins-and-extensibility.md` §4) and a user fork one without this module
being recompiled.

**Class diagram.**

```
CueRules                              segmentation.py   the rule
├── max_lines · max_chars_per_line    two lines of 42, the broadcast default
│   └── max_chars                     lines x chars, the real budget
├── max_duration_ms · min_duration_ms
├── max_reading_rate_cps              CAPTION_MAX_CPS — the domain's ceiling
└── silence_break_ms · punctuation_break · speaker_break
cue_spans(words, rules)  → tuple[CueSpan, ...]     over any TimedWord
build_cues(transcript, rules) → tuple[CaptionSegment, ...]

TimedWord (Protocol)                  text · start_ms · end_ms · speaker
   satisfied by domain.asr.TranscriptWord and domain.captions.CaptionWord

CueBreaker                            cues.py          the stage
└── apply(document, ctx) → Result[CaptionDocument]

CaptionPipeline                       pipeline.py      the order
├── stages: tuple[tuple[str, object], ...]
├── disabled: frozenset[str]
└── inserted(...) · enabled(...) · disabled_stage(...) · without(...)
StageContext                          frame · safe area · protected · language

CaptionLook                           styles.py        the presets
├── template · anchor · x · y         where it sits, in the safe area
├── max_lines · max_chars_per_line    → rules()
├── text_case · word_animation · highlight_active_word
├── backdrop · font_* · show_speaker_names
├── rules() · position() · overrides() · text_of()
└── LOOKS: netflix · tiktok · podcast · gaming · plain
apply_look(cues, look) → tuple[CaptionSegment, ...]
```

Two things are deliberately *not* in `StageContext`: **text metrics** (how many
characters fit a line, how fast a cue may be read) are a house style and belong
to `CueRules`, and **measuring a string** needs a font and a shaper, which is a
port this feature does not have yet — the layout stages work in lines and
fractions, and the renderer supplies real extents when it draws.

**State management.** Every module here is a pure function over frozen values. A
`CueRules` can be shipped in a project file, a plugin manifest or a preset; a
`CaptionPipeline` can be handed to a worker, because nothing in it holds a
document, a decoder or a clock.

**Functions.**

| Call | Answers |
| --- | --- |
| `document_from_transcript(t, …)` | "what cues does this transcript say, as a document" |
| `build_cues(transcript, rules)` | "which words go together, and when" |
| `cue_spans(words, rules)` | the same, over words of any kind — the reusable core |
| `CueBreaker().apply(doc, ctx)` | "re-break this document's cues" |
| `CuePlacer().apply(doc, ctx)` | "put these cues where they do not clash" |
| `cue_box(cue, ctx)` | "which pixels does this cue cover" |
| `CaptionPipeline.run(doc, ctx)` | "run every enabled stage, then check the result" |
| `look_for(template)` / `apply_look(cues, look)` | "what does this house style mean / these cues, wearing it" |
| `regenerate(doc, transcript)` | "run the model again, and keep my corrections" |
| `apply_edit(doc, delta)` | "make this edit now, and file it for next time" |
| `held_until(…)` / `time_to_read(…)` / `chars_per_second(…)` | the timing arithmetic |

**Events.** None yet. A transcription is a `Job` (ADR-0010) and reports `job.*`;
the stages themselves publish nothing, because they are values a caller runs
rather than tasks a scheduler owns.

**Error handling.** Two bands, split at the seam ADR-0009 §1 draws.
`NS-CAPTION-4001`–`4006` come from `ports/asr.py` and describe *speech
recognition* — unreadable audio, missing weights, a transcript whose timings
cannot be trusted; `document_from_transcript` returns those rather than build a
document out of something unsound. `CaptionErrorCode` (`4010`+) describes
*caption authoring*:

| Code | Meaning | Retryable |
| --- | --- | --- |
| `NS-CAPTION-4010` | A stage could not finish; the name is in `details["stage"]`. | No — a stage is pure. |
| `NS-CAPTION-4011` | An object registered as a stage has no `apply` (a plugin bug). | No — fix the plugin. |
| `NS-CAPTION-4012` | The finished document cannot be rendered; the message names the cue. | No — edit the cue. |
| `NS-CAPTION-4013` | A caption template does not describe a style. | No — fix the template. |
| `NS-CAPTION-4014` | An animation mode the baker does not know. | No — a newer template. |
| `NS-CAPTION-4015` | A re-transcription cannot be merged without dropping human edits. | **Yes** — review the conflicts. |
| `NS-CAPTION-4016` | The document could not be reconciled onto the timeline. | **Yes** — unlock the track. |

Caller bugs — a duplicate stage name, a rule with no characters a line — raise
`NovaInvariantError`, because they cannot be fixed by retrying.

`NS-CAPTION-4012` deserves a note: it is what stops the engine shipping captions
nobody can read. Speech faster than the reading rate cannot be fixed by
breaking, so the pipeline refuses the document and names the cue rather than
quietly producing three-hundred-millisecond flashes.

**Caching.** Cues are derived data and are recomputed on every
re-transcription — cheaply, because the builder is a single pass over words. What
survives is *human* work: ADR-0009 §7 files every manual correction under an
`alignment_key` (normalised text plus a bucketed start time), so a
re-transcription that moves a cue 300 ms re-attaches the correction instead of
orphaning it.

**Performance.** Placement is O(cues x cues on screen at once), which in practice
is O(cues): overlapping cues are invalid, so the only boxes a cue has to dodge
are the protected regions and the other layers showing at that moment. One pass
over the words, O(n) in the transcript, with a grapheme
count per candidate cue — graphemes rather than code points, because an emoji, an
accent and a Bengali conjunct are all one character to a reader. Character
timings come from the domain's weighted proportional split, which is why karaoke
is available on every provider and not only on those that ship character timings.
A re-break hands back the *same word objects* it was given, so nothing is
re-derived and nothing is lost.

**Testing.** `tests/services/test_captions_segmentation.py` pins the breaker: the
character, duration and reading-rate caps, silence, punctuation and speaker
breaks, the minimum on-screen time that never overlaps the next cue, derived
timings for a provider that gave none, and that no word is ever dropped — a
viewer is reading this text, and losing half a sentence to a tidy-looking break
is worse than a long line. `tests/services/test_captions_break.py` pins the same
rule *as a stage*: a locked cue untouched, word objects carried rather than
rebuilt, layer, position and style inherited, and a document that still
validates. `test_captions_pipeline.py` pins ordering, skipping and attribution;
`test_captions_build.py` pins the transcript seam; `test_captions_styles.py`
pins the presets and the one real trap in applying them — that changing a cue's
case rebuilds its words, because a word's characters must join to make the word.
No model, no audio, no clock: that is the point of ADR-0009 §3.

**The reconciler (ADR-0009 §8).** A caption document is the authoring source of
truth, and it is not the timeline — but captions have to be *on* the timeline to
be trimmed, moved and exported with the picture. Two modules keep the two in
step, and neither imports the other:

```
services/captions/commit.py       document + frame rate → the clips it implies
services/timeline/sync.py         SyncReport · TrackSync · sync_tracks → applies
                                  several of them as one transaction
services/timeline/commands.py     ReplaceTrackClipsCommand → applies one
        └── the application layer is the only place that knows about both
            (ADR-0002 rule 4: a feature may not import a sibling feature)
```

Three modules, and the handshake between them is a plain value. `commit.py`
answers *what* a document asks a track to hold; `sync.py` answers *how* the
timeline is made to hold it, and its input — a `TrackSync` of a track id and some
clips — names nothing about captions, which is why neither side imports the
other. A caption layer, a chapter list and a beat grid all reconcile through the
same door.

One cue is one `Clip` of `ClipKind.CAPTION`, with no asset: its content is the
document, which is why the kind counts as generated in the domain. A clip's id is
**derived** from where the cue is, not minted per commit — so committing an
unchanged document produces identical clips, `ReplaceTrackClipsCommand` reports
that nothing changed, and a re-transcription of one cue replaces one clip instead
of rebuilding the track. Applying a commit is one command, therefore one undo
entry, therefore one transaction: Ctrl+Z after a forty-cue commit does not step
through the track rebuilding itself. A locked track is never rewritten, and a
commit of nothing creates no track at all.

`sync_tracks(editor, tracks)` is that transaction for several tracks at once: a
project with a primary caption layer and two translations is three tracks, and
three separate commits would mean Ctrl+Z steps through the rebuild one language
at a time — while a failure after the first would leave a timeline that is
neither the old captions nor the new ones. One `CompositeCommand` gives both
properties at once: all-or-nothing on failure, one undo entry on success. Two
details earn their keep. The report is taken **before** the edit, because asked
afterwards it could only ever answer "nothing changed" — true, useless, and
hiding a re-render. And a command that was *refused* records `created = False`,
so its undo cannot delete the track it never made: a composite rolls back by
asking the failed child to undo itself, and a locked-track refusal that undid
"the track I created" would delete the very track it was refused access to.

**Refine, in one paragraph.** `Refiner` takes fillers ("um", "uh", "er"), false
starts ("we're going to we're going to") and stutters ("I I I") out of a
document — fillers first, so an "um" inside a false start does not hide it — and
then tidies what is left: collapsed whitespace, no space before punctuation, a
capital at the start of each sentence. It never changes a word it keeps, never
re-times a segment, never raises a confidence, and never touches a locked line.
Two rules keep it from doing damage: a word repeated **twice** is kept ("very
very" is emphasis, not a stutter), and the filler sets are deliberately small —
a missing entry costs a filler that survives, which a human deletes in a second,
while a wrong entry deletes a real word, which a human may never notice. A
stutter's surviving word keeps its start and stretches to the end of the run, so
karaoke highlight sweeps across it instead of leaving a hole.

**Highlight, in one paragraph.** `Highlighter` sets `CaptionWord.highlight` — the
flag the templates and the animation baker consume — from five signals, each
switchable: **numbers** ("47", "3.5", "30%"), the **unit** beside them ("5
minutes"), words the speaker **held** (far longer than their own median word,
which is the only signal here that hears the performance rather than reading
it), a **name** the first time it is said, and a **term** said three or more
times across the piece. Candidates are *scored*, not fired in order, and the
best two win: a cue with six highlighted words is a cue with none. A highlight a
human set is never unset and never spends the cap, and a filler is never the
word of the line even with `Refine` switched off.

**Emoji, in one paragraph.** `EmojiDecorator` sets `CaptionSegment.emoji` — a
field on the *content* side of the model, so it travels with the text and
survives a template change — from a **map** of words and phrases to emoji,
matched longest-phrase-first ("happy birthday" is a cake, not a smiley and a
cake). A map rather than a model, because a model would be a network call in the
middle of a pure pipeline, wrong in ways nobody could predict, and uncorrectable
by the user; a map is data a project extends with
`EmojiRules().with_mapping({...})`. The default is deliberately concrete — nouns
and unambiguous emotions, never "no" or "yes", because a cross on every "no" is
what makes a professional caption look automated. An emoji a human chose is kept.

**Bake, in one paragraph.** `bake.py` is the last stage and the only one whose
product is not a document. `AnimationBaker().bake(document, timebase=…)` returns
`BakedCaptions`: one `BakedCue` per cue, each holding `BakedPiece`s — a word, or
a letter when the spec asks — whose parameters are the very `Animatable` objects
`domain/animation.py` defines. That is the whole reason preview and export cannot
drift apart (ADR-0009 §6): both evaluate the same keyframes, and because they are
the editor's own, the Properties panel can show them and an editor can drag them
— a bounce is three keyframes, not a curve buried in a caption shader. Modes are
`AnimationSpec` values in one table, so *TikTok* and *Netflix* are rows rather
than branches, and a mode a newer build named and this one has never heard of is
`NS-CAPTION-4014` rather than a silent fall-back to "none" that would export
something the user never saw. The module draws nothing: where a word sits is
`Position`'s business, what it looks like is the template's, and `fill` — the
0 → 1 a karaoke word tracks — is a number the renderer decides the colour of.

**The assembly, in one paragraph.** `assembly.py` is where the sentence in
ADR-0009 §3 becomes a value: `default_pipeline()` registers the stages in order,
and `STAGE_ORDER` names all twelve in one place so a plugin that asks "what comes
before me" gets a true answer. Only seven are registered, and that is a decision,
not an omission: `extract`, `vad`, `transcribe`, `diarise` and `translate` need
audio, a model or the network, and a `StageContext` carries frame geometry and a
language and deliberately nothing else — so those five are the body of the
runner, which holds the ports. `resolve` *is* registered, carrying the same
placer as `position` and switched off, because `Position` and `Resolve` are one
pass (`positioning.py`) and the slot exists so a plugin can insert between them.
`style` sits between `refine` and `break` when a look is given: after refine, so
the look has the last word on the text, and before break, so the breaker uses the
look's own line budget — a TikTok look breaks shorter than a broadcast one, and
that must be the same decision the template made.

**The runner, in one paragraph.** `runner.py` is the seam where ADR-0009 meets
the machine. `assembly.py` registers the seven stages that are pure; the other
five — `extract`, `vad`, `transcribe`, `diarise`, `translate` — need audio, a
model or the network, and a `StageContext` carries frame geometry and a language
and nothing else, so they are the body of `CaptionRunner`, whose constructor
takes the ports. That is what keeps the decisive consequence of the ADR true: a
test hands in fakes and gets a real run, with no model weights anywhere. Two
rules live here because here is the only place they can. **Audio reaches a
provider as 16 kHz mono float32, always** — one rule, in one method, instead of
one each adapter has to remember. And **silence trimming is undone**: the VAD
cuts the room tone, the provider numbers its words against what is left, and
`_retimed` puts every one of those numbers back through the table `_trimmed`
kept of where each piece came from. A transcript that comes back two seconds
early is the bug that table exists to prevent.

**Database schema.** None — see the note in §1.

**Future expansion.**

* **The reconciler's call site.** A run finishes with a document and its
  keyframes; `commit.py` turns it into clips and `sync_tracks` puts them on the
  timeline, so the wiring is two calls the application layer makes. What is not
  wired yet is the run reporting itself as a `Job`.
* **`services/ai/` feeding `protected`** the face boxes that make it more than a
  lower third.
* **The reconciler's window into the renderer**: a caption clip names a cue by
  address (`"<track>.<layer>.<index>"`), so the renderer resolves it against the
  document rather than carrying a copy of the text and its styling that would
  silently go stale.
* **Translation layers**, which are a second `CaptionLayer` of the same document,
  not a second document.
* **Import/export** of SRT, VTT and JSON, in `services/export/`.

## 9. Feature: `services/export/`

*The fourteen headings this feature is documented under live in its own
`__init__.py`, like every other feature here. What follows is the one thing a
docstring cannot show: where this feature sits next to the others.*

```
services/export/
├── __init__.py    the feature's contract
├── codes.py       ExportErrorCode — NS-EXPORT-6001 and up
├── layers.py      layer_cues — which cues a file is written from
├── parse.py       what SubRip and WebVTT share when you read them
├── srt.py         to_srt · from_srt · srt_timestamp — SubRip
├── vtt.py         to_vtt · from_vtt · vtt_timestamp — WebVTT
└── transcript.py  to_transcript_json · from_transcript_json — the whole thing
```

**What it is.** Both ends of the same door: a caption document becomes the bytes
somebody else's software reads, and a file somebody else wrote becomes a
`Transcript`. It owns no encoder, no muxer and no queue — those are
`services/render/` and the job subsystem.

**The rule.** An export is a pure function from a document to text, and an
import is a pure function back. No I/O: reading and writing bytes is a caller's
job (ADR-0002), so a conversion is testable with no disk, runnable twice, and
incapable of half-writing a file when it fails.

**A `Transcript` in the middle.** An imported file is read *as a transcript* —
the shape every provider returns (ADR-0009 §1) — so it goes through the same
pipeline as a recognition and a project cannot tell the two apart. It is also
what `ExternalTranscriptProvider` will hand the runner.

**The second rule.** A format gets what it can carry, and no pretending. SubRip
has no styling, so an SRT export is text and timings and nothing else; inventing
italics for it produces a file that renders differently in every player that
reads it. WebVTT knows about alignment and speakers, so a VTT export writes
them. Neither guesses about the other.

**Which layer.** A document holds every layer a project has and a sidecar file
holds exactly one, so `layer_cues` is the only place that question is answered —
and the place three things are refused rather than written: a layer that is not
there, a layer with nothing in it, and cues a player will mishandle (overlap, a
cue too short to read). The layer is validated **on its own**, as a one-layer
document, which is what lets a translation sit on top of the line it translates
and still be exported.

**Reading is tolerant where tolerance costs nothing and strict where it
matters.** A timestamp may be `HH:MM:SS,mmm`, `MM:SS.mmm` or use a full stop
where SubRip wants a comma, because files in the wild do all three — and which
part is which is decided by counting colons, since `02:03.5` is two minutes and
three and a half seconds, not two hours. But a cue that ends before it starts,
or one that overlaps the one before it, is refused with its number and its line
rather than trimmed to fit: silently moving a cue is the corruption ADR-0009 §4
exists to prevent. Markup (`<i>`, `<c.blue>`, `{\an8}`) is dropped; a `<v Ada>`
voice tag is kept, because it is meaning and not markup.

**Still to come.** SSA/ASS, which is the only sidecar with real styling; TTML
for broadcast delivery; a plain-text reader, for a script with no timings at
all — the one import that has to invent them; and burned-in captions, which is
not a sidecar at all but a render stage reading the same keyframes `bake.py`
produced.

---

## 10. Conventions a new feature must follow

1. **A package, not a module**, once it holds more than one concern.
2. **`Result[T]` across the boundary**, `NovaInvariantError` only for bugs.
3. **Frozen values in, frozen values out**, so a snapshot is a safe thing to
   hand to a worker.
4. **No I/O**, no clock, no `random` — those arrive as ports
   (`ports/clock.py`, `ports/ident.py`).
5. **A feature docstring with the fourteen headings**, written before the code
   that makes it true.
6. **Tests under `tests/services/`** with `pytestmark = pytest.mark.unit`, one
   behaviour per test, no shared mutable fixtures.
