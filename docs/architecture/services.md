# The service layer (L3)

**Status:** Living document · **Owner:** Architecture Group · **Last reviewed:** 2026-11-02

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
├── media/        ingest, probing, thumbnails, proxy generation
├── timeline/     edit operations as commands, undo scopes, ripple logic
├── render/       the frame pipeline: decode → graph → composite → encode
├── captions/     the caption engine — three-pass ASR, alignment, styling
├── effects/      the effect catalogue and the graph it builds   ← built
├── export/       presets, queueing, packaging
├── ai/           AI Studio orchestration on top of captions and effects
├── plugins/      manifest validation, permission audit, lifecycle
└── jobs/         scheduler, admission control, circuit breaker
```

Each feature package carries a module docstring with the same fourteen headings
used in §3–§7 — purpose, structure, backend/frontend architecture, state,
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

* **Migration.** `format_version` is compared but not yet migrated; the ordered
  chain of `vN → vN+1` functions belongs here, applied inside `open()`.
* **Save-as and template export**, which reuse `_documents` verbatim.
* **Autosave to a sidecar** (ADR-0015 §6) once `infra/persistence` exists, so a
  checkpoint never touches the user's file until they save.

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
```

**State management.** `MediaIngestor` holds an injected prober and id source and
nothing else; every import is independent and repeatable. `ProxyPolicy`,
`ProxyPlan` and the index tuple are frozen values, safe to hand to a render
worker or to cache as part of a job payload. No cache, no handles, no threads:
the only long-running work this feature *causes* is a proxy transcode, and that
goes to the scheduler as a `NORMAL` job (ADR-0010) — never a thread spawned
here.

**Functions and APIs.**

| Call | Answers |
| --- | --- |
| `ingest(paths, existing)` | "what did we get, what failed, what was already here" |
| `decide(scale, available)` | "which copy do I decode at this preview scale" |
| `plan(info)` | "is a proxy worth building, and how big" |
| `thumbnail_indices(...)` | "which frames does a strip ask for" |

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
keyframe snapping and the deduplication. No FFmpeg, no filesystem, no numpy
beyond what the domain already carries.

**Future expansion.**

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
    └── RippleDeleteCommand      closes the gap · MemoryClass.MEDIUM

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
alone. No FFmpeg, no filesystem, no clock that moves unless told to.

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

**Purpose.** Own the two decisions that stand between a project and a picture:
**what one composed frame is made of** (`frames.py`) and **how big to draw it**
(`preview.py`). `domain/` owns what a clip, an effect, a grade and a transition
*are*; `ports/render.py` owns where composed frames *go*. This owns the recipe
that both read from — which is what makes the `media-and-rendering.md` §7.2
promise structural rather than aspirational: **preview and export use the same
code path.**

Completing a transition is part of that. A transition is a recipe for *two*
pictures, but the domain hangs it off one clip and `Timeline.resolve` only
reports clips that contain the frame — so the second half of a centred dissolve
would have one image and the first half none. `plan_frame` finds the clip on the
other side of the cut and plans both, outgoing below incoming, carrying the same
`TransitionMix`.

**Backend / frontend.** One API per intent. The preview panel calls
`plan_preview(...)` and gets the size, the scale, the letterbox offset and the
frames to warm. The renderer calls `plan_frame(project, frame, sources=...)`
once per frame. Neither looks inside a `Project` to find out what a clip is
wearing, and neither guesses a size.

**Class diagram.**

```
FramePlan                             frames.py
├── frame · size                      the composition, in composition pixels
├── layers: tuple[LayerPlan, ...]     bottom first
│   └── LayerPlan
│       ├── clip · track · source_frame
│       ├── source        "original" | "proxy" | "thumbnail" (carried, not chosen)
│       ├── transform     from the project, every clip has one
│       ├── effects       clip chain, then track chain (empty ones dropped)
│       ├── grades        clip grade, then track grade (neutral ones dropped)
│       └── transition · transition_role   INCOMING | OUTGOING
├── output_effects · output_grade     applied once, after compositing
└── decodes() → tuple[DecodeRequest]  deduplicated, generated clips skipped

PreviewPlan                           preview.py
├── frame · size · scale · offset · warm
Viewport · fit_scale · preview_size · warm_frames · plan_preview
```

**State management.** Everything is a frozen value. A `FramePlan` can be cached,
handed to a worker process or compared in a test; none of it carries a decoder,
a clock or a handle. `plan_frames` is a generator, because an export plans a
hundred thousand frames and holds none of them.

**Functions.**

| Call | Answers |
| --- | --- |
| `plan_frame(project, frame, sources)` | "what is this frame made of" |
| `plan_frames(project, frames, sources)` | the same, lazily, over a range |
| `FramePlan.decodes()` | "which pictures do I need, deduplicated" |
| `fit_scale(w, h, viewport)` | "how big can this be drawn" |
| `preview_size(w, h, viewport, zoom)` | "what size do I composite at" |
| `warm_frames(playhead, count, last_frame)` | "what should already be decoded" |
| `plan_preview(...)` | all of the above, for one frame |

**Events.** None yet. A render is a `Job` (ADR-0010) and reports `job.*`; the
preview publishes nothing, because it is a loop the UI drives rather than a task
the scheduler owns.

**Error handling.** Both planners are total over *frames*: a frame past the end
of a timeline plans as empty, because a render runs past the end by design. They
raise `NovaInvariantError` for a nonsensical argument — a negative frame, a
zero-sized viewport, a non-positive zoom — because those are bugs in the caller,
not states of a project. Encoding failures are `ports/render.py`'s codes
(`NS-RENDER-4001` unwritable, `NS-MEDIA-4002` no encoder, `-4003` encode failed,
`-4004` unsupported spec, `-4005` cancelled), never this feature's.

**Caching.** The plan *is* the cache design. `DecodeRequest.key` is
`(asset_id, source_frame, source)`, so a preview cache keys on exactly what it
decoded rather than on a frame number that means something different after an
edit; `warm_frames` is forward-only because work behind the playhead is the one
kind certain to be wasted.

**Performance.** `plan_frame` is O(layers at this frame) — one `resolve`, a
transition scan, a few tuple lookups — and pure, so a renderer can plan a frame
while the previous one composites. `decodes()` deduplicates, so a split clip
left in place costs one read. Neutral grades and empty chains are dropped at
plan time rather than tested per frame.

**Testing.** `tests/services/test_render_frames.py` pins the recipe: layer order,
per-layer effect and grade ordering, generated clips asking for no decode,
duplicate reads collapsing, empty frames, and transitions planned as pairs —
including the centred dissolve's first half, which the domain alone does not
surface. `tests/services/test_render_preview.py` pins the geometry: contain not
cover, the native cap, even dimensions, centred bars, cropped-when-zoomed, and
forward-only warm-up. No FFmpeg, no numpy beyond what the domain carries, no
clock.

**Database schema.** None — see the note in §1.

**Future expansion.**

* **Cost estimation.** Whether a frame fits a real-time budget needs the effect
  *catalogue*, which belongs to `services/effects` — a feature this one may not
  import. It belongs in `services/shared` when that lands, and it is what a
  draft-quality preview mode will read.
* **The compositor itself**, once `infra/render` exists: it consumes these plans
  and nothing else.
* **Audio**, which resolves the same timeline into a sample graph rather than a
  layer stack (`media-and-rendering.md` §7.4).

## 8. Conventions a new feature must follow

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
