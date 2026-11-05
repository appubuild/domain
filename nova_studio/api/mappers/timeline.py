"""L4 — the timeline mapper: wire ↔ command, entity ↔ DTO.

Two translations here carry a rule worth knowing, because both have been got
wrong by editors that shipped:

* **A command's wire name is its journal name.** The `type` discriminator is what
  the journal records, so a future replay rebuilds the same command from the same
  vocabulary the frontend used to ask for it. A second table of names is a table
  that drifts.
* **Ids the server generates go back into the payload.** A split's second half and
  a replaced track's new clips are given ids here; if those ids stayed server
  secrets, a replay would create a different timeline from the same journal — the
  one failure a recovery system must not have.

Nothing here validates an edit: whether a clip *may* move is the command's
business, and a mapper that decided it would be a second place the same rule
lives.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from nova_studio.api.schemas.timeline import (
    ClipSpec,
    ClipSummary,
    CommandResponse,
    HistorySummary,
    LiftClipRequest,
    MoveClipRequest,
    RedoResponse,
    ReplaceTrackClipsRequest,
    RippleDeleteRequest,
    SlipClipRequest,
    SplitClipRequest,
    TimebaseSummary,
    TimelineResponse,
    TimelineSummary,
    TrackSummary,
    TrimClipRequest,
    UndoResponse,
)
from nova_studio.core.ident import new_short_id
from nova_studio.core.result import Result, failed, ok
from nova_studio.domain.timeline import Clip
from nova_studio.services.timeline import (
    LiftClipCommand,
    MoveClipCommand,
    ReplaceTrackClipsCommand,
    RippleDeleteCommand,
    SlipClipCommand,
    SplitClipCommand,
    TrimClipCommand,
)

if TYPE_CHECKING:
    from collections.abc import Callable, Sequence

    from nova_studio.api.schemas.timeline import CommandRequest
    from nova_studio.api.workspace import OpenProject
    from nova_studio.core.commands import Command, CommandOutcome, CommandScopeState
    from nova_studio.core.errors import NovaError
    from nova_studio.domain.timeline import Timeline, Track
    from nova_studio.services.timeline import TimelineEditor

__all__ = [
    "DecodedCommand",
    "clip_summary",
    "command_response",
    "decode",
    "history_summary",
    "redo_response",
    "timeline_response",
    "timeline_summary",
    "track_summary",
    "undo_response",
]


@dataclass(frozen=True, slots=True)
class DecodedCommand:
    """One wire command, decoded into the three things the workspace needs."""

    #: The domain command to execute.
    command: Command
    #: Its stable name: the journal entry's name, and the answer's `name`.
    name: str
    #: Its arguments, as the journal will record them so a replay can rebuild it.
    payload: dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------


def _timebase(timeline: Timeline) -> TimebaseSummary:
    base = timeline.timebase
    return TimebaseSummary(num=base.num, den=base.den, fps=base.fps)


def clip_summary(clip: Clip) -> ClipSummary:
    """One clip, as the timeline draws it."""
    return ClipSummary(
        clip_id=clip.clip_id,
        asset_id=clip.asset_id,
        kind=clip.kind,
        name=clip.name,
        start_frame=clip.start_frame,
        end_frame=clip.end_frame,
        duration_frames=clip.duration_frames,
        in_frame=clip.in_frame,
        out_frame=clip.out_frame,
        speed=float(clip.speed),
        enabled=clip.enabled,
    )


def track_summary(track: Track) -> TrackSummary:
    """One track, with its clips in the order they play."""
    return TrackSummary(
        track_id=track.track_id,
        kind=track.kind,
        name=track.name,
        index=track.index,
        muted=track.muted,
        locked=track.locked,
        hidden=track.hidden,
        clip_count=track.clip_count,
        duration_frames=track.duration_frames,
        clips=[clip_summary(clip) for clip in track.clips],
    )


def timeline_summary(timeline: Timeline) -> TimelineSummary:
    """The whole edit, in one response."""
    tracks = [track_summary(track) for track in timeline.tracks]
    return TimelineSummary(
        timebase=_timebase(timeline),
        tracks=tracks,
        track_count=timeline.track_count,
        clip_count=timeline.clip_count,
        duration_frames=timeline.duration_frames,
    )


def history_summary(state: CommandScopeState, recent: Sequence[str] = ()) -> HistorySummary:
    """What the Edit menu shows, from the stack's own state."""
    return HistorySummary(
        can_undo=state.can_undo,
        can_redo=state.can_redo,
        undo_label=state.undo_label,
        redo_label=state.redo_label,
        undo_depth=state.undo_depth,
        redo_depth=state.redo_depth,
        recent=list(recent),
    )


