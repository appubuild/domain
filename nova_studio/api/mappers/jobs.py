"""L4 — `core.jobs.JobRecord` to `JobRecordView`: the row the panel draws.

One function and one helper, because the record already *is* the row: the
mapping is a change of vocabulary — enum to string, `None` to null — and not a
change of shape. A mapper that recomputed anything here would be a second
opinion about what a job is, and the panel would eventually disagree with the
socket.

What it does add is the one derived field a client cannot work out for itself:
`active`. A row that is still moving gets a timer; a row that has stopped gets
an icon, and a client that can tell the difference from the response is a client
that stops leaking timers.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from nova_studio.api.schemas.jobs import JobListResponse, JobProgressView, JobRecordView

if TYPE_CHECKING:
    from nova_studio.core.jobs import JobProgress, JobRecord

__all__ = ["job_list_response", "job_progress_view", "job_record_view"]


def job_progress_view(progress: JobProgress) -> JobProgressView:
    """One report, as the bar and the label that show it."""
    return JobProgressView(
        fraction=progress.fraction,
        percent=progress.percent,
        stage=progress.stage,
        detail=progress.detail,
        eta_seconds=progress.eta_seconds,
    )


def job_record_view(record: JobRecord, *, now_ms: int) -> JobRecordView:
    """One record, as a history row.

    Args:
        record: The record, as the store or the executor holds it.
        now_ms: The workspace's idea of now, so `elapsed_ms` means the same
            thing on two consecutive requests rather than depending on when
            each happened to be served.
    """
    return JobRecordView(
        job_id=record.job_id,
        kind=record.kind,
        status=str(record.status),
        active=record.is_active,
        submitted_ms=record.submitted_ms,
        started_ms=record.started_ms,
        finished_ms=record.finished_ms,
        elapsed_ms=record.elapsed_ms(now_ms),
        progress=job_progress_view(record.progress),
        params_hash=record.params_hash,
        attempts=record.attempts,
        artefacts=list(record.artefacts),
        error_code=record.error_code,
        error_message=record.error_message,
    )


def job_list_response(records: tuple[JobRecord, ...], *, now_ms: int) -> JobListResponse:
    """The history, newest first: what a client wants when it arrives late."""
    ordered = sorted(records, key=lambda record: record.submitted_ms, reverse=True)
    return JobListResponse(
        jobs=[job_record_view(record, now_ms=now_ms) for record in ordered],
        count=len(ordered),
    )
