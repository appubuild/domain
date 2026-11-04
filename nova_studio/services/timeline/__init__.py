"""L3 feature — timeline: every edit, as a reversible command.

**Purpose.** Own the six structural edits (move, trim, slip, split, lift, ripple
delete), the geometry behind them, and the one door they go through. `domain/timeline.py`
decides *what a timeline is*; this decides *what the user may do to one, and how
it is undone*. Nothing here renders, nothing here saves: an edit ends with a new
`Timeline` in the store and an entry on the undo stack.

**Folder structure.**

```
services/timeline/
├── __init__.py   this file: the feature's contract
├── store.py      TimelineStore — the one piece of mutable state an edit needs
├── ripple.py     pure edit geometry: lift, ripple, slip, split, undo of each
├── commands.py   MoveClip · TrimClip · SlipClip · SplitClip · LiftClip · RippleDelete
└── editor.py     TimelineEditor — execute / undo / redo, and the Edit menu's state
```

**Backend / frontend.** The frontend never mutates a timeline. A drag, a razor
cut and a delete all construct a command and hand it to
`TimelineEditor.execute(command)`; what comes back is a `CommandOutcome` naming
the affected ids and the caches to invalidate. The Edit menu reads
`can_undo` / `undo_label` / `can_redo` from one method; the history panel reads
`recent()`. A drag sends a `gesture` token so a hundred mouse-moves become one
undo entry.

**State management.** Exactly one mutable object: `TimelineStore`, which holds a
frozen `Timeline` and replaces it wholesale. Undo deltas are captured scalars —
a move is four values, a ripple is a clip plus the ids that travelled — so undo
memory is independent of project size (ADR-0008 §2). Commands themselves are the
second piece of state: they record what they captured so they can put it back.

**Functions.**

| Call | Answers |
| --- | --- |
| `TimelineEditor.execute(command)` | "do this edit, or tell me why not" |
| `TimelineEditor.undo()` / `.redo()` | "put that back" / "put it back again" |
| `TimelineEditor.state()` | "what does the Edit menu show" |
| `ripple_delete(timeline, track_id, clip_id)` | the new timeline, plus the delta |
| `split_clip(clip, at_frame, new_id)` | the two halves |
| `slip_clip(clip, delta)` | the same clip, different source window |
| `source_frames_for(clip, frames)` | how much source a timeline span eats |

**Events.** `CommandHistory` publishes `command.executed`, `command.reverted` and
`command.failed` on the injected `EventBus`, carrying the affected ids and the
invalidation set (`timeline`, `preview`, `thumbnail`). Cache invalidation,
preview re-render, autosave dirty-marking and the WebSocket broadcast are all
subscribers to those — never call sites inside a command (ADR-0008 rule 6).

**Error handling.** `Result[T]` end to end, with `CommandError`'s codes:
`NS-COMMAND-4101` execution failed, `-4102` undo failed (critical — state may be
inconsistent), `-4103` undo of a command that never ran, `-4104` precondition
rejected. Preconditions are named, not generic: "track 'v1' is locked; unlock it
to edit", "clip 'c1' would overlap another clip on track 'v1' at frame 40". A
rejected command is never recorded, so it costs nothing to try.

**Caching.** None. An edit invalidates, and the invalidation set is *data on the
outcome*, consumed by a subscriber — the command itself never touches a cache.

**Performance.** Edits are O(clips on the affected tracks): a ripple walks every
track once. The one superlinear step is the post-edit `validate_timeline` guard,
which is O(n²) per track and runs only on an edit, not per frame. Undo deltas are
a handful of integers, so a two-thousand-clip timeline costs the same to undo as
a three-clip one.

**Testing.** `tests/services/test_timeline_ripple.py` pins the geometry —
including that ripple skips locked tracks, that a split respects speed and
reverse, and that every delta inverts.
`tests/services/test_timeline_commands.py` pins each command: validate, execute,
undo, the coalescing rules, and the guard that refuses an edit which would break
the timeline. `tests/services/test_timeline_editor.py` pins the door itself —
undo/redo ordering, the Edit-menu state, and that a rejected command leaves the
redo stack alone. No FFmpeg, no filesystem, no clock that moves unless told to.

**Database schema.** None — see the note in `docs/architecture/services.md` §1.

**Future expansion.**

* **Ripple across targeted tracks only.** Today a ripple moves every unlocked
  track; track targeting (`Track.locked` is the only flag the domain has) will
  narrow it to the armed tracks.
* **Roll and slide**, the two remaining four-point edits, in `ripple.py`.
* **A `PasteClipsCommand`** — the first `MemoryClass.HEAVY` command, and the
  reason the stack bounds heavy entries separately.
* **Journal replay**, once `services/projects/recovery.py` gains an executor:
  the command log is already a replayable list of these objects.
"""

from __future__ import annotations

from nova_studio.services.timeline.commands import (
    LiftClipCommand,
    MoveClipCommand,
    ReplaceTrackClipsCommand,
    RippleDeleteCommand,
    SlipClipCommand,
    SplitClipCommand,
    TimelineCommand,
    TrimClipCommand,
    TrimEdge,
)
from nova_studio.services.timeline.editor import TimelineEditor
from nova_studio.services.timeline.ripple import (
    Lifted,
    Rippled,
    lift_clip,
    reinsert_clip,
    ripple_delete,
    slip_clip,
    source_frames_for,
    split_clip,
    undo_ripple,
)
from nova_studio.services.timeline.store import TimelineStore, timeline_store

__all__ = [
    "LiftClipCommand",
    "Lifted",
    "MoveClipCommand",
    "ReplaceTrackClipsCommand",
    "RippleDeleteCommand",
    "Rippled",
    "SlipClipCommand",
    "SplitClipCommand",
    "TimelineCommand",
    "TimelineEditor",
    "TimelineStore",
    "TrimClipCommand",
    "TrimEdge",
    "lift_clip",
    "reinsert_clip",
    "ripple_delete",
    "slip_clip",
    "source_frames_for",
    "split_clip",
    "timeline_store",
    "undo_ripple",
]
