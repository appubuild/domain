"""The jobs port contract, driven by an executor that needs no threads.

The doubles here run a job body on the calling thread, which is both the
deterministic test double *and* a legitimate implementation of the port — the
one a CLI, a plugin host or a unit test binds.  Everything the contract promises
is therefore exercised for real: cancellation is cooperatively observed,
progress is throttled by the same L1 policy the production adapter uses, a dead
worker becomes a value, and the record is durable before the work starts.

The rules pinned are the ones that decide whether background work is survivable:

* **Cancellation is cooperative and reported, not thrown** — a body that polls
  ``is_cancelled`` ends as ``NS-JOB-5005`` and lists no artefacts.
* **A dead worker is a value** — an exception raised inside a job never escapes
  ``submit``; a lost worker is ``NS-JOB-5003``, and whether to retry is the
  scheduler's decision, made with ``core.jobs`` policy rather than here.
* **Progress is throttled, never silenced at the edges** — twenty reports at one
  instant become one message, but a stage change and the final report always
  arrive.
* **Nothing runs before it is recorded** — the record exists in the store before
  the body is called, which is what makes post-crash reporting possible.
* **The UI subscribes** — the observer sees the whole life of a job; polling is
  the resync path, not the steady state.

Purity is checked by parsing the port's imports: an adapter may name
``concurrent.futures``, ``multiprocessing`` or ``psutil``, but the seam may not.
"""

from __future__ import annotations

import pathlib
from typing import TYPE_CHECKING, Any

import pytest

from nova_studio.core import (
    ErrorDomain,
    NovaInvariantError,
    Result,
    error_result,
    ok,
)
from nova_studio.core.jobs import (
    DEFAULT_GRACE_PERIOD_MS,
    Affinity,
    JobOutcome,
    JobProgress,
    JobRecord,
    JobSpec,
    JobStatus,
    PoolCapacity,
    ProgressThrottle,
)
from nova_studio.ports.jobs import (
    JobBody,
    JobContext,
    JobErrorCode,
    JobExecutor,
    JobHandle,
    JobObserver,
    JobStore,
    Unsubscribe,
)

if TYPE_CHECKING:
    from collections.abc import Callable, Mapping

pytestmark = pytest.mark.unit


class WorkerDiedError(Exception):
    """What a process pool raises when the worker disappears.

    Raised by a job body in these tests to stand in for a segfaulting codec or
    an OOM kill, which is the one failure an inline executor cannot produce on
    its own.
    """


# -- doubles ------------------------------------------------------------------


class RecordingObserver:
    """The stand-in for the WebSocket bridge: it only records what it was told."""

    def __init__(self) -> None:
        self.progress: list[tuple[str, JobProgress]] = []
        self.statuses: list[JobRecord] = []

    def on_progress(self, job_id: str, progress: JobProgress) -> None:
        self.progress.append((job_id, progress))

    def on_status(self, record: JobRecord) -> None:
        self.statuses.append(record)


class MemoryJobStore:
    """Job history in a dict — the double, and what an in-memory adapter looks like."""

    def __init__(self) -> None:
        self.rows: dict[str, JobRecord] = {}
        self.writes = 0

    def put(self, record: JobRecord) -> Result[None]:
        self.rows[record.job_id] = record
        self.writes += 1
        return ok(None)

    def get(self, job_id: str) -> JobRecord | None:
        return self.rows.get(job_id)

    def active(self) -> tuple[JobRecord, ...]:
        return tuple(record for record in self.rows.values() if record.is_active)

    def by_kind(self, kind: str, *, limit: int = 50) -> tuple[JobRecord, ...]:
        matching = [record for record in self.rows.values() if record.kind == kind]
        matching.sort(key=lambda record: record.submitted_ms, reverse=True)
        return tuple(matching[:limit])

    def reconcile_interrupted(self) -> tuple[JobRecord, ...]:
        reconciled: list[JobRecord] = []
        for job_id, record in list(self.rows.items()):
            if record.is_active:
                after_start = max(record.submitted_ms, record.started_ms or 0)
                interrupted = record.interrupted(after_start + 1)
                self.rows[job_id] = interrupted
                reconciled.append(interrupted)
        return tuple(reconciled)

    def prune(self, *, older_than_ms: int) -> int:
        keep = {
            job_id: record
            for job_id, record in self.rows.items()
            if record.is_active or record.finished_ms is None or record.finished_ms >= older_than_ms
        }
        removed = len(self.rows) - len(keep)
        self.rows = keep
        return removed