def _history_of(editor: TimelineEditor) -> HistorySummary:
    return history_summary(editor.state(), editor.recent())


def timeline_response(open_project: OpenProject, editor: TimelineEditor) -> TimelineResponse:
    """The edit as it stands, with the history that got it there."""
    return TimelineResponse(
        project_id=open_project.project_id,
        timeline=timeline_summary(open_project.project.timeline),
        history=_history_of(editor),
        journal_sequence=open_project.journal_sequence,
        pending_commands=open_project.pending_commands,
        dirty=open_project.dirty,
    )


def command_response(
    open_project: OpenProject,
    editor: TimelineEditor,
    *,
    command: Command,
    name: str,
    outcome: CommandOutcome,
) -> CommandResponse:
    """What one command did, for a client that does not want to refetch."""
    return CommandResponse(
        project_id=open_project.project_id,
        command_id=command.command_id,
        name=name,
        summary=outcome.summary,
        affected=sorted(outcome.affected),
        invalidate=sorted(outcome.invalidate),
        rerender=outcome.rerender,
        marks_dirty=outcome.marks_dirty,
        history=_history_of(editor),
        journal_sequence=open_project.journal_sequence,
        pending_commands=open_project.pending_commands,
        dirty=open_project.dirty,
    )


def undo_response(
    open_project: OpenProject,
    editor: TimelineEditor,
    *,
    command: Command | None,
    name: str = "",
) -> UndoResponse:
    """What Ctrl+Z did; `undone: false` when the stack was empty."""
    return UndoResponse(
        project_id=open_project.project_id,
        undone=command is not None,
        command_id=command.command_id if command is not None else "",
        name=name,
        history=_history_of(editor),
        journal_sequence=open_project.journal_sequence,
        pending_commands=open_project.pending_commands,
        dirty=open_project.dirty,
    )


def redo_response(
    open_project: OpenProject,
    editor: TimelineEditor,
    *,
    command: Command | None,
    name: str = "",
) -> RedoResponse:
    """What Ctrl+Shift+Z did; `redone: false` when there was nothing to redo."""
    return RedoResponse(
        project_id=open_project.project_id,
        redone=command is not None,
        command_id=command.command_id if command is not None else "",
        name=name,
        history=_history_of(editor),
        journal_sequence=open_project.journal_sequence,
        pending_commands=open_project.pending_commands,
        dirty=open_project.dirty,
    )


# ---------------------------------------------------------------------------
# Writing: wire → command
# ---------------------------------------------------------------------------


def _unknown(request: Any) -> NovaError:
    from nova_studio.core.errors import ErrorDomain, ErrorSeverity, NovaError

    return NovaError(
        "NS-VALIDATION-4220",
        f"{type(request).__name__} is not a timeline command",
        domain=ErrorDomain.VALIDATION,
        severity=ErrorSeverity.WARNING,
        remedy="Send one of the command types the contract names.",
    )


def _payload(request: Any) -> dict[str, Any]:
    """The arguments, in the shape the journal will record them."""
    body: dict[str, Any] = request.model_dump(mode="json", exclude={"type"})
    return body


