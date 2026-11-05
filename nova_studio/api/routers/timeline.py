"""L4 — the timeline router: the edit, over HTTP.

This is the module the keyboard and the mouse actually talk to. Three decisions
shape it, and each is the answer to a way this usually goes wrong:

**The frontend posts commands, not timelines.** A client that could PUT a whole
new edit would bypass validation, undo, the journal and the preview cache in one
request — and every one of those is a guarantee the rest of the system is built
on. What crosses the wire is *what the user did* ("move this clip to frame 50"),
in the domain's own vocabulary, and the domain decides whether it is allowed.

**Every answer carries the history.** After an edit the client knows `can_undo`,
`can_redo`, the labels and the depths, because the alternative — a second request
to ask the Edit menu what to show — is a race that a fast typist can lose.

**Undo and redo are edits.** They are journalled like any other change, because a
crash-recovery replay that skipped them would hand the user back work they threw
away (§8 of `docs/architecture/api.md`).

Nothing here validates an edit: whether a clip *may* move is the command's
business, reported as `NS-COMMAND-4104` and mapped by the transport to a 409.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Depends, status

from nova_studio.api.dependencies import workspace
from nova_studio.api.errors import error_responses, respond, status_for
from nova_studio.api.mappers.timeline import (
    command_response,
    decode,
    redo_response,
    timeline_response,
    undo_response,
)
from nova_studio.api.schemas.timeline import (
    CommandRequest,
    CommandResponse,
    RedoResponse,
    TimelineResponse,
    UndoResponse,
)

# `ProjectWorkspace` is imported at runtime for the reason written out in
# `dependencies.py`: FastAPI resolves a handler's annotations to decide what each
# parameter *is*, and one that exists only for mypy under
# `from __future__ import annotations` is not a dependency — it is a query
# parameter, and the endpoint then 422s with "projects: field required".
from nova_studio.api.workspace import ProjectWorkspace  # noqa: TC001 — see above

if TYPE_CHECKING:
    from collections.abc import Callable

    from nova_studio.core.result import Result

__all__ = ["router"]

router = APIRouter(tags=["timeline"])


#: Which statuses a failure is served as is decided in `errors.py`, once, for
#: every router — see `STATUS_FOR_CODE` there for why it is not decided here.
def _answer(
    result: Result[Any],
    *,
    to_body: Callable[[Any], Any],
    instance: str,
    code: int = status.HTTP_200_OK,
) -> Any:
    """One `Result` as one response, in the one shape the frontend parses."""
    return respond(
        result,
        to_body=to_body,
        status_code=code,
        instance=instance,
        status_for=status_for,
    )


@router.get(
    "/api/v1/projects/{project_id}/timeline",
    response_model=TimelineResponse,
    responses=error_responses(),
    summary="The edit as it stands",
)
def get_timeline(
    project_id: str,
    projects: ProjectWorkspace = Depends(workspace),
) -> Any:
    """The whole edit: its rate, its tracks, its clips, and its history.

    One request rather than one per track: the timeline is the thing the user is
    looking at, and a screen that needs six round trips before it can draw is a
    screen that flickers on every undo.
    """
    return _answer(
        projects.timeline(project_id),
        to_body=lambda value: timeline_response(value.project, value.editor),
        instance=f"/api/v1/projects/{project_id}/timeline",
    )


@router.post(
    "/api/v1/projects/{project_id}/commands",
    response_model=CommandResponse,
    responses=error_responses(),
    summary="Apply one edit",
)
def apply_command(
    project_id: str,
    body: CommandRequest,
    projects: ProjectWorkspace = Depends(workspace),
) -> Any:
    """Execute one command and journal it, or say precisely why not.

    A refused edit costs the user nothing — not even their redo future: the
    command is only recorded once it has succeeded. A journalling failure rolls
    the edit back and says so, because an edit we cannot replay is an edit we
    must not pretend to have kept.
    """
    decoded = decode(body)
    if decoded.is_err():
        return _answer(
            decoded, to_body=lambda _: None, instance=f"/api/v1/projects/{project_id}/commands"
        )
    command = decoded.unwrap()
    return _answer(
        projects.apply(
            project_id,
            command.command,
            name=command.name,
            payload=command.payload,
        ),
        to_body=lambda value: command_response(
            value.project,
            value.editor,
            command=value.command,
            name=value.name,
            outcome=value.outcome,
        ),
        instance=f"/api/v1/projects/{project_id}/commands",
    )


@router.post(
    "/api/v1/projects/{project_id}/undo",
    response_model=UndoResponse,
    responses=error_responses(),
    summary="Undo the last edit",
)
def undo_command(
    project_id: str,
    projects: ProjectWorkspace = Depends(workspace),
) -> Any:
    """Undo one edit, and journal the undo.

    An empty stack answers `undone: false` with a 200: pressing Ctrl+Z on a
    fresh timeline is not a mistake, and a 404 there would be a lie about what
    happened.
    """
    return _answer(
        projects.undo(project_id),
        to_body=lambda value: undo_response(
            value.project, value.editor, command=value.command, name=value.name
        ),
        instance=f"/api/v1/projects/{project_id}/undo",
    )


@router.post(
    "/api/v1/projects/{project_id}/redo",
    response_model=RedoResponse,
    responses=error_responses(),
    summary="Redo the last undone edit",
)
def redo_command(
    project_id: str,
    projects: ProjectWorkspace = Depends(workspace),
) -> Any:
    """Redo one edit, in the same shape as the undo that undid it."""
    return _answer(
        projects.redo(project_id),
        to_body=lambda value: redo_response(
            value.project, value.editor, command=value.command, name=value.name
        ),
        instance=f"/api/v1/projects/{project_id}/redo",
    )
