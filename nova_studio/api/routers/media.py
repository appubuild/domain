"""L4 — the media router: the bin, over HTTP.

Two endpoints, because a bin has only two verbs: show me what is in it, and put
these files in it. What makes the second one worth a module is a single rule:

    **An import is a report, never a failure.**

Dropping forty files on a panel and getting a 400 because one of them is a text
file is an editor that trains its users to import one file at a time. So the
failures travel *inside* a 200 — one entry per path, each carrying the code the
frontend localises on — and the only thing that makes the endpoint fail at all is
the project not being open.

Probing is the ingestor's job (`services/media`) through the workspace, and the
probe itself is an injected port (`ports/media`, `infra/media.py`), so what a file
is gets decided in one place and not once per surface.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Depends, status

from nova_studio.api.dependencies import workspace
from nova_studio.api.errors import error_responses, respond, status_for
from nova_studio.api.mappers.media import import_response, media_list_response
from nova_studio.api.schemas.media import ImportRequest, ImportResponse, MediaListResponse
from nova_studio.api.workspace import ProjectWorkspace  # noqa: TC001 — FastAPI resolves it

if TYPE_CHECKING:
    from collections.abc import Callable

    from nova_studio.core.result import Result

__all__ = ["router"]

router = APIRouter(tags=["media"])


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
    "/api/v1/projects/{project_id}/media",
    response_model=MediaListResponse,
    responses=error_responses(),
    summary="The media bin",
)
def list_media(
    project_id: str,
    projects: ProjectWorkspace = Depends(workspace),
) -> Any:
    """Every asset the project knows about, in import order.

    Each row carries the probe summary that was stored with it, so a project
    whose originals are offline still draws correct geometry and duration rather
    than a spinner (ADR-0015 rule 3).
    """
    return _answer(
        projects.assets(project_id),
        to_body=lambda assets: media_list_response(project_id, assets),
        instance=f"/api/v1/projects/{project_id}/media",
    )


@router.post(
    "/api/v1/projects/{project_id}/media/import",
    response_model=ImportResponse,
    responses=error_responses(),
    summary="Import files into the bin",
)
def import_media(
    project_id: str,
    body: ImportRequest,
    projects: ProjectWorkspace = Depends(workspace),
) -> Any:
    """Probe every path, add the ones that read, and report on the rest.

    A 200 whatever the files turned out to be: one unreadable file is one entry
    in `failures`, and the user gets to see the other thirty-nine arrive. Paths
    already in the project — or offered twice in one selection — come back as
    `duplicates` rather than as a second asset pointing at the same file.
    """
    return _answer(
        projects.import_media(project_id, list(body.paths)),
        to_body=lambda imported: import_response(project_id, imported),
        instance=f"/api/v1/projects/{project_id}/media/import",
    )
