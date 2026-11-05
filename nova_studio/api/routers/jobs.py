"""L4 — the job router: where a job is, and how to stop it.

Three endpoints, and one thing they are *not*: a progress channel.

```
   POST /api/v1/projects/{id}/exports    start one   (202)   routers/export.py
   GET  /api/v1/jobs                     history             ← this file
   GET  /api/v1/jobs/{id}                one job
   POST /api/v1/jobs/{id}/cancel         stop it

                    progress arrives on /api/v1/ws
```

**Progress is not polled.** ADR-0010 §7 is explicit: the steady-state flow is
subscription, and a client that asked for progress sixty times a second would be
asking for a number it already has. So progress arrives as `job.progress` on the
socket, and these endpoints exist for the two moments a request is genuinely the
right shape — **when a client arrives late** (a reconnect, a window opened over
a running export) and **when it wants history**.

What is deliberately absent:

* **No "wait for the job" endpoint.** A request that blocked for nine minutes is
  indistinguishable from a hang, and it holds a connection the socket already
  replaced.
* **No retry endpoint.** Whether a failure deserves another attempt is the
  scheduler's decision, made from the record; a button that retried a job which
  failed because the destination is read-only would fail identically.
* **No cancel-and-delete.** Cancelling does not remove the record: a job the
  user stopped is a job the history should still be able to explain.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Depends, Request

from nova_studio.api.dependencies import jobs as jobs_dependency
from nova_studio.api.errors import error_responses, problem_response, status_for
from nova_studio.api.mappers.jobs import job_list_response, job_record_view
from nova_studio.api.schemas.jobs import JobCancelResponse, JobListResponse, JobRecordView
from nova_studio.core.errors import ErrorSeverity, NovaError
from nova_studio.ports.jobs import JobErrorCode
from nova_studio.services.render import EXPORT_JOB_KIND

if TYPE_CHECKING:
    from nova_studio.core.jobs import JobRecord
    from nova_studio.infra.jobs import ConcurrentJobExecutor
    from nova_studio.ports.jobs import JobStore

__all__ = ["router"]


router = APIRouter(tags=["jobs"])

#: The job kinds this session can produce. The store is keyed by kind rather
#: than offering "everything", so the history's unfiltered view is the union
#: over these — which means a new kind joins the panel by being added *here*,
#: a line a reviewer sees, rather than by a query that silently omits it. The
#: caption stage adds `asr.transcribe` when it lands.
JOB_KINDS: tuple[str, ...] = (EXPORT_JOB_KIND,)

#: How many rows a history list returns. A month of exports is thousands of
#: records, and a panel that fetched all of them to show the last twenty would
#: cost the user a megabyte to save itself a filter.
HISTORY_LIMIT: int = 50


def _missing(job_id: str, path: str) -> Any:
    """One unknown job id, as one `problem+json` 404."""
    return problem_response(
        NovaError("NS-PROJECT-4040", f"no job {job_id!r} in this session"),
        instance=path,
        status=404,
    )


def _history(store: JobStore) -> tuple[JobRecord, ...]:
    """Every record worth listing, newest first.

    Active records first in the ordering sense — they are the ones a user is
    watching — and then the recent terminal ones, deduplicated by id. Read from
    the store rather than from the executor because history must outlive the
    pools: after a restart the executor's tables are empty and the file is the
    only thing that remembers.
    """
    seen: dict[str, JobRecord] = {}
    for kind in JOB_KINDS:
        for record in store.by_kind(kind, limit=HISTORY_LIMIT):
            seen[record.job_id] = record
    for record in store.active():
        seen[record.job_id] = record
    ordered = sorted(seen.values(), key=lambda record: record.submitted_ms, reverse=True)
    return tuple(ordered[:HISTORY_LIMIT])


@router.get(
    "/api/v1/jobs",
    response_model=JobListResponse,
    responses=error_responses(),
    summary="The job history",
)
def list_jobs(
    jobs: ConcurrentJobExecutor = Depends(jobs_dependency),
) -> Any:
    """Every job this session knows about, newest first.

    Includes jobs started by a previous run: those are `interrupted`, and
    offering them is the whole point of writing the record before the work
    starts (ADR-0010 §6).
    """
    return job_list_response(_history(jobs.store), now_ms=jobs.now_ms())


@router.get(
    "/api/v1/jobs/{job_id}",
    response_model=JobRecordView,
    responses=error_responses(),
    summary="One job, and where it is up to",
)
def get_job(
    request: Request,
    job_id: str,
    jobs: ConcurrentJobExecutor = Depends(jobs_dependency),
) -> Any:
    """One job, including the newest progress report.

    This is the resync endpoint: a client that missed the events gets the same
    state from one request, which is why the progress is carried inside the row
    rather than beside it.
    """
    record = jobs.record_for(job_id)
    if record is None:
        return _missing(job_id, request.url.path)
    return job_record_view(record, now_ms=jobs.now_ms())


@router.post(
    "/api/v1/jobs/{job_id}/cancel",
    response_model=JobCancelResponse,
    responses=error_responses(),
    summary="Ask a job to stop",
)
def cancel_job(
    request: Request,
    job_id: str,
    jobs: ConcurrentJobExecutor = Depends(jobs_dependency),
) -> Any:
    """Ask a job to stop, and answer immediately.

    `cancelled: true` means the request was *made*, not that the job has
    stopped: a job finishes between frames, and after its grace period the
    watchdog closes the record anyway. A client learns the ending from the
    socket or from `GET /api/v1/jobs/{id}` — not by blocking here.

    Cancelling a job that has already finished is a refusal, because a UI that
    offers a cancel button for a finished job has a bug, and an endpoint that
    shrugged would hide it.
    """
    path = request.url.path
    record = jobs.record_for(job_id)
    if record is None:
        return _missing(job_id, path)
    if not record.is_active:
        # Decided here rather than left to the executor, because the record may
        # be one the executor has never held — finished in a previous run and
        # read back from the history. The executor can only say "I have no such
        # job", which is true and says nothing about the job.
        problem = NovaError(
            JobErrorCode.JOB_FAILED,
            f"job {job_id!r} has already finished, so it cannot be cancelled",
            severity=ErrorSeverity.WARNING,
        )
        return problem_response(problem, instance=path, status=status_for(problem))
    asked = jobs.cancel(job_id)
    if asked.is_err():
        problem = asked.unwrap_err()
        return problem_response(problem, instance=path, status=status_for(problem))
    return JobCancelResponse(job_id=job_id, cancelled=True, status=str(record.status))
