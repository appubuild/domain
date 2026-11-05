"""L4 — the timeline DTOs: the edit, and the story of how it got that way.

Three rules decide what is in here, and a fourth decides what is not.

1. **The frontend never invents a command.** Every edit it can perform is one of
   the requests in `CommandRequest`, each carrying exactly the fields the domain
   command takes. A UI that could post arbitrary mutations would be a UI that
   could bypass validation, undo and the journal at the same time.
2. **A read returns the whole edit, not a reference to it.** The timeline is the
   thing the user is looking at; making them fetch tracks one at a time to draw
   one screen is how an editor ends up with a spinner on every scroll.
3. **History travels with the answer.** After every mutation the client gets
   `can_undo`, `can_redo` and the labels, so the Edit menu cannot disagree with
   the edit that was just made — the disagreement is otherwise a round trip and
   a race.
4. **No `Timeline` field is exposed that a command does not own.** Positions,
   in-points and trims are here; caches, resolved frames and render state are
   not. A DTO is a wire shape, and every field on it is a compatibility promise.

The command union is discriminated by `type`, which is also the name the journal
records — so a crash-recovery replay knows which command to rebuild without a
second table of names that could drift.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from nova_studio.domain.timeline import ClipKind, TrackKind
from nova_studio.services.timeline import TrimEdge

__all__ = [
    "ClipSpec",
    "ClipSummary",
    "CommandRequest",
    "CommandResponse",
    "HistorySummary",
    "LiftClipRequest",
    "MoveClipRequest",
    "RedoResponse",
    "ReplaceTrackClipsRequest",
    "RippleDeleteRequest",
    "SlipClipRequest",
    "SplitClipRequest",
    "TimebaseSummary",
    "TimelineResponse",
    "TimelineSummary",
    "TrackSummary",
    "TrimClipRequest",
    "UndoResponse",
]


class _Strict(BaseModel):
    """The base every timeline DTO gets: strict, frozen, self-documenting."""

    model_config = ConfigDict(extra="forbid", frozen=True, populate_by_name=True)


# ---------------------------------------------------------------------------
# Reading: the edit as it stands
# ---------------------------------------------------------------------------


class TimebaseSummary(_Strict):
    """The project's frame rate, in the two forms a UI needs."""

    num: int = Field(description="Numerator of the frame rate, e.g. 30000.")
    den: int = Field(description="Denominator, e.g. 1001. 1 for whole rates.")
    fps: float = Field(description="Frames per second, for display only.")


class ClipSummary(_Strict):
    """One clip, as a block on a track.

    `start_frame` and `duration_frames` are where it sits and how long it plays;
    `in_frame` and `out_frame` are which part of the source it shows. Trimming
    moves one of the second pair; moving the clip moves the first.
    """

    clip_id: str = Field(description="Stable id; the key every clip command uses.")
    asset_id: str = Field(description="The media bin entry this clip shows.")
    kind: ClipKind = Field(description="What kind of clip it is.")
    name: str = Field(description="What to call it in the timeline; may be empty.")
    start_frame: int = Field(description="Where it starts on the timeline.")
    end_frame: int = Field(description="Where it ends, exclusive.")
    duration_frames: int = Field(description="How long it plays.")
    in_frame: int = Field(description="First source frame shown.")
    out_frame: int = Field(description="Last source frame shown, exclusive.")
    speed: float = Field(description="Playback rate; 1.0 is normal, 0.5 is half.")
    enabled: bool = Field(description="Whether it is part of the output.")


class TrackSummary(_Strict):
    """One track, with the clips on it in timeline order."""

    track_id: str = Field(description="Stable id; the key track commands use.")
    kind: TrackKind = Field(description="What this track carries.")
    name: str = Field(description="What to call it; may be empty.")
    index: int = Field(description="Display order, 0 at the top.")
    muted: bool = Field(description="Whether its audio is muted.")
    locked: bool = Field(description="Whether edits are refused on it.")
    hidden: bool = Field(description="Whether it is left out of the output.")
    clip_count: int = Field(description="Clips on this track.")
    duration_frames: int = Field(description="End of the last clip on it.")
    clips: list[ClipSummary] = Field(description="Its clips, in timeline order.")


class TimelineSummary(_Strict):
    """The edit: its rate, its tracks, and how long it is."""

    timebase: TimebaseSummary = Field(description="The project's frame rate.")
    tracks: list[TrackSummary] = Field(description="Tracks in display order.")
    track_count: int = Field(description="How many tracks there are.")
    clip_count: int = Field(description="How many clips there are, in total.")
    duration_frames: int = Field(description="Length of the whole edit, in frames.")