class FakeContext:
    """What a job body is handed by :class:`InlineExecutor`."""

    def __init__(
        self,
        job_id: str,
        spec: JobSpec,
        *,
        cancelled: bool = False,
        on_report: Callable[[JobProgress], None] | None = None,
        on_checkpoint: Callable[[Mapping[str, object]], None] | None = None,
    ) -> None:
        self._job_id = job_id
        self._spec = spec
        self._cancelled = cancelled
        self._on_report = on_report
        self._on_checkpoint = on_checkpoint
        self.reported: list[JobProgress] = []
        self.checkpoints: list[Mapping[str, object]] = []
        self.heartbeats = 0

    @property
    def job_id(self) -> str:
        return self._job_id

    @property
    def spec(self) -> JobSpec:
        return self._spec

    def is_cancelled(self) -> bool:
        return self._cancelled

    def report(self, progress: JobProgress) -> None:
        self.reported.append(progress)
        if self._on_report is not None:
            self._on_report(progress)

    def checkpoint(self, state: Mapping[str, object]) -> None:
        self.checkpoints.append(state)
        if self._on_checkpoint is not None:
            self._on_checkpoint(state)

    def heartbeat(self) -> None:
        self.heartbeats += 1


class InlineHandle:
    """The submitter's token for an already-finished inline job."""

    def __init__(self, record: JobRecord, result: Result[JobOutcome], spec: JobSpec) -> None:
        self._record = record
        self._result = result
        self._spec = spec
        self.cancellations: list[int | None] = []

    @property
    def job_id(self) -> str:
        return self._record.job_id

    @property
    def spec(self) -> JobSpec:
        return self._spec

    def status(self) -> JobStatus:
        return self._record.status

    def progress(self) -> JobProgress:
        return self._record.progress

    def record(self) -> JobRecord:
        return self._record

    def cancel(self, *, grace_period_ms: int | None = None) -> Result[None]:
        self.cancellations.append(grace_period_ms)
        return error_result(
            JobErrorCode.JOB_FAILED,
            f"job {self._record.job_id} has already finished",
            domain=ErrorDomain.JOB,
        )

    def wait(self, timeout_ms: int | None = None) -> Result[JobOutcome]:
        return self._result


