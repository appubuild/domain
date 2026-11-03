"""L3 — the edit commands: six ways to change a timeline, each reversible.

This is where ADR-0008 rule 1 becomes concrete: there is no other way to change
a timeline.  A drag, a razor blade, a delete key and a scripted batch all go
through one of these objects, which is what buys undo, the command log, shortcut
binding and crash replay from a single mechanism — and what stops the frontend
from ever mutating project state directly.

Each command is **a captured delta, not a snapshot** (ADR-0008 §2).  A move is
four values; a ripple is a clip plus the ids that travelled.  A ten-thousand-clip
timeline costs no more to undo than a three-clip one.

Coalescing is declared per command, not centrally (ADR-0008 §3), because the
right answer differs per gesture: a drag is one gesture, a slider is one per
interaction, and a split is never a gesture at all.  The three draggable
commands — move, trim, slip — take a ``gesture`` token from the UI; two commands
with the same token inside the window merge into one undo entry, so undoing a
drag returns to where the drag began rather than to the last mouse move.

The guard every command inherits
---------------------------------
:meth:`TimelineCommand.execute` refuses an edit that *breaks* the timeline: if
``validate_timeline`` finds a problem afterwards that was not there before, the
previous timeline is restored and the command reports a precondition failure.
Two reasons.  First, the promise that matters — a command may not be the thing
that puts two clips on top of each other with no transition between them —
belongs to one place, not to six.  Second, it fails *before* the history records
anything, so a refused edit never consumes the user's redo future.  A timeline
that arrived broken is still editable: the guard only fires on a problem the
command introduced.
"""

from __future__ import annotations

from abc import abstractmethod
from dataclasses import dataclass
from enum import StrEnum
from typing import TYPE_CHECKING

from nova_studio.core.commands import (
    Command,
    CommandError,
    CommandOutcome,
    MemoryClass,
    UndoScope,
)
from nova_studio.core.result import Result, failed, ok
from nova_studio.domain.timeline import MIN_CLIP_FRAMES, validate_timeline
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
from nova_studio.services.timeline.store import timeline_store

if TYPE_CHECKING:
    from nova_studio.core.commands import CommandContext
    from nova_studio.domain.timeline import Clip, Timeline, Track
    from nova_studio.services.timeline.store import TimelineStore

__all__ = [
    "LiftClipCommand",
    "MoveClipCommand",
    "RippleDeleteCommand",
    "SlipClipCommand",
    "SplitClipCommand",
    "TimelineCommand",
    "TrimClipCommand",
    "TrimEdge",
]

#: What a command invalidates.  Subscribers to ``command.executed`` read this;
#: nothing in a command calls the cache itself (ADR-0008 rule 6).
_TIMELINE_INVALIDATED: frozenset[str] = frozenset({"timeline", "preview", "thumbnail"})


class TrimEdge(StrEnum):
    """Which end of a clip a trim moves."""

    #: The head: moves ``start_frame`` and ``in_frame`` together.
    START = "start"
    #: The tail: moves ``out_frame`` only.
    END = "end"


