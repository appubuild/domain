"""L2 port — jobs: how work is executed, cancelled, and reported on.

Where :mod:`nova_studio.core.jobs` decides *who may run*, this module declares
*how running happens*: the pools, the cancellation token, the progress channel
and the persisted record.  Five protocols, narrowest first.

``JobContext``
    What a running job body is handed.  It can answer "has the user stopped
    me?", publish progress and leave a resume point.  This is the only thing a
    job body ever sees — it cannot reach the pool, the store or the UI, which is
    what makes a job testable by calling it directly with a fake context.
``JobHandle``
    What the submitter keeps: cancel, wait, resync.  A handle stays valid after
    the process that created it has gone, so a job interrupted by a crash can
    still be inspected on the next start.
``JobObserver``
    The push channel.  The WebSocket bridge implements it; the executor calls
    it.  This is the one protocol in this module implemented by ``services``
    rather than ``infra``, because the thing that consumes progress *is* the
    presentation layer.
``JobExecutor``
    The pools.  Submit, subscribe, drain, shut down — and report the capacity
    it was configured with, so the scheduler can run
    :func:`~nova_studio.core.jobs.decide_admission` against what is actually
    there rather than against an assumption.
``JobStore``
    The record.  Job history, and the reconciliation that turns a crash into a
    resumable job list (ADR-0010 §6).

Deliberately not here: *policy*.  Admission, throttling, retry backoff and the
circuit breaker are pure functions and state machines in
:mod:`nova_studio.core.jobs`; an adapter that reimplemented them would drift
from the ones the rest of the system is tested against.  The executor executes
and reports; the scheduler decides.

Contract rules an adapter must honour
-------------------------------------
1. **Cancellation is cooperative, with a hard deadline.**  A job polls
   :meth:`JobContext.is_cancelled` — an adapter never kills a thread — and
   :meth:`JobHandle.cancel` arms a watchdog for the spec's grace period
   (5 s; 30 s for an export, so a job mid-mux is not killed into a corrupt
   file).  A cancelled job ends as ``Err(NS-JOB-5005)``, and the UI says
   "stopped", not "failed".
2. **Progress is throttled, but never lost at the edges.**
   :class:`~nova_studio.core.jobs.ProgressThrottle` caps the rate at 20 Hz
   (ADR-0010 §3); a stage change and the final report are published regardless,
   because a bar frozen at 99 % is indistinguishable from a hang.
3. **A dead worker is a value, not an exception.**  A segfaulting codec or an
   OOM kill becomes ``Err(NS-JOB-5003)`` — the job is over, the editor is not.
   Retrying is the scheduler's decision, made with
   :class:`~nova_studio.core.jobs.RetryPolicy` and
   :class:`~nova_studio.core.jobs.CircuitBreaker`, never the adapter's.
4. **Nothing starts before it is durable.**  The record is written by
   :meth:`JobStore.put` *before* the job is admitted, which is what makes
   post-crash reporting possible: the last thing the process did is on disk.
5. **A process job's payload must survive the boundary.**  Windows ``spawn``
   re-imports and re-initialises the worker (ADR-0010, Negative consequences),
   so a payload that cannot be transferred is ``Err(NS-JOB-5007)`` at submit
   time — not a pickling error five minutes into a two-hour export.
6. **The UI subscribes; it does not poll.**  :meth:`JobHandle.progress` exists
   for resync (ADR-0010 §7), but the steady-state flow is
   :meth:`JobExecutor.subscribe` → observer → event bus → WebSocket.  An
   adapter that only offers polling reintroduces the refresh-timer UI that
   ADR-0010 §7 rules out — and, on a loopback socket, a request per job per
   frame.
7. **A cancelled export leaves no partial file.**  Outputs are written beside
   the target and promoted on success, so :attr:`JobOutcome.artefacts` names
   only complete files — a half-written MP4 on the user's desktop is worse than
   none at all.
8. **No third-party types.**  No ``concurrent.futures``, no ``multiprocessing``,
   no ``psutil`` in a signature: those are the adapter's business.  Everything
   here is :mod:`nova_studio.core.jobs` vocabulary or stdlib.

One adapter note, because it shapes the interface: ADR-0010 routes ASR to a
*dedicated long-lived worker* rather than the general pool, precisely because
``spawn`` would otherwise reload the model on every job.  That is an executor
implementation, not a protocol — one adapter can own a warm process and a cold
pool at the same time, which is why :meth:`JobExecutor.submit` takes an
affinity and nothing else.

Note on ``__all__``: :data:`JobBody` and :data:`Unsubscribe` are exported by
import but not listed, because the port-façade test requires every advertised
name to be a declaration (a ``Protocol``, an ``ABC`` or an ``Enum``) and a type
alias is not one.  Ports advertise *interfaces*; aliases are conveniences for
the signatures that use them.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from enum import StrEnum
from typing import Protocol, TypeAlias, runtime_checkable

from nova_studio.core.jobs import (
    DEFAULT_GRACE_PERIOD_MS,
    JobOutcome,
    JobProgress,
    JobRecord,
    JobSpec,
    JobStatus,
    PoolCapacity,
)
from nova_studio.core.result import Result

__all__ = [
    "JobContext",
    "JobErrorCode",
    "JobExecutor",
    "JobHandle",
    "JobObserver",
    "JobStore",
]

#: What a job *is*, as far as this port is concerned: a callable that is given a
#: context and returns a result.  A plain function satisfies it, which is the
#: point — a job body is not a class hierarchy, it is work.
JobBody: TypeAlias = Callable[["JobContext"], Result[JobOutcome]]

#: How a subscription is dropped.  Returned by
#: :meth:`JobExecutor.subscribe` so that a short-lived listener (one export
#: dialog) can stop receiving events without the executor holding it alive.
Unsubscribe: TypeAlias = Callable[[], None]


class JobErrorCode(StrEnum):
    """The codes a job executor or store may return in the ``Err`` half.

    All are ``NS-JOB-*`` because the job subsystem is its own error domain:
    a scheduler failure is not an export failure or an ASR failure, and the UI
    treats them differently — "stopped", "your GPU ran out of memory", "this
    job type is disabled on your machine".
    """

    #: No slot could be granted before the caller's deadline.  The work was
    #: never started, so it is safe to submit again.
    QUEUE_FULL = "NS-JOB-5001"
    #: The job kind is disabled, because its circuit breaker is open
    #: (ADR-0010 §5).  The remedy names the kind and how to reset it.
    KIND_DISABLED = "NS-JOB-5002"
    #: The worker died: a codec segfault, an OOM kill, a machine that slept.
    #: The job's partial output is discarded; the scheduler decides on retry.
    WORKER_LOST = "NS-JOB-5003"
    #: The job overran its declared ``timeout_ms``, or the shutdown grace
    #: period expired with jobs still running.
    TIMED_OUT = "NS-JOB-5004"
    #: The job was cancelled.  Not a fault: the UI says "stopped".
    CANCELLED = "NS-JOB-5005"
    #: The job ran and failed with a fault of its own — a missing source file,
    #: an unsupported codec.  Never retried: it would fail identically.
    JOB_FAILED = "NS-JOB-5006"
    #: A ``PROCESS`` job whose body or arguments cannot cross the process
    #: boundary.  Refused at submit time (rule 5), never discovered mid-run.
    PAYLOAD_NOT_TRANSFERABLE = "NS-JOB-5007"
    #: The record could not be written or read.  A job whose history cannot be
    #: recorded is not started, because post-crash reporting depends on it.
    RECORD_UNAVAILABLE = "NS-JOB-5008"


@runtime_checkable
class JobContext(Protocol):
    """What a running job is given: a way to be stopped and a way to be heard.

    A job body receives this and nothing else.  It cannot reach the pool, the
    store, the UI or the clock, which is what lets a job be unit-tested by
    calling it with a fake context — and what stops a job from quietly
    depending on ambient state it will not have in a worker process.
    """

    @property
    def job_id(self) -> str:
        """The id this run was recorded under; also the log correlation key."""
        ...

    @property
    def spec(self) -> JobSpec:
        """The declaration this job was submitted with, unchanged."""
        ...

    def is_cancelled(self) -> bool:
        """Whether cancellation has been requested (ADR-0010 §4).

        Polled, never delivered as an exception: a job must be able to stop at
        a point it chooses — between frames, after a mux — so that stopping
        leaves a coherent state.  A job that ignores this flag is killed by the
        watchdog after the spec's grace period.
        """
        ...

    def report(self, progress: JobProgress) -> None:
        """Publish progress.

        May be called as often as the job likes; the executor throttles to the
        spec's ``max_progress_hz`` (ADR-0010 §3).  A stage change and a
        terminal report are always published.  Returning ``None`` is
        deliberate: reporting is never a failure the job should handle.
        """
        ...

    def checkpoint(self, state: Mapping[str, object]) -> None:
        """Record a resume point, so a long job can restart after a crash.

        ``state`` must be JSON-serialisable — it is persisted with the job
        record and may be read by a different process on the next start.  An
        export writes frames done and bytes written; a transcription writes the
        segments completed.  Checkpoints are throttled harder than progress:
        they cost a write.
        """
        ...

    def heartbeat(self) -> None:
        """Tell the supervisor this job is alive and must not be reaped.

        Needed only by work that looks hung: a long GPU wait, a network fetch
        behind a slow proxy.  A job that is silently stuck for longer than its
        timeout is a bug, and the watchdog treats it as one.
        """
        ...


@runtime_checkable
class JobHandle(Protocol):
    """The submitter's token: cancel it, wait for it, or catch up with it.

    A handle outlives the run.  After a crash, the scheduler rebuilds handles
    from :meth:`JobStore.reconcile_interrupted` so the UI can show "these were
    running when the editor closed" and offer to resume.
    """

    @property
    def job_id(self) -> str:
        """The id this job was recorded under."""
        ...

    @property
    def spec(self) -> JobSpec:
        """The declaration this job was submitted with."""
        ...

    def status(self) -> JobStatus:
        """Where the job is right now.

        This is a *resync* read (ADR-0010 §7): the steady-state flow for a UI
        is subscription.  A caller that needs the whole picture takes
        :meth:`record`.
        """
        ...

    def progress(self) -> JobProgress:
        """The latest report, for a caller that has just subscribed or resumed."""
        ...

    def record(self) -> JobRecord:
        """The persisted record: timings, attempts, error, artefacts."""
        ...

    def cancel(self, *, grace_period_ms: int | None = None) -> Result[None]:
        """Ask the job to stop, arming the watchdog (ADR-0010 §4).

        Args:
            grace_period_ms: Override the spec's grace period — used when the
                whole application is shutting down and cannot wait.

        Returns:
            ``Ok(None)`` once cancellation has been *requested*, not once the
            job has stopped; :meth:`wait` is how a caller learns that.  ``Err``
            with :attr:`JobErrorCode.JOB_FAILED` when the job already finished,
            or :attr:`JobErrorCode.QUEUE_FULL` when it was never admitted.
        """
        ...

    def wait(self, timeout_ms: int | None = None) -> Result[JobOutcome]:
        """Block until the job finishes, up to ``timeout_ms``.

        Returns:
            ``Ok(JobOutcome)`` on success; ``Err(NS-JOB-5005)`` if it was
            cancelled, ``Err(NS-JOB-5003)`` if the worker died,
            ``Err(NS-JOB-5004)`` on timeout, ``Err(NS-JOB-5006)`` if the job
            itself failed.  A caller that wants the reason as a record reads
            :meth:`record` afterwards.
        """
        ...


@runtime_checkable
class JobObserver(Protocol):
    """Receives job events.  Implemented by the bridge to the frontend.

    Two methods, one per kind of event, because they have different
    frequencies: progress arrives up to 20 times a second per job, while a
    status change happens a handful of times in a job's life.  A subscriber
    that only cares about completion can ignore :meth:`on_progress` entirely.

    An observer must not block: it is called on the worker's reporting path,
    and a slow observer slows the job that is feeding it.
    """

    def on_progress(self, job_id: str, progress: JobProgress) -> None:
        """A throttled progress report, already filtered by the executor."""
        ...

    def on_status(self, record: JobRecord) -> None:
        """The job changed state.  ``record.status`` says which.

        Carrying the whole record rather than the status alone means a
        subscriber that misses the earlier events — a WebSocket that has just
        reconnected — can resync from this one call.
        """
        ...


@runtime_checkable
class JobExecutor(Protocol):
    """The pools: where a job body actually runs.

    The object behind this protocol owns threads and processes, supervises
    workers and enforces the grace periods.  It does not decide *whether* a job
    may start — that is :func:`~nova_studio.core.jobs.decide_admission`, run by
    the scheduler against :meth:`capacity`.
    """

    def submit(
        self,
        spec: JobSpec,
        body: JobBody,
        *,
        job_id: str | None = None,
        params_hash: str = "",
    ) -> Result[JobHandle]:
        """Record, admit and start a job.

        Args:
            spec: What the job is and what it may cost.
            body: The work.  For a ``PROCESS`` job it must survive the
                boundary, or this returns
                :attr:`JobErrorCode.PAYLOAD_NOT_TRANSFERABLE`.
            job_id: Supply the id when the caller already has one — a resumed
                job keeps the id it was interrupted under, so the UI does not
                show two rows for one piece of work.
            params_hash: Fingerprint of the inputs, stored on the record so a
                resumed job can tell whether the project changed underneath it.

        Returns:
            ``Ok(JobHandle)`` once the job is *recorded and queued* — not
            necessarily running.  ``Err`` with :attr:`JobErrorCode.QUEUE_FULL`
            when there is no room, :attr:`JobErrorCode.KIND_DISABLED` when the
            circuit breaker is open, or
            :attr:`JobErrorCode.RECORD_UNAVAILABLE` when the record could not
            be written (rule 4: no record, no job).
        """
        ...

    def subscribe(self, observer: JobObserver) -> Unsubscribe:
        """Register a listener; call the result to remove it (ADR-0010 §7).

        The listener sees every job the executor runs, not one job in
        particular: the WebSocket bridge subscribes once, at startup, and fans
        events out to whichever clients are connected.
        """
        ...

    def running(self) -> tuple[JobRecord, ...]:
        """The records of jobs that currently hold a slot.

        What the activity panel and the shutdown path need: the store knows the
        history, the executor knows what is actually on a core right now.
        """
        ...

    def capacity(self) -> PoolCapacity:
        """The caps this executor was configured with.

        The scheduler feeds this into
        :func:`~nova_studio.core.jobs.decide_admission` rather than assuming a
        number, so that a machine with no GPU rejects GPU work instead of
        queueing it.
        """
        ...

    def cancel_all(self, *, reason: str = "shutdown") -> int:
        """Cancel every outstanding job; return how many were asked to stop.

        Used on the shutdown path and when a project is closed underneath a
        background job.  The ``reason`` is recorded, so the history can say why
        a job is missing from the user's exports.
        """
        ...

    def drain(self, timeout_ms: int | None = None) -> bool:
        """Stop accepting new work and wait for what is running.

        Returns:
            ``True`` if everything finished within the timeout, ``False`` if
            jobs are still running — leaving the caller to decide between
            waiting longer and abandoning them.
        """
        ...

    def shutdown(self, *, grace_period_ms: int = DEFAULT_GRACE_PERIOD_MS) -> Result[None]:
        """Stop the pools, giving running jobs ``grace_period_ms`` to finish.

        Returns:
            ``Ok(None)`` when every worker came back; ``Err(NS-JOB-5004)`` when
            some did not, which the composition root reports rather than
            swallows — a process that will not exit is a support ticket with a
            diagnosis attached.
        """
        ...


@runtime_checkable
class JobStore(Protocol):
    """The persisted record of jobs: history, recovery and pruning.

    Rows live in ``ai_jobs``/``export_jobs`` (ADR-0004 §6).  The store is
    separate from the executor on purpose: history must be readable after a
    crash, when the pools are gone and nothing is running.
    """

    def put(self, record: JobRecord) -> Result[None]:
        """Write or overwrite a record.

        Called before a job starts and again on every transition, so the last
        thing the process did is always on disk (rule 4).  Failure is
        :attr:`JobErrorCode.RECORD_UNAVAILABLE`, and a job whose record cannot
        be written is not started.
        """
        ...

    def get(self, job_id: str) -> JobRecord | None:
        """Read one record, or ``None`` if this job was never recorded.

        A missing record is an ordinary answer, not an error: the resync path
        asks about ids that may have been pruned.
        """
        ...

    def active(self) -> tuple[JobRecord, ...]:
        """Every record that is not in a terminal state.

        Read at startup, before reconciliation, to decide what to offer the
        user for resumption.
        """
        ...

    def by_kind(self, kind: str, *, limit: int = 50) -> tuple[JobRecord, ...]:
        """Recent records for one job kind, newest first.

        Backs the job history panel and the failure counts the circuit breaker
        is checked against.
        """
        ...

    def reconcile_interrupted(self) -> tuple[JobRecord, ...]:
        """Turn every non-terminal record into
        :attr:`~nova_studio.core.jobs.JobStatus.INTERRUPTED` (ADR-0010 §6).

        Called once, at startup.  A job that was ``RUNNING`` when the editor
        closed did not fail and did not finish — it was interrupted, and the
        user is shown a resume action.  Bleaching the table instead would lose
        exactly the work the record exists to protect.

        Returns:
            The reconciled records, so the UI can list what was lost.
        """
        ...

    def prune(self, *, older_than_ms: int) -> int:
        """Delete terminal records finished before ``older_than_ms``.

        Job history accumulates: a month of exports and transcriptions is
        thousands of rows.  Only terminal records go, so a crash cannot
        disappear a job that might still be resumable.  Returns the number
        deleted.
        """
        ...