class InlineExecutor:
    """Run a job body on the calling thread.

    Deterministic, dependency-free and a real implementation of the port: the
    one a test, a CLI or a single-threaded plugin host binds.  It uses the same
    :class:`ProgressThrottle` a pooled adapter would, so the rate limit asserted
    here is the rate limit that ships.

    The one simplification: "queued" and "finished" coincide, because there is
    no pool.  That is a property of this double, not of the contract — an
    adapter returning from :meth:`submit` before the job runs is equally
    correct, and more usual.
    """

    def __init__(
        self,
        store: MemoryJobStore | None = None,
        *,
        capacity: PoolCapacity | None = None,
        fail_next_with: JobErrorCode | None = None,
        cancelled: bool = False,
    ) -> None:
        self.store = store or MemoryJobStore()
        self._capacity = capacity or PoolCapacity(threads=1, processes=1, gpu=0, io=1)
        self._observers: list[JobObserver] = []
        self.now_ms = 1_000
        self.fail_next_with = fail_next_with
        #: Set to simulate a cancel that arrives before the job starts polling.
        self.cancelled = cancelled
        self.submitted: list[JobSpec] = []
        self.contexts: list[FakeContext] = []
        self._count = 0

    def submit(
        self,
        spec: JobSpec,
        body: JobBody,
        *,
        job_id: str | None = None,
        params_hash: str = "",
    ) -> Result[JobHandle]:
        self.submitted.append(spec)
        if self.fail_next_with is not None:
            refusal = self.fail_next_with
            self.fail_next_with = None
            return error_result(
                refusal,
                f"refused by the double: {refusal}",
                domain=ErrorDomain.JOB,
            )

        self._count += 1
        job_id = job_id or f"job-{self._count}"
        # Rule 4: the record is durable before the work starts.
        record = JobRecord(
            job_id=job_id,
            kind=spec.kind,
            submitted_ms=self.now_ms,
            priority=spec.priority,
            params_hash=params_hash,
        )
        self.store.put(record)

        if spec.affinity is Affinity.GPU and self._capacity.gpu == 0:
            return error_result(
                JobErrorCode.KIND_DISABLED,
                f"{spec.kind} has no capacity on this machine",
                domain=ErrorDomain.JOB,
            )

        record = record.started(self.now_ms, attempt=1)
        self.store.put(record)
        self._notify_status(record)

        throttle = ProgressThrottle(max_hz=spec.max_progress_hz)
        last_stage = ""

        def publish(progress: JobProgress) -> None:
            nonlocal last_stage, record
            important = progress.stage != last_stage or progress.is_complete
            last_stage = progress.stage
            if not throttle.should_emit(self.now_ms, important=important):
                return
            throttle.note(self.now_ms)
            record = record.with_progress(progress)
            self.store.put(record)
            for observer in self._observers:
                observer.on_progress(job_id, progress)

        def checkpoint(state: Mapping[str, object]) -> None:
            nonlocal record
            record = record.with_checkpoint(state)
            self.store.put(record)

        context = FakeContext(
            job_id,
            spec,
            cancelled=self.cancelled,
            on_report=publish,
            on_checkpoint=checkpoint,
        )
        self.contexts.append(context)

        try:
            result = body(context)
        except WorkerDiedError:
            result = error_result(
                JobErrorCode.WORKER_LOST,
                f"the worker running {spec.kind} died",
                domain=ErrorDomain.JOB,
                retryable=True,
            )
        except TimeoutError:
            result = error_result(
                JobErrorCode.TIMED_OUT,
                f"{spec.kind} overran its deadline",
                domain=ErrorDomain.JOB,
            )

        self.now_ms += 1
        if result.is_ok():
            outcome = result.unwrap()
            record = record.succeeded(self.now_ms, artefacts=outcome.artefacts)
        else:
            error = result.unwrap_err()
            if error.code == JobErrorCode.CANCELLED:
                record = record.cancelled(self.now_ms)
            else:
                record = record.failed(self.now_ms, code=error.code, message=error.message)
        self.store.put(record)
        self._notify_status(record)
        return ok(InlineHandle(record, result, spec))

    def _notify_status(self, record: JobRecord) -> None:
        for observer in self._observers:
            observer.on_status(record)

    def subscribe(self, observer: JobObserver) -> Unsubscribe:
        self._observers.append(observer)

        def unsubscribe() -> None:
            self._observers.remove(observer)

        return unsubscribe

    def running(self) -> tuple[JobRecord, ...]:
        return self.store.active()

    def capacity(self) -> PoolCapacity:
        return self._capacity

    def cancel_all(self, *, reason: str = "shutdown") -> int:
        return len(self.store.active())

    def drain(self, timeout_ms: int | None = None) -> bool:
        return True

    def shutdown(self, *, grace_period_ms: int = DEFAULT_GRACE_PERIOD_MS) -> Result[None]:
        return ok(None)


# -- helpers ------------------------------------------------------------------


def _spec(kind: str = "export.mp4", **overrides: Any) -> JobSpec:
    return JobSpec(**{"kind": kind, **overrides})


def _counting_body(upto: int = 5, *, stage: str = "encoding") -> JobBody:
    def body(ctx: JobContext) -> Result[JobOutcome]:
        for index in range(upto):
            ctx.report(JobProgress(fraction=(index + 1) / upto, stage=stage))
        return ok(JobOutcome(artefacts=("/tmp/out.mp4",), detail=f"{upto} units"))

    return body


# -- tests --------------------------------------------------------------------


class TestProtocolConformance:
    def test_each_double_satisfies_its_port(self) -> None:
        assert isinstance(InlineExecutor(), JobExecutor)
        assert isinstance(InlineExecutor().submit(_spec(), _counting_body()).unwrap(), JobHandle)
        assert isinstance(RecordingObserver(), JobObserver)
        assert isinstance(MemoryJobStore(), JobStore)
        assert isinstance(FakeContext("job-1", _spec()), JobContext)


