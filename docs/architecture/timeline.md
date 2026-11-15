# The timeline

**Status:** Normative for stage 7 · **Owner:** Architecture Group · **Last reviewed:** 2026-11-15

The timeline is the pane every other pane is arranged around: the preview watches the frame
the playhead is on, the inspector describes what is selected here, the export renders what
this says. This document is the specification of **the edit and the window's view of it** —
what a clip is, what a command may do to one, and how a drag becomes an edit.

Companion documents: [`ARCHITECTURE.md`](ARCHITECTURE.md) §3 (rings) and ADR-0008 (the
command pattern), [`api.md`](api.md) §9 (the timeline router), [`services.md`](services.md)
(the edit commands), [`frontend.md`](frontend.md) §10 (the window's layers), and
[`project-file-format.md`](project-file-format.md) (what an edit survives in).

Normative words: **must**, **must not**, **may**. A component that edits a timeline any other
way than through a command is wrong, even when it looks right.

---

## 1. What the timeline has to survive

| Requirement | Consequence here |
| --- | --- |
| A drag must feel immediate | A drag is **view state until it is dropped** (§10): the clip is drawn where the pointer is before the service has agreed. |
| A drag must be one undo | One command per gesture, carrying a `gesture` token (§9.2). |
| A hand is not a mouse | Three pixels of tremble is a click, not an edit (§10). |
| Two windows, one project | Nothing about the *view* is persisted or shared; only the edit is (§2). |
| A refused edit must cost nothing | The service refuses with a sentence; the window shows it and changes nothing (§12). |
| Ten years of edits | The set of commands is closed, named and journalled; the window can only ask for what is on the list (§9). |
| A feature-length edit | Only the clips on screen are rendered (§14.2); one transform per axis moves them (§14.1). |
| A user who cannot see the screen | Every clip carries its name, its in and out points and its duration as an accessible name (§6.4). |

Non-goals: the timeline does not decode, composite or render (§7 of
[`media-and-rendering.md`](media-and-rendering.md)), does not own the project file (§
[`project-file-format.md`](project-file-format.md)), and does not decide what a frame looks
like. It decides **what is where, and for how long**.

---

## 2. Where state lives

Four places, and the boundaries between them are the design:

| State | Where | Lifetime | Shared? |
| --- | --- | --- | --- |
| **The edit** (tracks, clips, rates) | the service; read through `GET /timeline` | the project | Yes — every window |
| **The selection** (which clips) | the timeline store | the project, in this window | Yes — three panes act on it |
| **The viewport** (zoom, scroll) | `useTimelineViewport`, in the pane | the pane | **No** — deliberately |
| **The drag in progress** | `useTimelineGestures`, in the pane | one gesture | **No** — it is one pointer |

Two consequences worth stating, because both are violations waiting to happen:

* **The viewport is not persisted.** Where the user has scrolled to is not part of the edit.
  A timeline that remembered its zoom and wrote it to the project file would open on the
  wrong part of somebody else's screen.
* **The drag is not an edit.** A clip that appears to have moved has not moved. If the
  service refuses the drop, the clip returns to where it was — because that is the only
  place it ever was.

---

## 3. Folder structure

```
nova_studio/
  domain/timeline.py            the edit itself: Timeline, Track, Clip, invariants
  services/timeline/
    commands.py                 the seven commands, each reversible
    editor.py                   one editor: execute, undo, redo, state
    ripple.py                   the geometry: lift, ripple, split, slip
    store.py                    which timeline a command is editing
    sync.py                     how a track's clips are reconciled
  api/
    routers/timeline.py         GET the edit, POST a command, POST undo, POST redo
    schemas/timeline.py         the DTOs, including the command union
    mappers/timeline.py         DTO ⇄ domain command

frontend/src/features/editor/timeline/
  layout.ts                     frames ⇄ pixels, and what a pixel landed on
  snapping.ts                   where a drag means to land
  ruler.ts                      which frames get a tick
  useTimelineViewport.ts         the zoom and the scroll, as window state
  useTimelineGestures.ts         the drag state machine
  TimelinePanel.tsx             the pane: the ruler, the lanes, the gutter, the status
  TimelineClip.tsx              one clip: the block a user drags
  TimelineRuler.tsx             the ticks, the labels, and the scrub target
  TimelineScrollbar.tsx         where the viewport is, and how to move it
```

The split is not decorative. `layout.ts`, `snapping.ts` and `ruler.ts` are **pure** — no
React, no store, no DOM — which is why 100 of this module's tests run in node in under a
second (§15), and why a geometry bug is a failing unit test rather than a screenshot.

---

## 4. The domain: what an edit is

`domain/timeline.py` is the truth; everything above it is a view. Three facts from it
shape the whole pane:

* **A clip is a range on a track plus a range in a source.** `start_frame`/
  `duration_frames` are where it sits and how long it plays; `in_frame`/`out_frame` are
  which part of the source it shows. Moving a clip moves the first pair; **trimming moves
  the second**, which is why a trim and a move are different commands and not two flavours
  of one.
* **A clip is at least `MIN_CLIP_FRAMES` (1) long.** A clip of zero frames is not a clip,
  and a split that produced one would be a split that invented an object the renderer
  cannot draw.
* **`end_frame` is exclusive.** Two clips that abut share a boundary, and the boundary is
  `end_frame` — not `end_frame - 1`. Every snap target, every tick and every label is
  written against that.

Invariants a command may not break (`validate_timeline`): track indices follow display
order, clips on a track are in position order, and two clips may not overlap unless a
transition covers every frame of the overlap. The guard runs **after** every command, and a
command whose edit breaks it is rolled back and refused as `NS-COMMAND-4104` — before the
history records anything, so a refused edit never consumes the user's redo future.

---

### 4.1 The domain, drawn

```
Timeline                                  domain/timeline.py — frozen
├── timebase: Timebase                    the rate, as a fraction { num, den }
└── tracks: tuple[Track, ...]             display order == index order
    │
    Track
    ├── track_id · name · kind · index
    ├── muted · locked · hidden
    ├── clips: tuple[Clip, ...]           position order
    └── transitions: tuple[Transition, ...]
        │
        Clip
        ├── clip_id · asset_id · kind · name
        ├── start_frame · duration_frames     where it sits, how long it plays
        ├── in_frame · out_frame              which part of the source it shows
        ├── speed · reverse · enabled
        └── end_frame (derived, exclusive) · source_frames (derived)

validate_timeline(timeline) -> str        "" or the first thing that is wrong

TimelineStore          services/timeline/store.py    the one mutable object
└── current() · replace(next) -> previous · reset(timeline)

TimelineEditor         services/timeline/editor.py   the one door
├── store · history: CommandHistory · project_id · bus · clock
├── execute(command) · undo() · redo() · state() · recent()
└── can_undo · can_redo · undo_label · redo_label · depth

TimelineCommand        services/timeline/commands.py
├── execute(ctx)   store lookup -> _apply -> guard -> restore on refusal
├── _apply(store, timeline)   the edit itself
├── undo(ctx)                 from the captured delta
└── validate(ctx)             named preconditions
    ├── MoveClipCommand           to_start_frame / to_track_id · coalescible
    ├── TrimClipCommand           edge: start | end · coalescible by (clip, edge, gesture)
    ├── SlipClipCommand           delta_frames · accumulates · coalescible
    ├── SplitClipCommand          at_frame (+ new_clip_id)
    ├── LiftClipCommand           out, gap left behind
    ├── RippleDeleteCommand       out, gap closed · MemoryClass.MEDIUM
    └── ReplaceTrackClipsCommand  "hold exactly this" · create: true when absent

ripple.py (pure)   lift_clip · reinsert_clip · ripple_delete · undo_ripple
                   split_clip · slip_clip · source_frames_for
```

### 4.2 Where an edit is stored — and why it is not a table

**The timeline has no schema, because it is not in the database.** It is the
authoritative graph inside `timeline/document.json` in the `.nova` container
([`project-file-format.md`](project-file-format.md)); the two SQLite databases hold the
things that are not the edit — `nova.db` the settings, the recent-files registry and the
job history, `cache.sqlite3` the index of derived media. A clip, a track and a transition
are rows in no table, and no query joins them.

Three reasons, and the third is the one that decides it:

1. **A table would need a migration for every attribute a clip grows.** Ten years of
   caption styling, effects and per-clip grades is ten years of `ALTER TABLE`, against a
   document that simply gains a key older builds ignore.
2. **An edit would be a transaction over N rows** instead of one document write — and the
   document is already the unit the user saves, so the two would have to be kept in step
   forever.
3. **The journal replays commands, not rows.** What a crash-recovery replay needs is a
   document to apply a command to; a row-oriented store would need a second translation
   layer, and the second layer is the one that is wrong after the first schema change.

What *is* indexed, and where a reader should look for it: nothing about clips. Renders of
a timeline are rows in `jobs` (`database-schema.md` §5.4); media a timeline depends on is
rows in `cache_index` (§5.5); the edits since the last checkpoint are lines in
`autosave/<project>/cmds-*.ndjson`. The timeline itself is the document.

---

## 5. Backend architecture

```
api/routers/timeline.py      L4   HTTP: the read, one command, undo, redo
        │  CommandRequest (a discriminated union, keyed by `type`)
        ▼
api/workspace.py             L4   one project: timeline + settings + autosave
        │
        ▼
services/timeline/editor.py  L3   TimelineEditor.execute / undo / redo / state
        │
        ▼
services/timeline/commands.py L3  seven commands, each a captured delta
        │
        ▼
domain/timeline.py           L2   Timeline, Track, Clip, validate_timeline
```

**The frontend posts commands, not timelines.** A client that could `PUT` a whole edit would
bypass validation, undo, the journal and the preview cache in one request — and every one of
those is a guarantee the rest of the system is built on. What crosses the wire is *what the
user did*, in the domain's own vocabulary.

**Every answer carries the history.** After an edit the window knows `can_undo`, `can_redo`,
the labels and the depths, because the alternative — a second request to ask the Edit menu
what to show — is a race a fast typist can lose.

**Undo and redo are edits.** They are journalled like any other change, because a
crash-recovery replay that skipped them would hand the user back work they threw away.

---

### 5.1 Events

Three topics, published by `CommandHistory` on the injected `EventBus` — **never by a
command itself** (ADR-0008 rule 6), because a command that called the cache would be a
command that could not be replayed without a cache.

| Topic | Carries | Who is listening |
| --- | --- | --- |
| `command.executed` | the command's name, `affected` ids, `invalidate` (`timeline`, `preview`, `thumbnail`), `rerender` | the preview cache, the thumbnail cache, autosave's dirty-marking, the WebSocket broadcast, and the window's store, which refetches |
| `command.reverted` | the same, for an undo | the same |
| `command.failed` | the code and the sentence | the log, and the status bar's crash accounting |

Two rules about what a subscriber may assume:

* **An event is a notification, not a payload.** It says *something changed*; it does not
  say what the timeline now is. The window asks again, because a store that treated a
  dropped event as data would be wrong the first time one is lost.
* **The invalidation set is data on the outcome, not a decision by a subscriber.**
  `invalidate` is which namespaces the *service* has dropped; nobody in the window gets to
  guess.

The window's own two codes are not events at all — `NS-TIMELINE-0001` (no project open)
and `NS-TIMELINE-0002` (an answer for a project the window has left) never reach the bus,
because nothing outside the store cares.

---

## 6. Frontend architecture

### 6.1 The map

```
Workspace (dock)
  └── TimelinePanel ────────────────────────────────────────────┐
        ├── useTimelineViewport  → layout (zoom, scroll, size)   │ the pane's own
        ├── useTimelineGestures  → drag, snapFrame               │ window state
        ├── useTransportContext  → frame, seek  (the window's)   │
        └── stores/timeline      → tracks, selection, commands   │ shared
              ├── TimelineRuler      (pure ticks → positioned)   │
              ├── TrackLane × n      (virtualised)               │
              │     └── ClipInLane → TimelineClip                │
              ├── TrackHead × n      (the gutter, over content)  │
              ├── Playhead, and the guide when a drag snaps       │
              └── TimelineScrollbar + the status line            │
                                                                ┘
```

### 6.2 One coordinate system

The gutter is drawn **over** the content rather than beside it, so a row is one number that
the lanes, the heads, the hit test and the drag all agree on. A pane that laid the heads out
in a second column would have two ideas of where row three is, and they would disagree the
first time somebody changed `TRACK_GAP`.

Everything is positioned in **content coordinates** — `contentX(layout, frame)` — and the
whole content is moved by one transform: `contentOffsetX(layout)` horizontally and
`-scrollTop` vertically. `frameToX` and `xToFrame` are the *measuring* half, used for a
pointer in the viewport; `contentX` is the *painting* half. Mixing them is the bug where a
timeline looks right until you scroll it, which is why a test asserts the relation between
them rather than either one alone.

### 6.3 Virtualisation

A lane renders the clips that intersect `visibleRange(layout)`, which is widened by a frame
at each end so a clip that starts one pixel off the left edge is still drawn. A
feature-length edit holds thousands of clips; a lane that laid them all out would spend its
first second doing nothing the user can see.

### 6.4 Accessibility

* A clip is a `button` with an accessible name built from its **name, its in point and its
  out point** — the three things a rectangle cannot show.
* The playhead announces its timecode; the ruler is the largest seek target on screen and is
  duplicated for a keyboard by the transport's timecode field.
* The scrollbar is a real `role="scrollbar"` with `aria-valuenow` and arrow-key handling: a
  control that looks like a scrollbar and cannot be driven from the keyboard is a control
  only some users have.
* **Known gap:** clips are not keyboard-focusable yet. Selection is driven from the command
  palette (`Select every clip`, `Split…`, `Lift…`), and roving tabindex within a lane is
  §18.

---

## 7. State management

The timeline store (`stores/timeline.ts`) holds the edit and the selection; the pane holds
the zoom, the scroll and the drag.

```ts
interface TimelineState {
  // the edit
  projectId, timeline, history, dirty, journalSequence, pendingCommands, status, error
  // the selection
  selectedClipIds: ReadonlySet<string>
  // the edit in flight
  gesture: string | null        one id per drag: what makes it one undo
  inFlight: number              a count, not a flag
  lastCommand: CommandOutcome | null   the service's own sentence
  refusal: ApiProblem | null           the last edit that was refused
}
```

Three decisions inside:

* **A command's answer is not a timeline.** `CommandResponse` carries the history, the
  counters and a sentence; it deliberately does not carry the edit. So a command applies
  what it was told and refetches — the Edit menu is right before the edit has finished
  arriving, and one drag does not send a screen's worth of tracks sixty times.
* **`inFlight` is a count.** Two drags in flight are two, and the second one landing must
  not undim a timeline the first is still holding.
* **`lastCommand` retires on an undo.** What an undo did is already in `history.undo_label`;
  a status bar still describing an edit that is gone is worse than an empty one.

The store never edits locally. A store that moved a clip and reconciled later would need a
merge algorithm, and a merge algorithm is where editors go to die.

---

## 8. The geometry, the snapping and the ruler

### 8.1 `layout.ts` — frames ⇄ pixels

| Function | Answers |
| --- | --- |
| `frameToX` / `xToFrame` | where a frame is in the viewport / which frame a pixel is in |
| `contentX` / `contentOffsetX` | where a frame is in the content / how far the content moves |
| `trackTop` / `rowAt` | the top of a row / which row a pixel is in (`null` in the gap) |
| `clipRect` | a clip's rectangle, never narrower than it can be hit |
| `hitTest` | `ruler` \| `gutter` \| `clip{clipId,trackIndex,edge}` \| `track` \| `empty` |
| `visibleRange` | the frames on screen, ±1 |
| `fitPxPerFrame` / `zoomStep` / `clampZoom` | the zoom ladder |
| `maxScrollFrames` / `clampScroll` / `scrollFrameIntoView` | the scroll |
| `scrollForZoom` | where the scroll must be for a zoom to hold a frame still |

Decisions that are not obvious and are each pinned by a test:

* `xToFrame` **rounds to the nearest frame**; `scrollFrames` **floors**. A click between two
  frames hits the nearer one, but the left edge of the viewport is always a whole frame.
* `hitTest` scans clips **nearest-first**, so two abutting clips resolve to the one on top.
* `EDGE_GRAB_PX` wins only on the **nearer** end when a clip is narrower than twice the grab
  width — otherwise a clip too short to have a middle could not be trimmed at all.
* `clampZoom` takes the rung **below**, so fitting always fits rather than nearly fitting.
* `fitPxPerFrame` adds 24 frames of headroom: a timeline fitted exactly to its last clip has
  nowhere to drop a new one or park the playhead.
* `ZOOM_LEVELS` is a **ladder, not a multiplier**. `1.37×` is not a thing a user can ask for
  again, and Ctrl+= would otherwise disagree with the menu.

### 8.2 `snapping.ts` — where a drag means to land

Snapping is a **window** decision: its threshold is measured in *pixels*, and the service
does not know the zoom. Eight pixels is a snap a thumb can feel at any zoom; eight *frames*
is a snap that drags clips across the screen when zoomed out and does nothing when zoomed
in. The service's job is whether the landing is allowed — a snapping module that refused an
overlap would be a second place the rule lives, and the second place is the one that is
wrong after ripple delete changes.

| Function | Answers |
| --- | --- |
| `snapThresholdFrames(pxPerFrame)` | pixels → frames, never less than one |
| `collectSnapTargets(tracks, playhead, ignoreClipId)` | every frame a drag might land on |
| `snapFrame(candidate, targets, threshold)` | the nearest target in range, ties to the earlier |
| `snapMove(candidateStart, duration, …)` | the same, for **either end** of the dragged clip |
| `clampTrim(clip, edge, wanted)` | a trim that is still legal: at least one frame |

Two rules inside, and both are the difference between snapping and fighting:

* **A clip does not snap to itself.** Every edge of the dragged clip is excluded: a clip
  whose start snapped to its own start could not be moved by less than its own length.
* **A tie goes to the earlier frame.** A drag landing exactly between two targets has to
  land somewhere, and "the one on the left" is the one a user reading left to right expects.

`snapMove` tries **both ends**: butting a clip against the one before it means its start
finds a target; butting it against the one after it means its *end* does. Snapping only the
start is an editor where half the alignments are impossible.

### 8.3 `ruler.ts` — which frames get a tick

| Function | Answers |
| --- | --- |
| `tickLadder(timebase)` | the intervals this project's rate can mean, in frames |
| `chooseTickInterval(pxPerFrame, timebase, labelPixels)` | the rung that fits, taken from that ladder |
| `minorInterval(interval)` | how one major tick subdivides — 5, 4, 2, or not at all |
| `rulerTicks(firstFrame, lastFrame, interval)` | the majors and the minors in one range; ticking frame zero, or the first frame after the range begins, and never one before it |
| `tickLabel(frame, timebase)` | the text — `1.5s`, `2m 05s`, or a bare frame number when a frame is wider than a label |

Ticks every 30 frames is a ruler that says "one second" at 30 fps and "1.001 seconds" at
29.97; ticks every 100 frames means nothing at any rate. So the ladder is built **from the
project's timebase**, in seconds and minutes, and only descends to bare frames when a second
is still wider than a label needs.

It is also **quantised**: the interval is one of a fixed set of rungs, so zooming by one
pixel cannot change every label on screen — a continuously-computed interval reads as
flicker and shows two people looking at the same edit different numbers.

Minor ticks subdivide a major one five, four or two to a part, and not at all when the
interval will not divide into whole frames: a tick at frame 1.5 is a ruler lying about where
frames are.

---

## 9. The commands

### 9.1 The seven, and what they take

| `type` | Takes | Coalesces | What it is |
| --- | --- | --- | --- |
| `move-clip` | `clip_id`, `to_start_frame`, `to_track_id?` | yes, by `gesture` | a drag across time, or onto another track |
| `trim-clip` | `clip_id`, `edge`, `to_frame` | yes, by `gesture` **and** edge | dragging one end |
| `slip-clip` | `clip_id`, `delta_frames` | yes, by `gesture` | sliding the source window |
| `split-clip` | `clip_id`, `at_frame`, `new_clip_id?` | never | the razor blade |
| `lift-clip` | `clip_id` | never | take it out, leave the gap |
| `ripple-delete` | `clip_id` | never | take it out, close the gap |
| `replace-track-clips` | `track_id`, `clips[]`, `kind?`, `create?`, `track_name?` | never | what a whole track holds |

The discriminator `type` **is** the name the journal records, so a crash-recovery replay
knows which command to rebuild without a second table of names that could drift.

`replace-track-clips` is how a clip gets onto a timeline **at all** — there is no
`insert-clip`, and there is a reason: the only honest way to describe "this track now holds
these clips" is to name them all, and an insert that named only the new one would leave the
service to guess what happened to the rest. It is also the command the caption engine will
write a whole caption track with (stage 9).

### 9.2 One gesture, one undo

A drag posts one command on release, carrying a `gesture` token minted when the press began.
Two commands sharing a token inside the coalescing window **merge into one undo entry**, so
undoing a drag returns to where the drag began rather than to the last mouse move.

The token is **random, not sequential**: two windows editing one project must not mint the
same one, or their drags would collapse into a single undo entry.

The window posts nothing while the drag is in flight. It does not need to: the drag is drawn
locally, and a timeline that posted a move per pointer event would put a hundred entries in
the history for one gesture and a hundred round trips on the wire.

---

## 10. Gestures: what a pointer does

| Where | Press | Drag | Release |
| --- | --- | --- | --- |
| the ruler | seek | keep seeking | — |
| empty lane | deselect, seek | keep seeking | — |
| a clip | select, begin a move | draw the clip where the pointer is, snapped | post **one** `move-clip` |
| a clip's end | select, begin a trim | redraw the clip from the moving end | post **one** `trim-clip` |

`CLICK_SLOP_PX` (3) is what separates a press from a drag: below it, nothing is posted and
the press was a click. A clip that moved a frame because a hand shook is the complaint
editors get most.

A press on a clip **selects immediately**, not on release: a user who grabs a clip has
already decided they are working on it, and a selection that arrived after they let go would
be too late for the Delete they press next. A press on a clip that is *already* selected
keeps the whole selection, because that press is the beginning of a drag of all of them.

The wheel over the timeline is bound by hand with `{ passive: false }`, because a wheel
there is never a request to scroll the page: **Ctrl/Cmd + wheel** zooms, anchored on the
pointer; **Shift + wheel** scrolls the rows; a plain wheel — or a trackpad's horizontal one
— moves in time.

---

## 11. API surface

| Method | Path | Answers |
| --- | --- | --- |
| `GET` | `/api/v1/projects/{id}/timeline` | the whole edit: rate, tracks, clips, history, counters |
| `POST` | `/api/v1/projects/{id}/commands` | one `CommandRequest`; answers `CommandResponse` |
| `POST` | `/api/v1/projects/{id}/undo` | `UndoResponse`, with the history as it stands |
| `POST` | `/api/v1/projects/{id}/redo` | `RedoResponse` |

Frontend calls: `client.run('getTimeline' | 'applyCommand' | 'undoCommand' | 'redoCommand')`.
The command union is generated from the routes as `ApplyCommandBody` — see §16 for why it has
a name the Python side never gives it.

The window asks again after every edit, and after every `command.*` event, because an event
is a **notification and not a payload**: the socket carries small envelopes by design, and a
store that treated them as data would be wrong whenever one is dropped.

---

## 12. Error handling

| Failure | Code | What the window does |
| --- | --- | --- |
| An edit breaks an invariant | `NS-COMMAND-4104` (409) | Shows the service's sentence in the status line; the clip returns to where it was, because it never went anywhere |
| The command could not run | `NS-COMMAND-4101` | the same sentence, in the same place |
| An undo could not be undone | `NS-COMMAND-4102` (critical) | the status line; the timeline refetches — **the service's answer is the truth after a critical failure**, not the window's guess |
| The read failed | transport/5xx | keeps the edit it drew and says so once; a dropped refresh is not an empty timeline |
| No project is open | `NS-TIMELINE-0001` (local) | the store refuses without a request at all |
| An answer arrives after the window moved on | `NS-TIMELINE-0002` (local) | dropped: the service did what it was asked; this window no longer cares |

A refusal is **the service's own sentence**, shown where the user was looking, and the edit
it refused is not in the history. A window that re-worded a refusal is a window that guessed
why.

---

## 13. Caching

The timeline store holds one copy of the edit and refetches on an edit or a `command.*`
event. There is no cache to invalidate in the window: `CommandResponse.invalidate` names the
namespaces the *service* has dropped (`timeline`, `preview`, `thumbnail`) and the preview
subscribes to them.

Two dedupe rules keep a drag from becoming a stampede:

* **One read per project at a time.** Two asks while a read is in flight join it rather than
  racing it — "last to arrive" is not "newest" — and the joined ask is then honoured with
  exactly one more request, because an ask made mid-flight may have been about an edit the
  answer does not include.
* **An answer for a project the window has left is dropped**, not applied.

---

## 14. Performance

### 14.1 Painting

One transform per axis moves the whole content (`translate(contentOffsetX, -scrollTop)`),
so a scroll costs the browser one composited layer rather than a layout pass over every clip
on screen. Clips are `memo`ised, so a scroll does not re-render them and a selection does not
re-render the lane.

### 14.2 Rendering

Only clips intersecting the visible range are rendered (§6.3). `useIsClipSelected` returns
one boolean per clip, so a pane holding two hundred clips re-renders two hundred times on a
select-all and once otherwise.

### 14.3 The wire

One command per gesture, not per pointer event (§9.2). One read per edit, joined with any
read already in flight (§13).

### 14.4 The service

Edits are O(clips on the affected tracks). The one superlinear step is the post-edit
`validate_timeline` guard, which is O(n²) per track and runs on an edit rather than per
frame. Undo deltas are a handful of integers, so a two-thousand-clip timeline costs the same
to undo as a three-clip one.

---

## 15. Testing

| Suite | Files | Tests | What it pins |
| --- | --- | --- | --- |
| `layout.test.ts` | 1 | 48 | the rounding at a boundary, the grab width, the gap between rows, both ends of the ladder, and that painting and measuring are the same frame seen two ways |
| `snapping.test.ts` | 1 | 29 | that a clip never snaps to itself, that either end may snap, that ties go to the earlier frame, that the threshold is in pixels |
| `ruler.test.ts` | 1 | 23 | that ticks follow the project's seconds, that the ladder is quantised, that ticks align to frame zero |
| `timeline.test.ts` (store) | 1 | 33 | one command per gesture, the history off the answer before the edit arrives, a refusal changing nothing, the selection, drop-on-another-project |
| `TimelinePanel.test.tsx` | 1 | 27 | one command per drag, a click is not a drag, the drawing moves before the service agrees, a refusal puts the clip back |
| backend (`tests/services`, `tests/api`, `tests/domain`) | — | existing | the geometry of every command and the router's answers |

The pure suites run in **node**; only the panel needs jsdom. Together they are 160 tests,
which is the point of keeping the geometry out of the components: a bug in `xToFrame` is a
unit test that fails in 12 ms, not a screenshot nobody looks at twice.

---

## 16. The generated contract, and a bug it had

`POST /commands` takes `Annotated[MoveClipRequest | TrimClipRequest | …, Field(discriminator="type")]`,
which FastAPI documents **inline** — a `oneOf` with a discriminator mapping — rather than as
a `$ref`. `scripts/codegen_contract.py` only recognised `$ref` bodies, so the operation was
generated as `requestBody: null`.

That is a lie in the direction that hurts: the route *requires* a body, so a typed call could
not be written at all, and the only way through it would have been an `as any` at every call
site — no contract at all, on the one endpoint every edit in the application goes through.

The generator now names a body the document did not (`applyCommand` → `ApplyCommandBody`) and
renders it as an ordinary schema. A route with **no** body still gets `null`: the fix is not
"every route takes a body". A TypeScript `|` has no discriminator, and the discriminator is
the one fact a caller needs, so it is written into the generated JSDoc instead of dropped.

---

## 17. One clock

`useTransport` starts a clock, and a clock is a **window-level** thing: there is one
playhead, and when it moves it moves for the preview, the timeline and the palette at the
same moment. Three components calling `useTransport` gave the window three clocks, and three
clocks is a bug that hides until the user presses play in a pane: each clock counts from the
frame *it* last saw playback start at, so the one that did not see it keeps writing the frame
it thinks is right, and the playhead fights itself.

So `TransportProvider` calls it **once**, inside `WorkspaceProviders`, and every pane reads
`useTransportContext()`. A pane that reads the context cannot start a second clock by
accident, and the hook throws when there is no provider rather than quietly making one.

---

## 18. Open decisions

| # | Question | Where it will be answered | Why it is not answered here |
| --- | --- | --- | --- |
| 1 | Roving tabindex inside a lane, so a clip can be selected from the keyboard | stage 7 follow-up | It needs a focus model for the whole pane (ruler, lanes, gutter) and not one for clips. |
| 2 | Marquee selection | stage 7 follow-up | A drag on empty track area seeks today. Both gestures cannot own the same press. |
| 3 | Drag-and-drop from the media bin | stage 8 | The bin needs a drag source, and the timeline needs a drop target that can name an asset. `timeline.insert` covers the capability meanwhile. |
| 4 | Multi-track ripple, and transitions between clips | stage 8 | The domain supports both; the window has no gesture for them yet. |
| 5 | A thumbnail strip inside a clip | stage 8 | Needs the thumbnail cache named in `invalidate`, which the service already sends. |
| 6 | Persisting the viewport per user, not per project | a settings stage | It is window state (§2); if it is ever persisted it must not go in the project file. |
