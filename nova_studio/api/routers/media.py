"""L4 — the media router: the bin, over HTTP.

Three endpoints, because a bin has three verbs: show me what is in it, put these
files in it, and **make it playable**. What makes the second one worth a module is
a single rule:

    **An import is a report, never a failure.**

Dropping forty files on a panel and getting a 400 because one of them is a text
file is an editor that trains its users to import one file at a time. So the
failures travel *inside* a 200 — one entry per path, each carrying the code the
frontend localises on — and the only thing that makes the endpoint fail at all is
the project not being open.

The third verb is the one that costs something, and it answers **202 with a list
of jobs** rather than waiting: a proxy is minutes of CPU, and a handler that
transcoded inline would hold a connection, block a worker in the ASGI pool and
be indistinguishable from a hang (ADR-0010). Planning what is missing is a pure
question about the project and the cache; the factory builds the bodies; the
executor runs them. This module maps HTTP words onto those three and nothing
more.

Probing is the ingestor's job (`services/media`) through the workspace, and the
probe itself is an injected port (`ports/media`, `infra/media.py`), so what a file
is gets decided in one place and not once per surface.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Depends, Request, status

from nova_studio.api.dependencies import jobs as jobs_dependency, media_factory, workspace
from nova_studio.api.errors import (
    error_responses,
    problem_response,
    respond,
    status_for,
)
from nova_studio.api.mappers.media import import_response, media_list_response
from nova_studio.api.schemas.media import (
    EnsureMediaRequest,
    EnsureMediaResponse,
    ImportRequest,
    ImportResponse,
    MediaJobSummary,
    MediaListResponse,
)
from nova_studio.api.workspace import (
    ProjectWorkspace,
    not_open,
)

if TYPE_CHECKING:
    from collections.abc import Callable

    from nova_studio.api.media_jobs import MediaJobFactory
    from nova_studio.core.result import Result
    from nova_studio.infra.jobs import ConcurrentJobExecutor

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


@router.post(
    "/api/v1/projects/{project_id}/media/ensure",
    response_model=EnsureMediaResponse,
    status_code=status.HTTP_202_ACCEPTED,
    responses=error_responses(),
    summary="Queue the proxies and thumbnails this project is missing",
)
def ensure_media(
    request: Request,
    project_id: str,
    body: EnsureMediaRequest,
    projects: ProjectWorkspace = Depends(workspace),
    jobs: ConcurrentJobExecutor = Depends(jobs_dependency),
    factory: MediaJobFactory = Depends(media_factory),
) -> Any:
    """Plan what the project needs, submit it, and answer with the jobs.

    Called as often as it likes — on an import, on a panel repaint, on a timer —
    because **what is missing is a pure question**: an artefact already held is
    simply not planned, so a second call when nothing has changed queues nothing
    and is nearly free.

    Returns:
        202 with the jobs that were queued — possibly an empty list, which is
        the ordinary answer for a project that is already up to date; 404 when
        no project with that id is open; 503 when the executor has no room, in
        which case the jobs that did fit are named and the rest are not queued.
    """
    path = request.url.path
    shown = projects.get(project_id)
    if shown is None:
        problem = not_open(project_id)
        return problem_response(problem, instance=path, status=status_for(problem))

    planned = factory.plan(
        shown.project,
        projects.media_cache,
        proxies=body.proxies,
        thumbnails=body.thumbnails,
    )

    queued: list[MediaJobSummary] = []
    for job in planned:
        submitted = jobs.submit(job.spec, job.body)
        refused = submitted.error()
        if refused is not None:
            # Partial is better than nothing, and honest: the jobs that fit are
            # named, the one that did not is the error the client sees.
            return problem_response(refused, instance=path, status=status_for(refused))
        handle = submitted.unwrap()
        queued.append(
            MediaJobSummary(
                job_id=handle.job_id,
                kind=job.kind,
                asset_id=job.asset_id,
                count=job.count,
                status=str(handle.status()),
                detail=f"{job.kind} for {job.asset_id}: {job.count} artefact(s)",
            )
        )

    strips = sum(1 for job in queued if job.kind == "thumbnail")
    transcodes = len(queued) - strips
    return EnsureMediaResponse(
        project_id=project_id,
        jobs=queued,
        proxies=transcodes,
        strips=strips,
        summary=_ensure_summary(transcodes, strips),
    )


def _ensure_summary(transcodes: int, strips: int) -> str:
    """One sentence for the status bar, in the words the user would use."""
    if not transcodes and not strips:
        return "everything this project needs is already in the cache"
    parts: list[str] = []
    if transcodes:
        parts.append(f"{transcodes} proxy transcode(s)")
    if strips:
        parts.append(f"{strips} thumbnail strip(s)")
    return f"queued {' and '.join(parts)}"