class TestNarrowness:
    def test_an_executor_is_not_a_handle(self) -> None:
        assert not isinstance(InlineExecutor(), JobHandle)

    def test_a_store_is_not_an_observer(self) -> None:
        assert not isinstance(MemoryJobStore(), JobObserver)

    def test_a_partial_double_is_refused(self) -> None:
        class AlmostAnExecutor:
            def submit(self, spec: JobSpec, body: JobBody) -> Result[JobHandle]:
                raise NotImplementedError

        assert not isinstance(AlmostAnExecutor(), JobExecutor)

    def test_a_context_without_checkpoint_is_incomplete(self) -> None:
        """A job that cannot leave a resume point is not the contracted context."""

        class ThinContext:
            @property
            def job_id(self) -> str:
                return "job-1"

            @property
            def spec(self) -> JobSpec:
                return _spec()

            def is_cancelled(self) -> bool:
                return False

            def report(self, progress: JobProgress) -> None:
                return None

            def heartbeat(self) -> None:
                return None

        assert not isinstance(ThinContext(), JobContext)


class TestRuntimeCheckableLimitations:
    def test_a_double_with_the_right_names_and_wrong_behaviour_passes(self) -> None:
        class WrongStore:
            def put(self, record: JobRecord) -> Result[None]:
                return ok(None)

            def get(self, job_id: str) -> JobRecord | None:
                return None

            def active(self) -> tuple[JobRecord, ...]:
                return ()

            def by_kind(self, kind: str, *, limit: int = 50) -> tuple[JobRecord, ...]:
                return ()

            def reconcile_interrupted(self) -> tuple[JobRecord, ...]:
                return ()

            def prune(self, *, older_than_ms: int) -> int:
                return 0

        assert isinstance(WrongStore(), JobStore)

    def test_the_mistake_surfaces_at_the_call_not_at_the_check(self) -> None:
        class WrongObserver:
            def on_progress(self, job_id: str, progress: JobProgress) -> None:
                raise AssertionError("an observer must never raise into a worker")

            def on_status(self, record: JobRecord) -> None:
                return None

        assert isinstance(WrongObserver(), JobObserver)
        executor = InlineExecutor()
        executor.subscribe(WrongObserver())
        with pytest.raises(AssertionError):
            executor.submit(_spec(), _counting_body())


class TestErrorCodes:
    def test_codes_are_stable_strings(self) -> None:
        assert JobErrorCode.QUEUE_FULL == "NS-JOB-5001"
        assert JobErrorCode.KIND_DISABLED == "NS-JOB-5002"
        assert JobErrorCode.WORKER_LOST == "NS-JOB-5003"
        assert JobErrorCode.TIMED_OUT == "NS-JOB-5004"
        assert JobErrorCode.CANCELLED == "NS-JOB-5005"
        assert JobErrorCode.JOB_FAILED == "NS-JOB-5006"
        assert JobErrorCode.PAYLOAD_NOT_TRANSFERABLE == "NS-JOB-5007"
        assert JobErrorCode.RECORD_UNAVAILABLE == "NS-JOB-5008"

    def test_codes_are_unique_and_namespaced(self) -> None:
        values = [code.value for code in JobErrorCode]
        assert len(values) == len(set(values))
        assert all(value.startswith("NS-JOB-") for value in values)

    def test_the_domain_has_a_job_member(self) -> None:
        """The scheduler is its own subsystem, with its own remedies."""
        assert ErrorDomain.JOB == "JOB"

    def test_a_lost_worker_is_marked_retryable(self) -> None:
        error = error_result(
            JobErrorCode.WORKER_LOST,
            "the worker running export.mp4 died",
            domain=ErrorDomain.JOB,
            retryable=True,
        ).unwrap_err()
        assert error.retryable
        assert error.domain is ErrorDomain.JOB

    def test_cancellation_is_not_a_fault(self) -> None:
        """The UI says "stopped", and the severity reflects that."""
        error = error_result(
            JobErrorCode.CANCELLED, "stopped by the user", domain=ErrorDomain.JOB
        ).unwrap_err()
        assert error.code == "NS-JOB-5005"
        assert not error.retryable