class TimelineCommand(Command):
    """The shared shape of a timeline edit.

    A subclass implements :meth:`_apply` — the edit itself, given the store and
    the timeline as it stands — and :meth:`undo`.  Everything else here is the
    plumbing every edit would otherwise repeat.
    """

    scope = UndoScope.TIMELINE

    def execute(self, ctx: CommandContext) -> Result[CommandOutcome]:
        """Apply the edit, or restore the timeline and report why not."""
        store = timeline_store(ctx)
        if store is None:
            return failed(
                CommandError.execution_failed(
                    self.command_id, "the command context carries no timeline store"
                )
            )
        before = store.current()
        result = self._apply(store, before)
        if result.is_err():
            return result
        problem = validate_timeline(store.current())
        if problem and not validate_timeline(before):
            store.replace(before)
            return failed(CommandError.precondition(self.command_id, problem))
        return result

    @abstractmethod
    def _apply(self, store: TimelineStore, timeline: Timeline) -> Result[CommandOutcome]:
        """Perform the edit, leaving the result in ``store``."""

    # -- shared lookups ----------------------------------------------------

    def _require_clip(self, timeline: Timeline, clip_id: str) -> Result[tuple[Track, Clip]]:
        """The track and clip a command is about, or a precise failure."""
        track = timeline.track_of(clip_id)
        if track is None:
            return failed(
                CommandError.precondition(
                    self.command_id, f"clip {clip_id!r} is not on the timeline"
                )
            )
        clip = track.clip(clip_id)
        if clip is None:  # pragma: no cover - track_of implies the clip is there
            return failed(
                CommandError.precondition(
                    self.command_id, f"clip {clip_id!r} is not on the timeline"
                )
            )
        return ok((track, clip))

    @staticmethod
    def _store_of(ctx: CommandContext) -> Result[TimelineStore]:
        store = timeline_store(ctx)
        if store is None:
            return failed(
                CommandError.execution_failed(
                    "timeline", "the command context carries no timeline store"
                )
            )
        return ok(store)


@dataclass
class MoveClipCommand(TimelineCommand):
    """Move a clip to a position, on its own track or another.

    The delta is four values — where it came from and where it went — captured
    on first execution and preserved across merges, so a whole drag undoes to
    where it started.
    """

    clip_id: str
    to_start_frame: int
    to_track_id: str = ""
    #: Set by the UI for one continuous gesture; merges share it.
    gesture: str = ""
    #: Captured on execution.  ``None`` until the command has run.
    from_start_frame: int | None = None
    from_track_id: str = ""

    command_id = "timeline.move-clip"
    display_name = "command.timeline.move_clip"
    coalescible = True

    def __post_init__(self) -> None:
        super().__init__()
        if not self.clip_id:
            raise ValueError("MoveClipCommand requires a clip_id")

    def validate(self, ctx: CommandContext) -> Result[None]:
        store = timeline_store(ctx)
        if store is None:
            return failed(
                CommandError.precondition(self.command_id, "there is no timeline to edit")
            )
        timeline = store.current()
        found = self._require_clip(timeline, self.clip_id)
        if found.is_err():
            return failed(found.unwrap_err())
        track, clip = found.unwrap()
        target_id = self.to_track_id or track.track_id
        target = timeline.track(target_id)
        if target is None:
            return failed(
                CommandError.precondition(
                    self.command_id, f"track {target_id!r} is not on the timeline"
                )
            )
        if target.locked:
            return failed(
                CommandError.precondition(
                    self.command_id, f"track {target_id!r} is locked; unlock it to edit"
                )
            )
        if self.to_start_frame < 0:
            return failed(
                CommandError.precondition(
                    self.command_id,
                    f"a clip cannot start before frame 0, got {self.to_start_frame}",
                )
            )
        if not target.is_free(
            self.to_start_frame,
            self.to_start_frame + clip.duration_frames,
            ignore_clip_id=self.clip_id,
        ):
            return failed(
                CommandError.precondition(
                    self.command_id,
                    f"clip {self.clip_id!r} would overlap another clip on track "
                    f"{target_id!r} at frame {self.to_start_frame}",
                )
            )
        return ok(None)

    def _apply(self, store: TimelineStore, timeline: Timeline) -> Result[CommandOutcome]:
        found = self._require_clip(timeline, self.clip_id)
        if found.is_err():
            return failed(found.unwrap_err())
        track, clip = found.unwrap()
        if self.from_start_frame is None:
            self.from_start_frame = clip.start_frame
            self.from_track_id = track.track_id
        target_id = self.to_track_id or track.track_id
        target = timeline.track(target_id)
        if target is None:  # pragma: no cover - validate() rejects this first
            return failed(
                CommandError.execution_failed(
                    self.command_id, f"track {target_id!r} is not on the timeline"
                )
            )

        moved = clip.with_start(self.to_start_frame)
        if target_id == track.track_id:
            next_timeline = timeline.replaced(track.replaced(moved))
        else:
            # Transitions belong to a track, not to a clip: a cross-track move
            # leaves them behind, which is what every NLE does.
            next_timeline = timeline.replaced(track.without_clip(self.clip_id))
            destination = next_timeline.track(target_id)
            if destination is None:  # pragma: no cover - validate() rejects this first
                return failed(
                    CommandError.execution_failed(
                        self.command_id, f"track {target_id!r} is not on the timeline"
                    )
                )
            next_timeline = next_timeline.replaced(destination.with_clip(moved))
        store.replace(next_timeline)
        return ok(
            CommandOutcome(
                affected=frozenset({self.clip_id}),
                invalidate=_TIMELINE_INVALIDATED,
                summary=f"moved {self.clip_id!r} to frame {self.to_start_frame}"
                + (f" on track {target_id!r}" if target_id != track.track_id else ""),
            )
        )

    def undo(self, ctx: CommandContext) -> Result[None]:
        store = timeline_store(ctx)
        if store is None or self.from_start_frame is None:
            return failed(CommandError.not_executed(self.command_id))
        timeline = store.current()
        found = self._require_clip(timeline, self.clip_id)
        if found.is_err():
            return failed(found.unwrap_err())
        track, clip = found.unwrap()
        restored = clip.with_start(self.from_start_frame)
        if self.from_track_id == track.track_id:
            store.replace(timeline.replaced(track.replaced(restored)))
            return ok(None)
        next_timeline = timeline.replaced(track.without_clip(self.clip_id))
        home = next_timeline.track(self.from_track_id)
        if home is None:  # pragma: no cover - the track existed to be moved from
            return failed(
                CommandError.undo_failed(
                    self.command_id, f"track {self.from_track_id!r} no longer exists"
                )
            )
        store.replace(next_timeline.replaced(home.with_clip(restored)))
        return ok(None)

    def merge_key(self) -> tuple[str, str] | None:
        if not self.gesture:
            return None
        return (self.clip_id, self.gesture)

    def merge_into(self, previous: Command) -> Command:
        """One drag: the original position from ``previous``, this one's target.

        The delta that survives a merge is where the gesture *began*, which is
        what the user means by undoing a drag.
        """
        if not isinstance(previous, MoveClipCommand):  # pragma: no cover - guarded
            raise NotImplementedError("MoveClipCommand only merges with its own kind")
        return MoveClipCommand(
            clip_id=self.clip_id,
            to_start_frame=self.to_start_frame,
            to_track_id=self.to_track_id,
            gesture=self.gesture,
            from_start_frame=previous.from_start_frame,
            from_track_id=previous.from_track_id,
        )