class HistorySummary(_Strict):
    """What the Edit menu and the history panel need, in one round trip."""

    can_undo: bool = Field(description="Whether there is an edit to undo.")
    can_redo: bool = Field(description="Whether there is an edit to redo.")
    undo_label: str = Field(description="What undoing would do, as a localisable key.")
    redo_label: str = Field(description="What redoing would do, as a localisable key.")
    undo_depth: int = Field(description="Edits that can be undone.")
    redo_depth: int = Field(description="Edits that can be redone.")
    recent: list[str] = Field(description="The newest commands, oldest first.")


class TimelineResponse(_Strict):
    """The edit, its history, and how much of it is on disk."""

    project_id: str = Field(description="The project this timeline belongs to.")
    timeline: TimelineSummary = Field(description="The edit as it stands.")
    history: HistorySummary = Field(description="What undo and redo would do.")
    journal_sequence: int = Field(description="Newest journalled sequence; 0 for none.")
    pending_commands: int = Field(description="Edits since the last checkpoint.")
    dirty: bool = Field(description="Whether the edit differs from the file.")


# ---------------------------------------------------------------------------
# Writing: the commands
# ---------------------------------------------------------------------------


class MoveClipRequest(_Strict):
    """Move a clip to a position, on its own track or another."""

    type: Literal["move-clip"] = Field(
        default="move-clip",
        description="Discriminator: which command this is. It is also the name the journal records.",
    )
    clip_id: str = Field(min_length=1, description="The clip to move.")
    to_start_frame: int = Field(ge=0, description="Where its first frame should land.")
    to_track_id: str = Field(default="", description="Track to move it to; empty keeps it.")
    gesture: str = Field(
        default="",
        max_length=64,
        description="Drag id: consecutive moves sharing one collapse into a single undo.",
    )


class TrimClipRequest(_Strict):
    """Move one end of a clip to a frame."""

    type: Literal["trim-clip"] = Field(
        default="trim-clip",
        description="Discriminator: which command this is. It is also the name the journal records.",
    )
    clip_id: str = Field(min_length=1, description="The clip to trim.")
    to_frame: int = Field(ge=0, description="Where the chosen end should land.")
    edge: TrimEdge = Field(default=TrimEdge.END, description="Which end moves.")
    gesture: str = Field(
        default="",
        max_length=64,
        description="Drag id: consecutive trims sharing one collapse into a single undo.",
    )


class SlipClipRequest(_Strict):
    """Slide the source window inside a clip, moving neither end in time."""

    type: Literal["slip-clip"] = Field(
        default="slip-clip",
        description="Discriminator: which command this is. It is also the name the journal records.",
    )
    clip_id: str = Field(min_length=1, description="The clip to slip.")
    delta_frames: int = Field(description="How far to slide the source window; may be negative.")
    gesture: str = Field(
        default="",
        max_length=64,
        description="Drag id: consecutive slips sharing one collapse into a single undo.",
    )


class SplitClipRequest(_Strict):
    """Cut a clip in two at a frame."""

    type: Literal["split-clip"] = Field(
        default="split-clip",
        description="Discriminator: which command this is. It is also the name the journal records.",
    )
    clip_id: str = Field(min_length=1, description="The clip to cut.")
    at_frame: int = Field(gt=0, description="Where to cut, in timeline frames.")
    new_clip_id: str = Field(
        default="",
        max_length=64,
        description="Id for the second half; the server generates one when empty.",
    )


class LiftClipRequest(_Strict):
    """Remove a clip and leave the gap behind."""

    type: Literal["lift-clip"] = Field(
        default="lift-clip",
        description="Discriminator: which command this is. It is also the name the journal records.",
    )
    clip_id: str = Field(min_length=1, description="The clip to lift out.")


class RippleDeleteRequest(_Strict):
    """Remove a clip and close the gap on every unlocked track."""

    type: Literal["ripple-delete"] = Field(
        default="ripple-delete",
        description="Discriminator: which command this is. It is also the name the journal records.",
    )
    clip_id: str = Field(min_length=1, description="The clip to delete.")