class TestTheDeclaredFlow:
    def test_a_submitted_job_runs_and_returns_its_outcome(self) -> None:
        executor = InlineExecutor()
        handle = executor.submit(_spec(), _counting_body()).unwrap()
        assert handle.wait().unwrap().artefacts == ("/tmp/out.mp4",)
        assert handle.status() is JobStatus.SUCCEEDED

    def test_the_record_exists_before_the_body_runs(self) -> None:
        """Rule 4: no record, no job — post-crash reporting depends on it."""
        executor = InlineExecutor()
        seen: list[JobStatus] = []

        def body(ctx: JobContext) -> Result[JobOutcome]:
            seen.append(executor.store.get(ctx.job_id).status)
            return ok(JobOutcome())

        executor.submit(_spec(), body)
        assert seen == [JobStatus.RUNNING]

    def test_the_job_sees_only_its_context(self) -> None:
        executor = InlineExecutor()
        executor.submit(_spec(), _counting_body())
        context = executor.contexts[0]
        assert context.spec.kind == "export.mp4"
        assert context.job_id == "job-1"

    def test_the_submitter_may_name_the_job(self) -> None:
        """A resumed job keeps its id, so the UI shows one row, not two."""
        executor = InlineExecutor()
        handle = executor.submit(_spec(), _counting_body(), job_id="resumed-7").unwrap()
        assert handle.job_id == "resumed-7"

    def test_the_params_hash_is_kept_on_the_record(self) -> None:
        executor = InlineExecutor()
        handle = executor.submit(_spec(), _counting_body(), params_hash="abc123").unwrap()
        assert handle.record().params_hash == "abc123"

    def test_refusals_come_back_as_values(self) -> None:
        executor = InlineExecutor(fail_next_with=JobErrorCode.KIND_DISABLED)
        error = executor.submit(_spec(), _counting_body()).unwrap_err()
        assert error.code == JobErrorCode.KIND_DISABLED
        assert error.domain is ErrorDomain.JOB

    def test_gpu_work_is_refused_where_there_is_no_gpu(self) -> None:
        """ADR-0012 §2: rejected at admission, never halfway through."""
        executor = InlineExecutor(capacity=PoolCapacity(threads=2, processes=1, gpu=0, io=2))
        spec = _spec(kind="asr.transcribe", affinity=Affinity.GPU)
        error = executor.submit(spec, _counting_body()).unwrap_err()
        assert error.code == JobErrorCode.KIND_DISABLED

    def test_the_executor_reports_its_capacity(self) -> None:
        capacity = PoolCapacity(threads=4, processes=2, gpu=0, io=3)
        assert InlineExecutor(capacity=capacity).capacity() == capacity


class TestCancellation:
    def test_a_body_that_polls_stops_cooperatively(self) -> None:
        """Cancellation is observed by the job, never delivered as a kill."""
        stopped_at: list[int] = []

        def body(ctx: JobContext) -> Result[JobOutcome]:
            for frame in range(10):
                if ctx.is_cancelled():
                    stopped_at.append(frame)
                    return error_result(
                        JobErrorCode.CANCELLED, f"stopped at frame {frame}", domain=ErrorDomain.JOB
                    )
                ctx.report(JobProgress(fraction=frame / 10, stage="encoding"))
            return ok(JobOutcome(artefacts=("/tmp/out.mp4",)))

        result = _cancelling_executor().submit(_spec(), body).unwrap()
        assert result.wait().unwrap_err().code == JobErrorCode.CANCELLED
        assert result.status() is JobStatus.CANCELLED
        assert stopped_at == [0]

    def test_a_cancelled_job_lists_no_artefacts(self) -> None:
        """A half-written file on the desktop is worse than none."""

        def body(ctx: JobContext) -> Result[JobOutcome]:
            ctx.report(JobProgress(fraction=0.3, stage="encoding"))
            if ctx.is_cancelled():
                return error_result(JobErrorCode.CANCELLED, "stopped", domain=ErrorDomain.JOB)
            return ok(JobOutcome(artefacts=("/tmp/out.mp4",)))

        handle = _cancelling_executor().submit(_spec(), body).unwrap()
        assert handle.record().artefacts == ()

    def test_a_finished_job_cannot_be_cancelled(self) -> None:
        handle = InlineExecutor().submit(_spec(), _counting_body()).unwrap()
        error = handle.cancel().unwrap_err()
        assert error.code == JobErrorCode.JOB_FAILED

    def test_cancel_takes_a_grace_period_override(self) -> None:
        """Shutdown cannot wait the full export grace period."""
        handle = InlineExecutor().submit(_spec(), _counting_body()).unwrap()
        handle.cancel(grace_period_ms=0)
        assert handle.cancellations == [0]


