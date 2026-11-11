"""L4 — the settings router: what the project renders to, over HTTP.

Two decisions shape it, and both are the same decisions the timeline router
made, for the same reasons:

**The frontend posts an intent, not a project.** `SettingsPatchRequest` names
the settings the user changed and nothing else. A client that could PUT a whole
`Project` would bypass validation, undo, the journal and the preview cache in
one request — and it would take the project's assets, timeline and bindings
with it, because they are on the same object.

**Undo and redo are edits.** They are journalled like any other change, because
a crash-recovery replay that skipped them would hand the user back the 4K
render target they deliberately threw away (§8 of `docs/architecture/api.md`).

Nothing here validates a setting: whether three channels is mixable is
`SetSettingsCommand`'s business, reported as `NS-COMMAND-4104` and served by the
transport as a 409.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Depends, status

from nova_studio.api.dependencies import workspace
from nova_studio.api.errors import error_responses, respond, status_for
from nova_studio.api.mappers.settings import (
    decode_patch,
    settings_command_response,
    settings_redo_response,
    settings_response,
    settings_undo_response,
)
from nova_studio.api.schemas.settings import (
    SettingsCommandResponse,
    SettingsPatchRequest,
    SettingsRedoResponse,
    SettingsResponse,
    SettingsUndoResponse,
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

router = APIRouter(tags=["settings"])

_ROUTE = "/api/v1/projects/{project_id}/settings"


def _answer(
    result: Result[Any],
    *,
    to_body: Callable[[Any], Any],
    instance: str,
    code: int = status.HTTP_200_OK,
) -> Any:
    """One `Result` as one response, in the one shape the frontend parses.

    Which status a failure is served as is decided in `errors.py`, once, for
    every router — see `STATUS_FOR_CODE` there for why it is not decided here.
    """
    return respond(
        result,
        to_body=to_body,
        status_code=code,
        instance=instance,
        status_for=status_for,
    )


@router.get(
    _ROUTE,
    response_model=SettingsResponse,
    responses=error_responses(),
    summary="The project's render target",
)
def get_settings(
    project_id: str,
    projects: ProjectWorkspace = Depends(workspace),
) -> Any:
    """What the project renders and mixes to, with the history that got it there.

    The answer carries `aspect_ratio` and `even_dimensions` alongside the frame
    size, because both are things a user needs to know *before* they commit: an
    odd dimension is a 4:2:0 export that fails later, and an aspect ratio
    decides whether every title in the project still fits.
    """
    return _answer(
        projects.settings(project_id),
        to_body=lambda value: settings_response(value.project, value.editor),
        instance=_ROUTE.replace("{project_id}", project_id),
    )


@router.patch(
    _ROUTE,
    response_model=SettingsCommandResponse,
    responses=error_responses(),
    summary="Change one or more settings",
)
def patch_settings(
    project_id: str,
    body: SettingsPatchRequest,
    projects: ProjectWorkspace = Depends(workspace),
) -> Any:
    """Change the render target, and journal the change, or say precisely why not.

    A patch, not a replacement: every field is optional and one left out is one
    the caller has no opinion about, which is what lets two panels hold two
    settings open without either of them knowing the other's values.

    A refused change costs the user nothing — not even their redo future: the
    command is only recorded once it has succeeded. A journalling failure rolls
    the change back and says so, because a change we cannot replay is a change
    we must not pretend to have kept.
    """
    decoded = decode_patch(body)
    if decoded.is_err():
        return _answer(
            decoded,
            to_body=lambda _: None,
            instance=_ROUTE.replace("{project_id}", project_id),
        )
    patch = decoded.unwrap()
    return _answer(
        projects.apply_settings(
            project_id,
            patch.command,
            name=patch.name,
            payload=patch.payload,
        ),
        to_body=lambda value: settings_command_response(
            value.project,
            value.editor,
            command=value.command,
            name=value.name,
            outcome=value.outcome,
        ),
        instance=_ROUTE.replace("{project_id}", project_id),
    )


@router.post(
    f"{_ROUTE}/undo",
    response_model=SettingsUndoResponse,
    responses=error_responses(),
    summary="Undo the last settings change",
)
def undo_settings(
    project_id: str,
    projects: ProjectWorkspace = Depends(workspace),
) -> Any:
    """Undo one settings change, and journal the undo.

    An empty stack answers `undone: false` with a 200: pressing Ctrl+Z when
    nothing has been changed is not a mistake, and a 404 there would be a lie
    about what happened.
    """
    return _answer(
        projects.undo_settings(project_id),
        to_body=lambda value: settings_undo_response(
            value.project, value.editor, command=value.command, name=value.name
        ),
        instance=f"{_ROUTE.replace('{project_id}', project_id)}/undo",
    )


@router.post(
    f"{_ROUTE}/redo",
    response_model=SettingsRedoResponse,
    responses=error_responses(),
    summary="Redo the last undone settings change",
)
def redo_settings(
    project_id: str,
    projects: ProjectWorkspace = Depends(workspace),
) -> Any:
    """Redo one settings change, in the same shape as the undo that undid it."""
    return _answer(
        projects.redo_settings(project_id),
        to_body=lambda value: settings_redo_response(
            value.project, value.editor, command=value.command, name=value.name
        ),
        instance=f"{_ROUTE.replace('{project_id}', project_id)}/redo",
    )