@dataclass
class TrimClipCommand(TimelineCommand):
    """Move one end of a clip to a frame.

    The head moves ``start_frame`` and ``in_frame`` together; the tail moves
    ``out_frame`` alone.  Speed decides how much source the change eats, via
    :func:`~nova_studio.services.timeline.ripple.source_frames_for`.

    Source *bounds* are not checked: the timeline does not know how long the
    media behind a clip is, so a trim beyond the end is clamped by the conform
    step rather than refused here.
    """

    clip_id: str
    to_frame: int
    edge: TrimEdge = TrimEdge.END
    gesture: str = ""
    #: Captured on execution.
    saved: Clip | None = None

    command_id = "timeline.trim-clip"
    display_name = "command.timeline.trim_clip"
    coalescible = True

    def __post_init__(self) -> None:
        super().__init__()

    def validate(self, ctx: CommandContext) -> Result[None]:
        store = timeline_store(ctx)
        if store is None:
            return failed(
                CommandError.precondition(self.command_id, "there is no timeline to edit")
            )
        found = self._require_clip(store.current(), self.clip_id)
        if found.is_err():
            return failed(found.unwrap_err())
        _, clip = found.unwrap()
        if self.edge is TrimEdge.START:
            if not clip.start_frame < self.to_frame < clip.end_frame:
                return failed(
                    CommandError.precondition(
                        self.command_id,
                        f"the head of {self.clip_id!r} must stay inside the clip",
                    )
                )
            consumed = source_frames_for(clip, self.to_frame - clip.start_frame)
            if clip.source_frames - consumed < MIN_CLIP_FRAMES:
                return failed(
                    CommandError.precondition(
                        self.command_id, f"trimming {self.clip_id!r} leaves no frames behind"
                    )
                )
        else:
            # ``<=`` and not ``<``: pulling the tail back onto the head is the
            # "trims to nothing" case, and its message is the one below about
            # frames rather than this one about geometry.
            if self.to_frame < clip.start_frame:
                return failed(
                    CommandError.precondition(
                        self.command_id,
                        f"the tail of {self.clip_id!r} must stay after its head",
                    )
                )
            consumed = source_frames_for(clip, self.to_frame - clip.end_frame)
            if clip.source_frames + consumed < MIN_CLIP_FRAMES:
                return failed(
                    CommandError.precondition(
                        self.command_id, f"trimming {self.clip_id!r} leaves no frames behind"
                    )
                )
        return ok(None)

    def _apply(self, store: TimelineStore, timeline: Timeline) -> Result[CommandOutcome]:
        found = self._require_clip(timeline, self.clip_id)
        if found.is_err():
            return failed(found.unwrap_err())
        track, clip = found.unwrap()
        self.saved = self.saved or clip
        if self.edge is TrimEdge.START:
            consumed = source_frames_for(clip, self.to_frame - clip.start_frame)
            trimmed = clip.trimmed(in_frame=clip.in_frame + consumed).with_start(self.to_frame)
        else:
            consumed = source_frames_for(clip, self.to_frame - clip.end_frame)
            trimmed = clip.trimmed(out_frame=clip.out_frame + consumed)
        store.replace(timeline.replaced(track.replaced(trimmed)))
        return ok(
            CommandOutcome(
                affected=frozenset({self.clip_id}),
                invalidate=_TIMELINE_INVALIDATED,
                summary=(
                    f"trimmed the {self.edge.value} of {self.clip_id!r} to frame {self.to_frame}"
                ),
            )
        )

    def undo(self, ctx: CommandContext) -> Result[None]:
        store = timeline_store(ctx)
        if store is None or self.saved is None:
            return failed(CommandError.not_executed(self.command_id))
        timeline = store.current()
        track = timeline.track_of(self.clip_id)
        if track is None:
            return failed(
                CommandError.undo_failed(
                    self.command_id, f"clip {self.clip_id!r} is no longer on the timeline"
                )
            )
        store.replace(timeline.replaced(track.replaced(self.saved)))
        return ok(None)

    def merge_key(self) -> tuple[str, str, str] | None:
        """The two ends of one clip are different gestures: a head trim and a
        tail trim of the same drag must never merge into one entry."""
        if not self.gesture:
            return None
        return (self.clip_id, self.edge.value, self.gesture)

    def merge_into(self, previous: Command) -> Command:
        if not isinstance(previous, TrimClipCommand):  # pragma: no cover - guarded
            raise NotImplementedError("TrimClipCommand only merges with its own kind")
        return TrimClipCommand(
            clip_id=self.clip_id,
            to_frame=self.to_frame,
            edge=self.edge,
            gesture=self.gesture,
            saved=previous.saved,
        )