def _cancelling_executor() -> InlineExecutor:
    """An executor whose jobs are cancelled before their body starts."""
    return InlineExecutor(cancelled=True)


class TestFailureIsolation:
    def test_a_dead_worker_is_a_value_not_an_exception(self) -> None:
        """A segfaulting codec must not take the editor with it."""

        def body(ctx: JobContext) -> Result[JobOutcome]:
            raise WorkerDiedError

        result = InlineExecutor().submit(_spec(), body).unwrap()
        error = result.wait().unwrap_err()
        assert error.code == JobErrorCode.WORKER_LOST
        assert error.retryable
        assert result.status() is JobStatus.FAILED

    def test_a_timeout_is_a_value(self) -> None:
        def body(ctx: JobContext) -> Result[JobOutcome]:
            raise TimeoutError

        result = InlineExecutor().submit(_spec(), body).unwrap()
        assert result.wait().unwrap_err().code == JobErrorCode.TIMED_OUT

    def test_a_job_that_fails_keeps_its_error_code(self) -> None:
        def body(ctx: JobContext) -> Result[JobOutcome]:
            return error_result(
                JobErrorCode.JOB_FAILED, "the source clip is gone", domain=ErrorDomain.JOB
            )

        handle = InlineExecutor().submit(_spec(), body).unwrap()
        assert handle.record().error_code == JobErrorCode.JOB_FAILED
        assert handle.record().error_message == "the source clip is gone"

    def test_a_failed_job_lists_no_artefacts(self) -> None:
        def body(ctx: JobContext) -> Result[JobOutcome]:
            return error_result(JobErrorCode.JOB_FAILED, "boom", domain=ErrorDomain.JOB)

        handle = InlineExecutor().submit(_spec(), body).unwrap()
        assert handle.record().artefacts == ()


class TestTheProgressChannel:
    def test_an_observer_sees_the_whole_life_of_a_job(self) -> None:
        observer = RecordingObserver()
        executor = InlineExecutor()
        executor.subscribe(observer)
        executor.submit(_spec(), _counting_body(upto=4))
        # Four reports inside the same millisecond: the first and the terminal
        # one survive the throttle, which is exactly the point — the steady
        # stream is rate-limited and the ending is never lost.
        assert [progress.fraction for _, progress in observer.progress] == [0.25, 1.0]
        assert [record.status for record in observer.statuses] == [
            JobStatus.RUNNING,
            JobStatus.SUCCEEDED,
        ]

    def test_a_storm_of_reports_is_throttled(self) -> None:
        """ADR-0010 §3: twenty reports at one instant become one message."""
        observer = RecordingObserver()
        executor = InlineExecutor()
        executor.subscribe(observer)

        def body(ctx: JobContext) -> Result[JobOutcome]:
            for index in range(20):
                ctx.report(JobProgress(fraction=index / 20, stage="encoding"))
            return ok(JobOutcome())

        executor.submit(_spec(), body)
        assert len(observer.progress) == 1

    def test_a_stage_change_is_never_swallowed(self) -> None:
        """A bar that sits still while the stage changes looks hung."""
        observer = RecordingObserver()
        executor = InlineExecutor()
        executor.subscribe(observer)

        def body(ctx: JobContext) -> Result[JobOutcome]:
            for stage in ("probing", "decoding", "encoding", "muxing"):
                ctx.report(JobProgress(fraction=0.1, stage=stage))
            return ok(JobOutcome())

        executor.submit(_spec(), body)
        assert [progress.stage for _, progress in observer.progress] == [
            "probing",
            "decoding",
            "encoding",
            "muxing",
        ]

    def test_the_final_report_always_arrives(self) -> None:
        observer = RecordingObserver()
        executor = InlineExecutor()
        executor.subscribe(observer)

        def body(ctx: JobContext) -> Result[JobOutcome]:
            ctx.report(JobProgress(fraction=0.99, stage="muxing"))
            ctx.report(JobProgress(fraction=1.0, stage="muxing"))
            return ok(JobOutcome())

        executor.submit(_spec(), body)
        assert observer.progress[-1][1].fraction == 1.0

    def test_advanced_time_lets_the_next_report_through(self) -> None:
        observer = RecordingObserver()
        executor = InlineExecutor()
        executor.subscribe(observer)

        def body(ctx: JobContext) -> Result[JobOutcome]:
            ctx.report(JobProgress(fraction=0.1, stage="encoding"))
            executor.now_ms += 100
            ctx.report(JobProgress(fraction=0.2, stage="encoding"))
            return ok(JobOutcome())

        executor.submit(_spec(), body)
        assert len(observer.progress) == 2

    def test_unsubscribing_stops_the_events(self) -> None:
        observer = RecordingObserver()
        executor = InlineExecutor()
        unsubscribe = executor.subscribe(observer)
        unsubscribe()
        executor.submit(_spec(), _counting_body())
        assert observer.progress == []
        assert observer.statuses == []

    def test_polling_is_the_resync_path_not_the_steady_state(self) -> None:
        """ADR-0010 §7: the handle answers, but the observer is how the UI learns."""
        executor = InlineExecutor()
        handle = executor.submit(_spec(), _counting_body(upto=2)).unwrap()
        assert handle.progress().fraction == 1.0
        assert handle.record().status is JobStatus.SUCCEEDED