def _clips(specs: Sequence[ClipSpec]) -> tuple[Clip, ...]:
    return tuple(
        Clip.of(
            spec.clip_id,
            spec.asset_id,
            start_frame=spec.start_frame,
            in_frame=spec.in_frame,
            source_frames=spec.source_frames,
            kind=spec.kind,
            enabled=spec.enabled,
            name=spec.name,
        )
        for spec in specs
    )


def decode(request: CommandRequest) -> Result[DecodedCommand]:
    """One wire command as a domain command, its name and its journal payload.

    Ids the client left blank are generated here and written back into the
    payload, so a replay of this entry rebuilds the same edit — not merely an
    equivalent one.
    """
    builder = _BUILDERS.get(type(request))
    if builder is None:
        return failed(_unknown(request))
    return builder(request)


def _move(request: MoveClipRequest) -> Result[DecodedCommand]:
    return ok(
        DecodedCommand(
            command=MoveClipCommand(
                clip_id=request.clip_id,
                to_start_frame=request.to_start_frame,
                to_track_id=request.to_track_id,
                gesture=request.gesture,
            ),
            name=request.type,
            payload=_payload(request),
        )
    )


def _trim(request: TrimClipRequest) -> Result[DecodedCommand]:
    return ok(
        DecodedCommand(
            command=TrimClipCommand(
                clip_id=request.clip_id,
                to_frame=request.to_frame,
                edge=request.edge,
                gesture=request.gesture,
            ),
            name=request.type,
            payload=_payload(request),
        )
    )


def _slip(request: SlipClipRequest) -> Result[DecodedCommand]:
    return ok(
        DecodedCommand(
            command=SlipClipCommand(
                clip_id=request.clip_id,
                delta_frames=request.delta_frames,
                gesture=request.gesture,
            ),
            name=request.type,
            payload=_payload(request),
        )
    )


def _split(request: SplitClipRequest) -> Result[DecodedCommand]:
    split = request
    if not split.new_clip_id:
        split = split.model_copy(update={"new_clip_id": new_short_id()})
    return ok(
        DecodedCommand(
            command=SplitClipCommand(
                clip_id=split.clip_id,
                at_frame=split.at_frame,
                new_clip_id=split.new_clip_id,
            ),
            name=split.type,
            payload=_payload(split),
        )
    )


def _lift(request: LiftClipRequest) -> Result[DecodedCommand]:
    return ok(
        DecodedCommand(
            command=LiftClipCommand(clip_id=request.clip_id),
            name=request.type,
            payload=_payload(request),
        )
    )


def _ripple(request: RippleDeleteRequest) -> Result[DecodedCommand]:
    return ok(
        DecodedCommand(
            command=RippleDeleteCommand(clip_id=request.clip_id),
            name=request.type,
            payload=_payload(request),
        )
    )


def _replace_track(request: ReplaceTrackClipsRequest) -> Result[DecodedCommand]:
    replacement = request.model_copy(
        update={
            "clips": [
                spec.model_copy(update={"clip_id": spec.clip_id or new_short_id()})
                for spec in request.clips
            ]
        }
    )
    return ok(
        DecodedCommand(
            command=ReplaceTrackClipsCommand(
                track_id=replacement.track_id,
                clips=_clips(replacement.clips),
                kind=replacement.kind,
                track_name=replacement.track_name,
                create=replacement.create,
            ),
            name=replacement.type,
            payload=_payload(replacement),
        )
    )


#: Which request type is decoded by which builder. A table rather than a chain of
#: `isinstance` checks, so adding a command is one entry here and one class in
#: `schemas/timeline.py` — and so an unknown type is a lookup miss, which is a
#: thing a caller can happen upon at runtime rather than only in a type checker.
_BUILDERS: dict[type[Any], Callable[[Any], Result[DecodedCommand]]] = {
    MoveClipRequest: _move,
    TrimClipRequest: _trim,
    SlipClipRequest: _slip,
    SplitClipRequest: _split,
    LiftClipRequest: _lift,
    RippleDeleteRequest: _ripple,
    ReplaceTrackClipsRequest: _replace_track,
}