class ClipSpec(_Strict):
    """One clip to place: the input to a track replacement."""

    clip_id: str = Field(default="", max_length=64, description="Id to use; generated when empty.")
    asset_id: str = Field(min_length=1, description="The media bin entry it shows.")
    kind: ClipKind = Field(default=ClipKind.CAPTION, description="What kind of clip it is.")
    name: str = Field(default="", max_length=200, description="What to call it.")
    start_frame: int = Field(default=0, ge=0, description="Where it starts on the timeline.")
    in_frame: int = Field(default=0, ge=0, description="First source frame shown.")
    source_frames: int = Field(default=1, ge=1, description="How many source frames it shows.")
    enabled: bool = Field(default=True, description="Whether it is part of the output.")


class ReplaceTrackClipsRequest(_Strict):
    """Make one track hold exactly these clips — nothing added, nothing kept.

    The caption engine's door, and the only command that writes a whole track at
    once: a transcript that arrives 400 cues at a time must not become 400
    undoable edits.
    """

    type: Literal["replace-track-clips"] = Field(
        default="replace-track-clips",
        description="Discriminator: which command this is. It is also the name the journal records.",
    )
    track_id: str = Field(min_length=1, description="The track to make hold them.")
    clips: list[ClipSpec] = Field(description="What the track should hold, in order.")
    kind: TrackKind = Field(default=TrackKind.CAPTION, description="Kind of track to use.")
    track_name: str = Field(default="", max_length=200, description="Name to give a new track.")
    create: bool = Field(default=True, description="Create the track when it does not exist.")


#: Every edit the frontend may ask for, discriminated by `type`. The literal is
#: also the name written to the journal, so there is one vocabulary and not two.
CommandRequest = Annotated[
    MoveClipRequest
    | TrimClipRequest
    | SlipClipRequest
    | SplitClipRequest
    | LiftClipRequest
    | RippleDeleteRequest
    | ReplaceTrackClipsRequest,
    Field(discriminator="type"),
]


# ---------------------------------------------------------------------------
# The answer after an edit
# ---------------------------------------------------------------------------


class CommandResponse(_Strict):
    """What one command did.

    `affected` and `invalidate` are how the frontend avoids refetching: the ids
    it must redraw, and the caches it must drop. `summary` is the sentence the
    status bar shows, written by the command that knows what it changed.
    """

    project_id: str = Field(description="The project that was edited.")
    command_id: str = Field(description="The command's own id, for telemetry and logs.")
    name: str = Field(description="What was asked for, e.g. `move-clip`.")
    summary: str = Field(description="What happened, as one sentence.")
    affected: list[str] = Field(description="Ids the command touched.")
    invalidate: list[str] = Field(description="Cache namespaces that must be dropped.")
    rerender: bool = Field(description="Whether the preview must be redrawn.")
    marks_dirty: bool = Field(description="Whether the project is now unsaved.")
    history: HistorySummary = Field(description="What undo and redo would do now.")
    journal_sequence: int = Field(description="Newest journalled sequence; 0 for none.")
    pending_commands: int = Field(description="Edits since the last checkpoint.")
    dirty: bool = Field(description="Whether the edit differs from the file.")


class UndoResponse(_Strict):
    """The outcome of Ctrl+Z.

    `undone` is false when there was nothing to undo, which is **not** an error:
    a user pressing undo on a fresh timeline has made no mistake.
    """

    project_id: str = Field(description="The project that was edited.")
    undone: bool = Field(description="Whether anything was undone.")
    command_id: str = Field(description="The command that was undone, or empty.")
    name: str = Field(description="What was undone, e.g. `move-clip`; empty for nothing.")
    history: HistorySummary = Field(description="What undo and redo would do now.")
    journal_sequence: int = Field(description="Newest journalled sequence; 0 for none.")
    pending_commands: int = Field(description="Edits since the last checkpoint.")
    dirty: bool = Field(description="Whether the edit differs from the file.")


class RedoResponse(_Strict):
    """The outcome of Ctrl+Shift+Z, in the same shape as :class:`UndoResponse`."""

    project_id: str = Field(description="The project that was edited.")
    redone: bool = Field(description="Whether anything was redone.")
    command_id: str = Field(description="The command that was redone, or empty.")
    name: str = Field(description="What was redone, e.g. `move-clip`; empty for nothing.")
    history: HistorySummary = Field(description="What undo and redo would do now.")
    journal_sequence: int = Field(description="Newest journalled sequence; 0 for none.")
    pending_commands: int = Field(description="Edits since the last checkpoint.")
    dirty: bool = Field(description="Whether the edit differs from the file.")