class TestCheckpointsAndHeartbeats:
    def test_a_job_leaves_a_resume_point(self) -> None:
        def body(ctx: JobContext) -> Result[JobOutcome]:
            ctx.checkpoint({"frames": 1_842})
            return ok(JobOutcome())

        executor = InlineExecutor()
        handle = executor.submit(_spec(), body).unwrap()
        assert handle.record().checkpoint == {"frames": 1_842}

    def test_a_checkpoint_is_json_serialisable(self) -> None:
        """It is read back by a different process than the one that wrote it."""
        import json

        def body(ctx: JobContext) -> Result[JobOutcome]:
            ctx.checkpoint({"frames": 12, "stage": "encoding", "done": True})
            return ok(JobOutcome())

        handle = InlineExecutor().submit(_spec(), body).unwrap()
        checkpoint = handle.record().checkpoint
        assert json.loads(json.dumps(checkpoint)) == checkpoint

    def test_a_job_can_tell_the_supervisor_it_is_alive(self) -> None:
        def body(ctx: JobContext) -> Result[JobOutcome]:
            ctx.heartbeat()
            ctx.heartbeat()
            return ok(JobOutcome())

        executor = InlineExecutor()
        executor.submit(_spec(), body)
        assert executor.contexts[0].heartbeats == 2