@dataclass
class SlipClipCommand(TimelineCommand):
    """Slide the source window inside a clip, moving neither end in time.

    Nothing around the clip changes, which is what makes a slip the right tool
    for "the sentence starts too late": the cut points the editor already has
    stay exactly where they are.

    The delta is one number, and a slip drag accumulates: three nudges of five
    frames are one undo step of fifteen.
    """

    clip_id: str
    delta_frames: int
    gesture: str = ""
    #: How far this command actually moved, captured on execution.
    applied: int = 0

    command_id = "timeline.slip-clip"
    display_name = "command.timeline.slip_clip"
    coalescible = True

    def __post_init__(self) -> None:
        super().__init__()

    def validate(self, ctx: CommandContext) -> Result[None]:
        store = timeline_store(ctx)
        if store is None:
            return failed(
                CommandError.precondition(self.command_id, "there is no timeline to edit")
            )
        found = self._require_clip(store.current(), self.clip_id)
        if found.is_err():
            return failed(found.unwrap_err())
        _, clip = found.unwrap()
        if clip.in_frame + self.delta_frames < 0:
            return failed(
                CommandError.precondition(
                    self.command_id,
                    f"slipping {self.clip_id!r} by {self.delta_frames} frames would "
                    "start before the beginning of the source",
                )
            )
        return ok(None)

    def _apply(self, store: TimelineStore, timeline: Timeline) -> Result[CommandOutcome]:
        found = self._require_clip(timeline, self.clip_id)
        if found.is_err():
            return failed(found.unwrap_err())
        track, clip = found.unwrap()
        self.applied = self.delta_frames
        store.replace(timeline.replaced(track.replaced(slip_clip(clip, self.delta_frames))))
        return ok(
            CommandOutcome(
                affected=frozenset({self.clip_id}),
                invalidate=_TIMELINE_INVALIDATED,
                summary=f"slipped {self.clip_id!r} by {self.delta_frames} frames",
            )
        )

    def undo(self, ctx: CommandContext) -> Result[None]:
        store = timeline_store(ctx)
        if store is None:
            return failed(CommandError.not_executed(self.command_id))
        timeline = store.current()
        found = self._require_clip(timeline, self.clip_id)
        if found.is_err():
            return failed(found.unwrap_err())
        track, clip = found.unwrap()
        store.replace(timeline.replaced(track.replaced(slip_clip(clip, -self.applied))))
        self.applied = 0
        return ok(None)

    def merge_key(self) -> tuple[str, str] | None:
        if not self.gesture:
            return None
        return (self.clip_id, self.gesture)

    def merge_into(self, previous: Command) -> Command:
        """A slip drag accumulates: the undo step is the sum of the nudges."""
        if not isinstance(previous, SlipClipCommand):  # pragma: no cover - guarded
            raise NotImplementedError("SlipClipCommand only merges with its own kind")
        return SlipClipCommand(
            clip_id=self.clip_id,
            delta_frames=previous.delta_frames + self.delta_frames,
            gesture=self.gesture,
            applied=previous.applied + self.applied,
        )


