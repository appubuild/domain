"""L4 — the job DTOs: what a job row shows while the work is happening.

Four rules shape these, and all four are about the fact that a job is *moving*
while the client is looking at it:

1. **A row must be drawable from one response.** The panel shows a bar, a
   stage, an elapsed time and a file name; if any of those needed a second
   request, a list of twenty jobs would be twenty more round trips per refresh.
2. **Progress is a view of the record, not a separate thing.** The newest
   report is carried *inside* the row, so a client that fetches a job after
   missing the events is looking at the same state as one that saw them all.
   That is the resync ADR-0010 §7 asks for, and it is why the fraction lives
   here as well as on the socket.
3. **A cancelled job is not a failed job.** `status` carries the distinction
   and `error_code` is empty for a cancellation: the user asked for it, and a
   row that said "failed" would send them looking for a bug.
4. **Nothing here is polled in the steady state.** Progress arrives on the
   socket as `job.progress`; these endpoints are for the two moments a client
   genuinely needs a request — when it arrives late, and when it wants history.

Deliberately absent is anything a client cannot act on. The checkpoint is the
scheduler's, not the panel's, until resume-from-checkpoint lands — and then it
arrives as its own field here, not as a second endpoint. What *is* carried is
`attempts`, because a job on its second try is a job the row should be able to
say so about: "running (attempt 2)" is an explanation, and a log line is not.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

__all__ = [
    "JobCancelResponse",
    "JobListResponse",
    "JobProgressView",
    "JobRecordView",
]


class _Strict(BaseModel):
    """The base every job DTO gets: strict, frozen, self-documenting."""

    model_config = ConfigDict(extra="forbid", frozen=True, populate_by_name=True)


class JobProgressView(_Strict):
    """What a bar and a label need, and nothing else."""

    fraction: float = Field(description="Completed fraction, 0.0 to 1.0.")
    percent: int = Field(description="Whole percent, for a bar or a row.")
    stage: str = Field(description="What the job is doing: encoding, muxing, done.")
    detail: str = Field(description="One human-readable line: which frame, which file.")
    eta_seconds: float | None = Field(
        default=None, description="Estimated seconds remaining; null until it can guess."
    )


class JobRecordView(_Strict):
    """One job, as a history row and as an answer to 'where is it up to?'."""

    job_id: str = Field(description="The id; also the key on the socket.")
    kind: str = Field(description="Dotted slug: export.video, asr.transcribe.")
    status: str = Field(
        description="pending, admitted, running, succeeded, failed, cancelled or interrupted."
    )
    #: A job is finished when nothing will change it again. Derived rather than
    #: listed, because a client that keeps a timer for a job that has stopped is
    #: a client with a leak.
    active: bool = Field(description="Whether the job may still change.")
    submitted_ms: int = Field(description="When the job was accepted, wall-clock ms.")
    started_ms: int | None = Field(description="When it started running, if it has.")
    finished_ms: int | None = Field(description="When it stopped, if it has.")
    elapsed_ms: int = Field(description="Milliseconds since submission, or the duration.")
    progress: JobProgressView = Field(description="The newest report the executor published.")
    params_hash: str = Field(
        default="", description="Fingerprint of the inputs, for a resumed job."
    )
    attempts: int = Field(description="Attempts made so far, starting at 0.")
    artefacts: list[str] = Field(
        default_factory=list, description="Files the job wrote; empty unless it succeeded."
    )
    error_code: str | None = Field(
        default=None, description="The stable NS-*-NNNN code when it did not succeed."
    )
    error_message: str | None = Field(
        default=None, description="Developer-facing text; the UI re-renders from the code."
    )


class JobListResponse(_Strict):
    """The job history, newest first."""

    jobs: list[JobRecordView] = Field(description="The records, newest first.")
    count: int = Field(description="How many there are, so a paged client can tell.")


class JobCancelResponse(_Strict):
    """The answer to 'stop it'.

    `cancelled` means the request was *made*, which is not the same as the job
    having stopped: a job finishes between frames, and the record — on the
    socket, or from the job endpoint — is where a client learns that.
    """

    job_id: str = Field(description="The job that was asked to stop.")
    cancelled: bool = Field(description="Whether the request was made.")
    status: str = Field(description="Where the job was when it was asked.")
