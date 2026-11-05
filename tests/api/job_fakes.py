"""One fake executor, for the tests that pin the job *contract* rather than the pool.

The router tests here are about what an HTTP response says. What they must not
depend on is whether a worker started, how long it took, or whether FFmpeg is
installed — those are the executor's own questions, and `tests/infra/test_jobs.py`
asks them of the real thing with real processes.

So this is a stand-in with the executor's shape and none of its machinery:

* it answers `submit` with a record in the **real** store, so the history
  endpoints are exercised against the same file format production writes;
* it refuses on cue, so the 503 and 409 paths are reachable without arranging a
  real full pool;
* it remembers what it was handed, so a test can assert that a request which
  should not have started a job did not start one.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from nova_studio.core.errors import NovaError
from nova_studio.core.jobs import JobProgress, JobRecord, JobSpec, JobStatus
from nova_studio.core.result import Result, err, ok

if TYPE_CHECKING:
    from nova_studio.ports.jobs import JobHandle, JobObserver, JobStore, Unsubscribe

__all__ = ["FakeExecutor", "FakeHandle", "record_of"]


def record_of(
    job_id: str,
    kind: str,
    *,
    status: JobStatus = JobStatus.RUNNING,
    submitted_ms: int = 1_000,
    progress: JobProgress | None = None,
) -> JobRecord:
    """One record in a given state, for a test to put in the history."""
    started = submitted_ms + 10
    finished = None if status.is_active else submitted_ms + 200
    return JobRecord(
        job_id=job_id,
        kind=kind,
        submitted_ms=submitted_ms,
        status=status,
        started_ms=None if status is JobStatus.PENDING else started,
        finished_ms=finished,
        progress=progress if progress is not None else JobProgress(),
        error_code="NS-JOB-5006" if status is JobStatus.FAILED else None,
    )


@dataclass(slots=True)
class FakeHandle:
    """The handle a submitted job gets: enough for a router to read a status.

    `status`, `progress` and `record` are **methods**, as the port declares
    them, not properties — a handle is a live thing you ask, and a test double
    that answered as a property would pass here and fail against the real
    adapter, which is the worst way for a fake to be wrong.
    """

    job_id: str
    spec: JobSpec
    current: JobRecord
    cancelled: bool = False

    def status(self) -> JobStatus:
        return self.current.status

    def progress(self) -> JobProgress:
        return self.current.progress

    def record(self) -> JobRecord:
        return self.current

    def cancel(self, *, grace_period_ms: int | None = None) -> Result[None]:
        """Note the ask. The real one arms a watchdog; this only has to answer."""
        self.cancelled = True
        return ok(None)

    def wait(self, timeout_ms: int | None = None) -> Result[Any]:
        """Never called by a router — an endpoint that waits is a hang."""
        return err(  # pragma: no cover — a router must not ask
            _refused_nowhere("no test waits on a fake handle")
        )


def _refused_nowhere(why: str) -> NovaError:
    return NovaError("NS-JOB-5001", why)


@dataclass(slots=True)
class FakeExecutor:
    """Stands in for `ConcurrentJobExecutor` in a router test.

    Attributes:
        store: The real history, so the file format is under test too.
        refuse: A `NovaError` every `submit` returns, when a test wants the
            refusal path.
        now: What `now_ms()` answers, fixed so an elapsed time is assertable.
    """

    store: JobStore
    refuse: NovaError | None = None
    refuse_cancel: NovaError | None = None
    now: int = 5_000
    submitted: list[tuple[JobSpec, Any, str]] = field(default_factory=list)
    cancelled: list[str] = field(default_factory=list)
    _records: dict[str, JobRecord] = field(default_factory=dict)
    _handles: dict[str, FakeHandle] = field(default_factory=dict)
    _counter: int = 0

    # -- what the router calls ---------------------------------------------

    def submit(
        self,
        spec: JobSpec,
        body: Any,
        *,
        job_id: str | None = None,
        params_hash: str = "",
    ) -> Result[JobHandle]:
        """Accept — or refuse on cue — and write the record either way not at all.

        A refusal starts nothing and records nothing, which is the property the
        503 test asserts: a client that was told "busy" may submit again.
        """
        if self.refuse is not None:
            return err(self.refuse)
        self._counter += 1
        identifier = job_id or f"job-{self._counter:04d}"
        record = JobRecord(
            job_id=identifier,
            kind=spec.kind,
            submitted_ms=self.now,
            status=JobStatus.PENDING,
            params_hash=params_hash,
        )
        self._records[identifier] = record
        self._handles[identifier] = FakeHandle(identifier, spec, current=record)
        self.submitted.append((spec, body, params_hash))
        return ok(self._handles[identifier])

    def record_for(self, job_id: str) -> JobRecord | None:
        """Memory first, then the store — the same order the real one uses."""
        return self._records.get(job_id) or self.store.get(job_id)

    def cancel(self, job_id: str, *, grace_period_ms: int | None = None) -> Result[None]:
        """Note the ask, and answer as the real one does for a job it holds."""
        if self.refuse_cancel is not None:
            return err(self.refuse_cancel)
        handle = self._handles.get(job_id)
        if handle is None:
            return err(_refused_nowhere(f"no job {job_id!r} was ever admitted"))
        self.cancelled.append(job_id)
        return handle.cancel(grace_period_ms=grace_period_ms)

    def cancel_all(self, *, reason: str = "shutdown") -> int:
        return 0

    def reconcile_interrupted(self) -> tuple[JobRecord, ...]:
        return self.store.reconcile_interrupted()

    def subscribe(self, observer: JobObserver) -> Unsubscribe:
        """Nothing to observe: the bridge has its own tests."""

        def unsubscribe() -> None:
            return None

        return unsubscribe

    def shutdown(self, *, grace_period_ms: int = 5_000) -> Result[None]:
        return ok(None)

    def now_ms(self) -> int:
        return self.now

    # -- what a test calls -------------------------------------------------

    def finish(self, job_id: str, record: JobRecord) -> None:
        """Put a job in a state, in memory and in the history."""
        self._records[job_id] = record
        self.store.put(record)