class TestTheStore:
    def test_a_record_can_be_read_back(self) -> None:
        store = MemoryJobStore()
        record = JobRecord(job_id="job-1", kind="export.mp4", submitted_ms=1_000)
        store.put(record)
        assert store.get("job-1") == record

    def test_a_missing_record_is_an_ordinary_answer(self) -> None:
        assert MemoryJobStore().get("nope") is None

    def test_active_lists_only_unfinished_work(self) -> None:
        store = MemoryJobStore()
        store.put(JobRecord(job_id="a", kind="k", submitted_ms=1))
        store.put(
            JobRecord(
                job_id="b",
                kind="k",
                submitted_ms=1,
                status=JobStatus.SUCCEEDED,
                started_ms=2,
                finished_ms=3,
            )
        )
        assert [record.job_id for record in store.active()] == ["a"]

    def test_by_kind_is_newest_first_and_bounded(self) -> None:
        store = MemoryJobStore()
        for job_id, submitted in (("old", 1), ("new", 3), ("mid", 2)):
            store.put(JobRecord(job_id=job_id, kind="export.mp4", submitted_ms=submitted))
        assert [record.job_id for record in store.by_kind("export.mp4", limit=2)] == ["new", "mid"]

    def test_reconciliation_turns_a_crash_into_a_resumable_list(self) -> None:
        """ADR-0010 §6: the user is offered a resume, not an error report."""
        store = MemoryJobStore()
        store.put(
            JobRecord(
                job_id="job-9",
                kind="export.mp4",
                submitted_ms=1_000,
                status=JobStatus.RUNNING,
                started_ms=1_500,
            )
        )
        reconciled = store.reconcile_interrupted()
        assert [record.status for record in reconciled] == [JobStatus.INTERRUPTED]
        assert store.get("job-9").status is JobStatus.INTERRUPTED

    def test_pruning_never_touches_a_job_that_could_still_be_resumed(self) -> None:
        store = MemoryJobStore()
        store.put(
            JobRecord(
                job_id="done",
                kind="k",
                submitted_ms=1,
                status=JobStatus.SUCCEEDED,
                started_ms=2,
                finished_ms=100,
            )
        )
        store.put(
            JobRecord(
                job_id="running",
                kind="k",
                submitted_ms=1,
                status=JobStatus.RUNNING,
                started_ms=2,
            )
        )
        assert store.prune(older_than_ms=500) == 1
        assert store.get("running") is not None
        assert store.get("done") is None


class TestTheExecutorSurface:
    def test_running_reports_what_holds_a_slot(self) -> None:
        executor = InlineExecutor()
        executor.submit(_spec(), _counting_body())
        assert executor.running() == ()

    def test_cancel_all_reports_how_many_were_asked_to_stop(self) -> None:
        executor = InlineExecutor()
        assert executor.cancel_all(reason="closing the project") == 0

    def test_drain_says_whether_everything_finished(self) -> None:
        assert InlineExecutor().drain(timeout_ms=0) is True

    def test_shutdown_returns_ok_when_the_workers_came_back(self) -> None:
        assert InlineExecutor().shutdown().is_ok()

    def test_a_shutdown_defaults_to_the_contracted_grace_period(self) -> None:
        assert DEFAULT_GRACE_PERIOD_MS == 5_000


class TestPortPurity:
    """ADR-0010 §2: the seam may not name a pool, a process or a metric library."""

    _PATH = pathlib.Path("nova_studio/ports/jobs.py")

    def _imported_modules(self) -> list[str]:
        import ast

        tree = ast.parse(self._PATH.read_text(encoding="utf-8"))
        modules: list[str] = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                modules.extend(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                modules.append(node.module)
        return modules

    @pytest.mark.parametrize(
        "banned",
        ["concurrent", "multiprocessing", "psutil", "threading", "asyncio", "subprocess"],
    )
    def test_it_names_no_execution_library(self, banned: str) -> None:
        offenders = [name for name in self._imported_modules() if name.split(".")[0] == banned]
        assert not offenders, f"ports/jobs.py names {banned}: {offenders}"

    def test_it_imports_no_outer_ring(self) -> None:
        offenders = [
            name
            for name in self._imported_modules()
            if name.startswith(("nova_studio.infra", "nova_studio.services", "nova_studio.api"))
        ]
        assert not offenders, f"ports/jobs.py reaches into an outer ring: {offenders}"

    def test_it_speaks_in_core_job_types(self) -> None:
        assert "nova_studio.core.jobs" in self._imported_modules()

    def test_every_exported_name_is_a_declaration(self) -> None:
        import nova_studio.ports.jobs as port

        for exported in port.__all__:
            obj = getattr(port, exported)
            assert isinstance(obj, type), f"{exported} is not a class"

    def test_aliases_are_not_advertised_as_declarations(self) -> None:
        """JobBody and Unsubscribe are conveniences, not interfaces."""
        import nova_studio.ports.jobs as port

        assert "JobBody" not in port.__all__
        assert "Unsubscribe" not in port.__all__
        assert JobBody is port.JobBody
        assert Unsubscribe is port.Unsubscribe


class TestTheContractHoldsForTheDoubles:
    def test_an_invariant_violation_stays_an_exception(self) -> None:
        """Only *expected* failure is a value; a bug still raises."""
        with pytest.raises(NovaInvariantError):
            JobProgress(fraction=1.5)