@dataclass
class SplitClipCommand(TimelineCommand):
    """Cut a clip in two at a frame.

    The left half keeps the id — so anything already pointing at the clip keeps
    working — and the right half takes the id the caller supplies, which is why
    the caller passes one rather than letting the command mint it: a command that
    invents an identifier cannot be replayed deterministically from the crash
    journal.
    """

    clip_id: str
    at_frame: int
    new_clip_id: str
    #: Captured on execution.
    saved: Clip | None = None

    command_id = "timeline.split-clip"
    display_name = "command.timeline.split_clip"

    def __post_init__(self) -> None:
        super().__init__()

    def validate(self, ctx: CommandContext) -> Result[None]:
        store = timeline_store(ctx)
        if store is None:
            return failed(
                CommandError.precondition(self.command_id, "there is no timeline to edit")
            )
        found = self._require_clip(store.current(), self.clip_id)
        if found.is_err():
            return failed(found.unwrap_err())
        _, clip = found.unwrap()
        if not clip.start_frame < self.at_frame < clip.end_frame:
            return failed(
                CommandError.precondition(
                    self.command_id,
                    f"frame {self.at_frame} is not inside clip {self.clip_id!r}",
                )
            )
        return ok(None)

    def _apply(self, store: TimelineStore, timeline: Timeline) -> Result[CommandOutcome]:
        found = self._require_clip(timeline, self.clip_id)
        if found.is_err():
            return failed(found.unwrap_err())
        track, clip = found.unwrap()
        self.saved = self.saved or clip
        left, right = split_clip(clip, self.at_frame, self.new_clip_id)
        store.replace(timeline.replaced(track.replaced(left).with_clip(right)))
        return ok(
            CommandOutcome(
                affected=frozenset({self.clip_id, self.new_clip_id}),
                invalidate=_TIMELINE_INVALIDATED,
                summary=f"split {self.clip_id!r} at frame {self.at_frame}",
            )
        )

    def undo(self, ctx: CommandContext) -> Result[None]:
        store = timeline_store(ctx)
        if store is None or self.saved is None:
            return failed(CommandError.not_executed(self.command_id))
        timeline = store.current()
        track = timeline.track_of(self.new_clip_id)
        if track is None:
            return failed(
                CommandError.undo_failed(
                    self.command_id, f"the right half {self.new_clip_id!r} is gone"
                )
            )
        store.replace(timeline.replaced(track.without_clip(self.new_clip_id).replaced(self.saved)))
        return ok(None)


