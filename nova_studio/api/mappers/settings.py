"""L4 — the settings mapper: wire ↔ command, entity ↔ DTO.

Three rules live here, and all three are small:

* **A field that was omitted is not sent.** The journal payload is dumped with
  `exclude_none`, so an entry records the decision the user made — "channels is
  now 6" — rather than the settings object that happened to be standing when
  they made it. A replay that stored the result would overwrite whatever is
  there now, which is the one failure a recovery system must not have.
* **Derived facts are computed here, not stored.** `aspect_ratio` and
  `even_dimensions` are functions of the frame size, and storing a function of
  something is storing a second thing to keep in step with it.
* **The mapper never validates a setting.** Whether 3 channels is mixable is the
  command's business, reported as `NS-COMMAND-4104` and served as a 409. A
  mapper that decided would be a second place the same rule lives — and one that
  the journal replay would not go through.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from nova_studio.api.schemas.settings import (
    FrameSizeSpec,
    FrameSizeSummary,
    SettingsCommandResponse,
    SettingsPatchRequest,
    SettingsRedoResponse,
    SettingsResponse,
    SettingsSummary,
    SettingsUndoResponse,
)
from nova_studio.api.schemas.timeline import HistorySummary
from nova_studio.core.result import Result, ok
from nova_studio.domain.media import ColourSpace
from nova_studio.domain.project import FrameSize, ProjectSettings
from nova_studio.services.projects import SetSettingsCommand

if TYPE_CHECKING:
    from nova_studio.api.workspace import OpenProject
    from nova_studio.core.commands import Command, CommandOutcome, CommandScopeState
    from nova_studio.services.projects import SettingsEditor

__all__ = [
    "DecodedSettingsPatch",
    "decode_patch",
    "frame_size_summary",
    "history_summary",
    "settings_command_response",
    "settings_redo_response",
    "settings_response",
    "settings_summary",
    "settings_undo_response",
]


@dataclass(frozen=True, slots=True)
class DecodedSettingsPatch:
    """One settings patch, decoded into the three things the workspace needs."""

    #: The domain command to execute.
    command: SetSettingsCommand
    #: Its stable name: the journal entry's name, and the answer's `name`.
    name: str
    #: Its arguments, as the journal will record them so a replay can rebuild it.
    payload: dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------


def frame_size_summary(size: FrameSize) -> FrameSizeSummary:
    """One frame size, as the panel shows it."""
    return FrameSizeSummary(width=size.width, height=size.height)


def settings_summary(settings: ProjectSettings) -> SettingsSummary:
    """The settings, plus the two facts a user needs before changing them."""
    return SettingsSummary(
        frame_size=frame_size_summary(settings.frame_size),
        aspect_ratio=settings.frame_size.aspect_ratio,
        even_dimensions=settings.frame_size.is_even,
        sample_rate=settings.sample_rate,
        channels=settings.channels,
        use_proxies=settings.use_proxies,
        working_colour_space=int(settings.working_colour_space),
    )


def history_summary(state: CommandScopeState, recent: list[str]) -> HistorySummary:
    """What the Edit menu shows, from the stack's own state."""
    return HistorySummary(
        can_undo=state.can_undo,
        can_redo=state.can_redo,
        undo_label=state.undo_label,
        redo_label=state.redo_label,
        undo_depth=state.undo_depth,
        redo_depth=state.redo_depth,
        recent=recent,
    )


def _history_of(editor: SettingsEditor) -> HistorySummary:
    return history_summary(editor.state(), editor.recent())


def _common(project: OpenProject, editor: SettingsEditor) -> dict[str, Any]:
    """The fields every settings answer carries, in one place.

    A response built field by field in four functions is four places to forget
    one when the contract grows; this is one.
    """
    return {
        "project_id": project.project_id,
        "settings": settings_summary(project.project.settings),
        "history": _history_of(editor),
        "journal_sequence": project.journal_sequence,
        "pending_commands": project.pending_commands,
        "dirty": project.dirty,
    }


def settings_response(project: OpenProject, editor: SettingsEditor) -> SettingsResponse:
    """The settings as they stand, with the history that got them there."""
    return SettingsResponse(**_common(project, editor))


def settings_command_response(
    project: OpenProject,
    editor: SettingsEditor,
    *,
    command: Command,
    name: str,
    outcome: CommandOutcome,
) -> SettingsCommandResponse:
    """What one settings change did, for a client that does not want to refetch."""
    return SettingsCommandResponse(
        **_common(project, editor),
        command_id=command.command_id,
        name=name,
        summary=outcome.summary,
        affected=sorted(outcome.affected),
        invalidate=sorted(outcome.invalidate),
        rerender=outcome.rerender,
        marks_dirty=outcome.marks_dirty,
    )


def settings_undo_response(
    project: OpenProject,
    editor: SettingsEditor,
    *,
    command: Command | None,
    name: str = "",
) -> SettingsUndoResponse:
    """What Ctrl+Z did; `undone: false` when the settings stack was empty."""
    return SettingsUndoResponse(
        **_common(project, editor),
        undone=command is not None,
        command_id=command.command_id if command is not None else "",
        name=name,
    )


def settings_redo_response(
    project: OpenProject,
    editor: SettingsEditor,
    *,
    command: Command | None,
    name: str = "",
) -> SettingsRedoResponse:
    """What Ctrl+Shift+Z did; `redone: false` when there was nothing to redo."""
    return SettingsRedoResponse(
        **_common(project, editor),
        redone=command is not None,
        command_id=command.command_id if command is not None else "",
        name=name,
    )


# ---------------------------------------------------------------------------
# Writing: wire → command
# ---------------------------------------------------------------------------


def decode_patch(request: SettingsPatchRequest) -> Result[DecodedSettingsPatch]:
    """One patch as a domain command, its name and its journal payload.

    Omitted fields stay omitted: the payload is dumped with `exclude_none`, so
    the journal records the *decision* and a replay re-applies that decision
    against whatever the settings are when it runs.
    """
    spec: FrameSizeSpec | None = request.frame_size
    command = SetSettingsCommand(
        frame_size=FrameSize(width=spec.width, height=spec.height) if spec is not None else None,
        sample_rate=request.sample_rate,
        channels=request.channels,
        use_proxies=request.use_proxies,
        working_colour_space=(
            ColourSpace(request.working_colour_space)
            if request.working_colour_space is not None
            else None
        ),
    )
    payload = request.model_dump(mode="json", exclude_none=True, exclude={"type"})
    return ok(DecodedSettingsPatch(command=command, name=request.type, payload=payload))
