"""L4 — the export router: one verb, and a promise about what it answers.

```
    POST /api/v1/projects/{project_id}/exports   →  202 ExportSubmission
```

**202, not 200, and not a body that waits.** An export is minutes of CPU. A
handler that rendered it inline would hold a connection, block a worker in the
ASGI pool, and be indistinguishable from a hang while it did — which is the
whole reason ADR-0010 exists. So this handler does exactly three things: build
the job, hand it to the executor, and describe the job it just made.

The response is deliberately thin — an id, a kind, a status, and a *socket
topic*. Progress, completion and failure all arrive on `/api/v1/ws`, which is
why the submission names the topic rather than making the client guess it.

**Overwriting is allowed, and safe.** The renderer writes beside the target and
promotes on success (`infra/render.py`), so a failed export leaves the previous
file exactly as it was. Refusing to overwrite would be a worse deal: the user
would rename files by hand to get the safety that atomic promotion already
gives them.

**Validation happens before a worker exists.** The container, the codec and the
frame range are checked here, against the open project, so a typo costs a 422
now instead of a failed job ninety seconds from now. That is the transport
doing the job the transport is for: refusing a request that cannot succeed.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Depends, Request, status

from nova_studio.api.dependencies import (
    export_factory,
    jobs as jobs_dependency,
    workspace,
)
from nova_studio.api.errors import (
    UNPROCESSABLE_ENTITY,
    error_responses,
    problem_response,
    status_for,
)
from nova_studio.api.mappers.export import export_request_from
from nova_studio.api.schemas.export import ExportSubmission, StartExportRequest
from nova_studio.api.workspace import not_open
from nova_studio.core.errors import NovaError, NovaInvariantError
from nova_studio.core.jobs import JobPriority
from nova_studio.services.render import (
    ExportVideoJob,
    export_job_spec,
    export_params_hash,
)

if TYPE_CHECKING:
    from nova_studio.api.exports import ExportJobFactory
    from nova_studio.api.workspace import ProjectWorkspace
    from nova_studio.infra.jobs import ConcurrentJobExecutor

__all__ = ["router"]


router = APIRouter(tags=["export"])


def _bad_request(why: str, path: str) -> Any:
    """A request that cannot succeed, as `problem+json` rather than a job.

    The code is the transport's own (``NS-VALIDATION-4220`` is what the shared
    error schema declares for it), because this is not a domain refusal: the
    domain was never asked.
    """
    return problem_response(
        NovaError("NS-VALIDATION-4220", why),
        instance=path,
        status=UNPROCESSABLE_ENTITY,
    )


@router.post(
    "/api/v1/projects/{project_id}/exports",
    response_model=ExportSubmission,
    status_code=status.HTTP_202_ACCEPTED,
    responses=error_responses(),
    summary="Start an export and get the job id back",
)
def start_export(
    request: Request,
    project_id: str,
    body: StartExportRequest,
    projects: ProjectWorkspace = Depends(workspace),
    jobs: ConcurrentJobExecutor = Depends(jobs_dependency),
    factory: ExportJobFactory = Depends(export_factory),
) -> Any:
    """Queue an export, and answer with the job that will do it.

    The project is read **now** and frozen into the job: an edit made while the
    export runs changes the editor, not the file being written. That is a
    promise a user can plan around, and it is why the body carries a value
    rather than a project id.

    Returns:
        202 with the submission; 404 when no project with that id is open; 422
        when the request names a container, a codec or a range the domain
        cannot build; 503 when every export slot is busy — in which case
        nothing was queued and trying again is the remedy.
    """
    path = request.url.path
    shown = projects.get(project_id)
    if shown is None:
        problem = not_open(project_id)
        return problem_response(problem, instance=path, status=status_for(problem))

    try:
        export_request = export_request_from(body, shown.project)
        # Resolved here, not left for the worker: an empty range is a request
        # nobody meant to make, and the count is what the response reports.
        frames = export_request.frames_for(shown.project)
        try:
            priority = JobPriority(body.priority)
        except ValueError as why:
            # Turning a priority the scheduler does not have into `low` would
            # be worse than refusing: the user would wait behind everything
            # else and never learn why.
            raise NovaInvariantError(
                f"unknown job priority {body.priority!r}; expected one of {', '.join(JobPriority)}"
            ) from why
    except (NovaInvariantError, ValueError) as why:
        # A container or a codec the domain does not have, a size of zero, a
        # range that runs backwards or covers nothing: all knowable before a
        # worker is spawned, and all cheaper to refuse now.
        return _bad_request(str(why), path)

    job: ExportVideoJob = factory.job_for(shown.project, export_request)
    expected = export_job_spec(priority=priority)
    submitted = jobs.submit(expected, job, params_hash=export_params_hash(export_request))
    refused = submitted.error()
    if refused is not None:
        return problem_response(refused, instance=path, status=status_for(refused))
    handle = submitted.unwrap()
    return ExportSubmission(
        job_id=handle.job_id,
        project_id=project_id,
        status=str(handle.status()),
        frames=len(frames),
        detail=f"{len(frames)} frames → {export_request.path}",
    )