@dataclass
class LiftClipCommand(TimelineCommand):
    """Remove a clip and leave the gap behind.

    The delta is the clip itself, which is why a lift is cheap to undo on any
    size of timeline.
    """

    clip_id: str
    #: Captured on execution.
    lifted: Lifted | None = None

    command_id = "timeline.lift-clip"
    display_name = "command.timeline.lift_clip"

    def __post_init__(self) -> None:
        super().__init__()

    def _apply(self, store: TimelineStore, timeline: Timeline) -> Result[CommandOutcome]:
        found = self._require_clip(timeline, self.clip_id)
        if found.is_err():
            return failed(found.unwrap_err())
        track, _ = found.unwrap()
        next_track, delta = lift_clip(track, self.clip_id)
        self.lifted = delta
        store.replace(timeline.replaced(next_track))
        return ok(
            CommandOutcome(
                affected=frozenset({self.clip_id}),
                invalidate=_TIMELINE_INVALIDATED,
                summary=f"lifted {self.clip_id!r}, leaving the gap",
            )
        )

    def undo(self, ctx: CommandContext) -> Result[None]:
        store = timeline_store(ctx)
        if store is None or self.lifted is None:
            return failed(CommandError.not_executed(self.command_id))
        timeline = store.current()
        track = timeline.track(self.lifted.track_id)
        if track is None:  # pragma: no cover - the track existed to be lifted from
            return failed(
                CommandError.undo_failed(
                    self.command_id, f"track {self.lifted.track_id!r} no longer exists"
                )
            )
        store.replace(timeline.replaced(reinsert_clip(track, self.lifted)))
        return ok(None)


@dataclass
class RippleDeleteCommand(TimelineCommand):
    """Remove a clip and close the gap on every unlocked track.

    The delta is the removed clip plus the ids that travelled, so a ripple over
    two thousand clips still costs a few hundred bytes of undo memory
    (ADR-0008 §2) — and a locked track is never touched, which is what lets an
    editor finish a mix and then keep cutting picture.
    """

    clip_id: str
    #: Captured on execution.
    rippled: Rippled | None = None

    command_id = "timeline.ripple-delete-clip"
    display_name = "command.timeline.ripple_delete"
    memory_class = MemoryClass.MEDIUM

    def __post_init__(self) -> None:
        super().__init__()

    def _apply(self, store: TimelineStore, timeline: Timeline) -> Result[CommandOutcome]:
        found = self._require_clip(timeline, self.clip_id)
        if found.is_err():
            return failed(found.unwrap_err())
        track, _ = found.unwrap()
        next_timeline, delta = ripple_delete(timeline, track.track_id, self.clip_id)
        self.rippled = delta
        store.replace(next_timeline)
        moved = f", pulling {delta.moved_count} clips" if delta.moved_count else ""
        return ok(
            CommandOutcome(
                affected=frozenset({self.clip_id, *(clip_id for _, clip_id in delta.moved)}),
                invalidate=_TIMELINE_INVALIDATED,
                summary=f"deleted {self.clip_id!r} and closed the gap{moved}",
            )
        )

    def undo(self, ctx: CommandContext) -> Result[None]:
        store = timeline_store(ctx)
        if store is None or self.rippled is None:
            return failed(CommandError.not_executed(self.command_id))
        store.replace(undo_ripple(store.current(), self.rippled))
        return ok(None)
