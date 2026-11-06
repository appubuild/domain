"""L4 — the projects router: the lifecycle of a `.nova` file, over HTTP.

A desktop editor's file menu is a surprising amount of the product: open, save,
save as, autosave, close, and — after a crash — whatever the recovery dialog has
to offer. This module is that menu, and three decisions shape it.

**The handlers are synchronous.** Opening and saving block: a `.nova` file is a
zip, and a save ends in an atomic replace and a directory fsync. Declaring them
`async def` would run that on the event loop and stall every other client,
including the socket carrying export progress. FastAPI runs a plain `def` in its
worker thread pool, which is what these want.

**Nothing here decides anything.** Whether a checkpoint is owed, what a recovery
dialog offers, whether a damaged project still opens — all of that is
`services/projects`, reached through the workspace. This module resolves a path,
picks a status, and serialises an answer.

**A path is never guessed.** Every path arrives from the client and is used
verbatim, because the only client is a window that got it from a native dialog.
A relative path is refused at the schema: it would silently resolve against the
server's working directory, which for a packaged build is wherever the shortcut
happened to point.
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Depends, Query, status
from starlette.responses import Response

from nova_studio.api.dependencies import workspace
from nova_studio.api.errors import error_responses, problem_response, respond, status_for
from nova_studio.api.mappers.projects import (
    audit_response,
    checkpoint_response,
    open_project_response,
    project_summary,
    recovery_response,
    save_response,
)
from nova_studio.api.schemas.projects import (
    AuditResponse,
    CheckpointResponse,
    CreateProjectRequest,
    OpenProjectRequest,
    OpenProjectResponse,
    ProjectListResponse,
    ProjectSummary,
    RecoveryResponse,
    SaveAsRequest,
    SaveProjectResponse,
)
from nova_studio.api.workspace import ProjectWorkspace, not_open
from nova_studio.core.result import Result, err, ok

if TYPE_CHECKING:
    from collections.abc import Callable


__all__ = ["router"]

router = APIRouter(tags=["projects"])


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
    "/api/v1/projects",
    response_model=ProjectListResponse,
    responses=error_responses(),
    summary="The projects open in this session",
)
def list_projects(
    projects: ProjectWorkspace = Depends(workspace),
) -> ProjectListResponse:
    """Every open project, in the order they were opened.

    Summaries, not projects: a list that carried whole timelines would be a
    request that grows without bound as the user works.
    """
    open_now = projects.open_projects()
    return ProjectListResponse(
        projects=[project_summary(item, now_ms=projects.now_ms()) for item in open_now]
    )


@router.post(
    "/api/v1/projects",
    response_model=OpenProjectResponse,
    responses=error_responses(),
    status_code=status.HTTP_201_CREATED,
    summary="Create a new project",
)
def create_project(
    body: CreateProjectRequest,
    projects: ProjectWorkspace = Depends(workspace),
) -> Any:
    """A new, empty project, open in memory and not yet written anywhere."""
    return _answer(
        projects.create(
            name=body.name,
            path=None if body.path is None else Path(body.path),
            author=body.author,
            description=body.description,
        ),
        to_body=lambda value: open_project_response(value, now_ms=projects.now_ms()),
        instance="/api/v1/projects",
        code=status.HTTP_201_CREATED,
    )


@router.post(
    "/api/v1/projects/open",
    response_model=OpenProjectResponse,
    responses=error_responses(),
    summary="Open a `.nova` file",
)
def open_project(
    body: OpenProjectRequest,
    projects: ProjectWorkspace = Depends(workspace),
) -> Any:
    """Open a project, refusing only what cannot be read at all.

    A damaged project comes back with warnings rather than as a failure
    (ADR-0015 rule 3): the user gets their work and a list of what to fix.
    """
    return _answer(
        projects.open(Path(body.path)),
        to_body=lambda value: open_project_response(value, now_ms=projects.now_ms()),
        instance="/api/v1/projects/open",
    )


@router.get(
    "/api/v1/projects/{project_id}",
    response_model=ProjectSummary,
    responses=error_responses(),
    summary="One open project",
)
def get_project(
    project_id: str,
    projects: ProjectWorkspace = Depends(workspace),
) -> Any:
    """The state of one open project, or a 404 when it is not open here."""
    found = projects.get(project_id)
    result: Result[Any] = ok(found) if found is not None else err(not_open(project_id))
    return _answer(
        result,
        to_body=lambda value: project_summary(value, now_ms=projects.now_ms()),
        instance=f"/api/v1/projects/{project_id}",
    )


@router.delete(
    "/api/v1/projects/{project_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    responses={
        **error_responses(),
        status.HTTP_204_NO_CONTENT: {"description": "The project was closed."},
    },
    summary="Close a project",
)
def close_project(
    project_id: str,
    projects: ProjectWorkspace = Depends(workspace),
) -> None:
    """Close a project without saving it.

    Deliberately does *not* write first: a close that silently saved would
    overwrite the very file the user may be trying to abandon.
    """
    instance = f"/api/v1/projects/{project_id}"
    closed = projects.close(project_id)
    if closed.is_err():
        return problem_response(closed.unwrap_err(), instance=instance)
    if not closed.unwrap():
        return problem_response(
            not_open(project_id), instance=instance, status=status.HTTP_404_NOT_FOUND
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/api/v1/projects/{project_id}/save",
    response_model=SaveProjectResponse,
    responses=error_responses(),
    summary="Save a project to its own file",
)
def save_project(
    project_id: str,
    projects: ProjectWorkspace = Depends(workspace),
) -> Any:
    """Write the project to the file it came from; 409 when it has none yet."""
    return _answer(
        projects.save(project_id),
        to_body=save_response,
        instance=f"/api/v1/projects/{project_id}/save",
    )


@router.post(
    "/api/v1/projects/{project_id}/save-as",
    response_model=SaveProjectResponse,
    responses=error_responses(),
    summary="Save a project somewhere else",
)
def save_project_as(
    project_id: str,
    body: SaveAsRequest,
    projects: ProjectWorkspace = Depends(workspace),
) -> Any:
    """Write the project to a new file and make that its home."""
    return _answer(
        projects.save_as(project_id, Path(body.path)),
        to_body=save_response,
        instance=f"/api/v1/projects/{project_id}/save-as",
    )


@router.post(
    "/api/v1/projects/{project_id}/checkpoint",
    response_model=CheckpointResponse,
    responses=error_responses(),
    summary="Write an autosave checkpoint now",
)
def checkpoint_project(
    project_id: str,
    label: str = Query("", max_length=120, description="What to remember it by."),
    projects: ProjectWorkspace = Depends(workspace),
) -> Any:
    """Store a revision and truncate the journal it makes redundant."""
    return _answer(
        projects.checkpoint(project_id, label=label),
        to_body=checkpoint_response,
        instance=f"/api/v1/projects/{project_id}/checkpoint",
    )


@router.post(
    "/api/v1/projects/{project_id}/autosave",
    response_model=CheckpointResponse,
    responses=error_responses(),
    summary="Take a checkpoint if one is owed",
)
def autosave_project(
    project_id: str,
    projects: ProjectWorkspace = Depends(workspace),
) -> Any:
    """The autosave tick, callable by the frontend's own timer.

    Answers `taken: false` when nothing was owed, which is not an error — a tick
    that checkpointed unconditionally would rewrite the archive on every keypress.
    """
    return _answer(
        projects.autosave(project_id),
        to_body=lambda value: checkpoint_response(value, project_id=project_id),
        instance=f"/api/v1/projects/{project_id}/autosave",
    )


@router.get(
    "/api/v1/projects/{project_id}/audit",
    response_model=AuditResponse,
    responses=error_responses(),
    summary="How this project is doing",
)
def audit_project(
    project_id: str,
    projects: ProjectWorkspace = Depends(workspace),
) -> Any:
    """What a user would want to know, as sentences rather than as a boolean."""
    return _answer(
        projects.audit(project_id),
        to_body=lambda value: audit_response(project_id, value),
        instance=f"/api/v1/projects/{project_id}/audit",
    )


@router.get(
    "/api/v1/projects/{project_id}/recovery",
    response_model=RecoveryResponse,
    responses=error_responses(),
    summary="What can be recovered after a crash",
)
def recovery_for_project(
    project_id: str,
    projects: ProjectWorkspace = Depends(workspace),
) -> Any:
    """The offers for this project's journal, best first.

    Asked at startup when a journal is found for a project that was open when the
    process died, and by the recovery dialog when the user asks.
    """
    return _answer(
        projects.recovery(project_id),
        to_body=lambda value: recovery_response(project_id, value),
        instance=f"/api/v1/projects/{project_id}/recovery",
    )
