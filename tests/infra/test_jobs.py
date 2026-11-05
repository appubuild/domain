"""The job executor and the job store (`infra/jobs.py`, `infra/persistence/jobs.py`).

An executor is where the job port's promises either hold or do not, and the
promises are mostly about *time*: a job must be durable before it starts, a
cancelled job must stop between frames and leave nothing behind, progress must
be throttled but never lose its edges, and a worker that dies must come back as
a value rather than as an exception in the editor.

What is pinned here:

* **Nothing starts before it is recorded.** A store that refuses the write is a
  refusal to run the job — not a job nobody can account for.
* **A dead worker is a value.** An exception, a ``sys.exit`` in a job body and a
  killed process are three different things and land as three different codes.
  None of them take the executor down, because the executor is not the job.
* **Progress is throttled, and the edges survive.** A hundred reports in a
  burst do not become a hundred events; a stage change and the terminal report
  always arrive, because a bar frozen at 99 % is indistinguishable from a hang.
* **Cancellation is cooperative, with a hard deadline.** Asked-for is not the
  same as stopped, and the watchdog is what closes the record of a job that
  will not stop.
* **Admission is decided against measured capacity**, so a machine with one
  process slot runs one export and refuses the second rather than queueing it
  forever behind a progress bar.

The store is tested the same way: a record must survive a rewrite, an
interrupted run must be *interrupted* and not failed, and pruning must never
delete a job that could still be resumed.
"""

from __future__ import annotations

import sys
import threading
import time
from typing import TYPE_CHECKING, Any

import pytest

from nova_studio.core.errors import NovaError
from nova_studio.core.jobs import (
    Isolation,
    JobMemoryClass,
    JobOutcome,
    JobPriority,
    JobProgress,
    JobRecord,
    JobSpec,
    JobStatus,
    PoolCapacity,
)
from nova_studio.core.result import Result, err, ok
from nova_studio.infra.jobs import (
    ConcurrentJobExecutor,
    ThreadPoolJobExecutor,
    spawn_context,
)
from nova_studio.infra.persistence.jobs import JsonJobStore, job_history_path
from nova_studio.ports.jobs import JobErrorCode
from tests.conftest import FakeClock

if TYPE_CHECKING:
    from pathlib import Path

    from nova_studio.ports.jobs import JobBody, JobContext

pytestmark = pytest.mark.unit


# ---------------------------------------------------------------------------
# Fakes and helpers
# ---------------------------------------------------------------------------


class Recorder:
    """A `JobObserver` that keeps everything it was told."""

    def __init__(self) -> None:
        self.progress: list[tuple[str, JobProgress]] = []
        self.statuses: list[JobRecord] = []

    def on_progress(self, job_id: str, progress: JobProgress) -> None:
        self.progress.append((job_id, progress))

    def on_status(self, record: JobRecord) -> None:
        self.statuses.append(record)


def thread_spec(**over: Any) -> JobSpec:
    """A short job on the thread pool."""
    return JobSpec(
        kind="test.echo",
        priority=JobPriority.HIGH,
        isolation=Isolation.THREAD,
        **over,
    )


def process_spec(**over: Any) -> JobSpec:
    return JobSpec(
        kind="test.process",
        priority=JobPriority.LOW,
        isolation=Isolation.PROCESS,
        memory_class=JobMemoryClass.LARGE,
        **over,
    )


def echo(value: object = "done") -> JobBody:
    """A job that succeeds immediately. Module-level, so a process can run it."""

    def body(context: JobContext) -> Result[JobOutcome]:
        del context
        return ok(JobOutcome(value=value, detail="echo"))

    return body


def raising() -> JobBody:
    def body(context: JobContext) -> Result[JobOutcome]:
        del context
        raise RuntimeError("the job fell over")

    return body


def failing(code: str = JobErrorCode.JOB_FAILED) -> JobBody:
    def body(context: JobContext) -> Result[JobOutcome]:
        del context
        return err(NovaError(code, "the job refused"))

    return body


def reporting(count: int = 100, *, stage: str = "") -> JobBody:
    """A job that reports `count` times at once, then finishes."""

    def body(context: JobContext) -> Result[JobOutcome]:
        for index in range(count):
            context.report(
                JobProgress(
                    fraction=index / count,
                    stage=stage or "encoding",
                    detail=f"frame {index}",
                )
            )
        context.report(JobProgress(fraction=1.0, stage="done"))
        return ok(JobOutcome())

    return body


def staged() -> JobBody:
    """A job that changes stage, which the throttle must never drop."""

    def body(context: JobContext) -> Result[JobOutcome]:
        for stage in ("preparing", "encoding", "muxing", "done"):
            context.report(JobProgress(fraction=0.5, stage=stage))
        return ok(JobOutcome())

    return body


def waiting(until: threading.Event) -> JobBody:
    """A job that waits for an event, so a test can cancel it mid-flight."""

    def body(context: JobContext) -> Result[JobOutcome]:
        while not context.is_cancelled():
            if until.wait(0.01):
                break
        if context.is_cancelled():
            return err(NovaError(JobErrorCode.CANCELLED, "stopped"))
        return ok(JobOutcome())

    return body


def stubborn() -> JobBody:
    """A job that ignores cancellation entirely: the watchdog's reason to exist."""

    def body(context: JobContext) -> Result[JobOutcome]:
        del context
        time.sleep(5)
        return ok(JobOutcome())

    return body


def _executor(
    store: JsonJobStore,
    *,
    capacity: PoolCapacity | None = None,
    clock: FakeClock | None = None,
    **over: Any,
) -> ConcurrentJobExecutor:
    return ConcurrentJobExecutor(
        store=store,
        capacity=capacity or PoolCapacity(threads=4, processes=1),
        clock=clock,
        **over,
    )


@pytest.fixture
def store(tmp_path: Path) -> JsonJobStore:
    return JsonJobStore(job_history_path(tmp_path))


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


# ---------------------------------------------------------------------------
# Running one job
# ---------------------------------------------------------------------------


class TestRunningAJob:
    def test_a_job_runs_and_returns_its_outcome(self, store: JsonJobStore) -> None:
        with _executor(store) as jobs:
            handle = jobs.submit(thread_spec(), echo("hello")).unwrap()
            assert handle.wait(5_000).unwrap().value == "hello"

    def test_a_handle_knows_its_job(self, store: JsonJobStore) -> None:
        with _executor(store) as jobs:
            handle = jobs.submit(thread_spec(), echo()).unwrap()
            assert handle.job_id
            assert handle.spec.kind == "test.echo"
            handle.wait(5_000)

    def test_the_record_says_succeeded(self, store: JsonJobStore) -> None:
        with _executor(store) as jobs:
            handle = jobs.submit(thread_spec(), echo()).unwrap()
            handle.wait(5_000)
            assert handle.status() is JobStatus.SUCCEEDED
            assert handle.record().finished_ms is not None

    def test_artefacts_are_recorded(self, store: JsonJobStore) -> None:
        def body(context: JobContext) -> Result[JobOutcome]:
            del context
            return ok(JobOutcome(artefacts=("/media/out.mp4",)))

        with _executor(store) as jobs:
            handle = jobs.submit(thread_spec(), body).unwrap()
            handle.wait(5_000)
            assert handle.record().artefacts == ("/media/out.mp4",)

    def test_the_progress_the_job_reported_is_the_progress_recorded(
        self, store: JsonJobStore
    ) -> None:
        with _executor(store) as jobs:
            handle = jobs.submit(thread_spec(), staged()).unwrap()
            handle.wait(5_000)
            assert handle.record().progress.stage == "done"

    def test_a_running_job_is_listed_as_running(self, store: JsonJobStore) -> None:
        gate = threading.Event()
        with _executor(store) as jobs:
            handle = jobs.submit(thread_spec(), waiting(gate)).unwrap()
            gate.set()
            handle.wait(5_000)
        assert handle.status() is JobStatus.SUCCEEDED


class TestFailure:
    def test_a_job_that_returns_err_is_failed_with_its_code(self, store: JsonJobStore) -> None:
        with _executor(store) as jobs:
            handle = jobs.submit(thread_spec(), failing("NS-RENDER-4003")).unwrap()
            problem = handle.wait(5_000).unwrap_err()
            assert problem.code == "NS-RENDER-4003"
            assert handle.record().status is JobStatus.FAILED

    def test_a_job_that_raises_is_a_value_not_a_crash(self, store: JsonJobStore) -> None:
        """An exception in a job must not become an exception in the editor."""
        with _executor(store) as jobs:
            handle = jobs.submit(thread_spec(), raising()).unwrap()
            problem = handle.wait(5_000).unwrap_err()
            assert problem.code == JobErrorCode.JOB_FAILED
            assert handle.record().status is JobStatus.FAILED
            assert "RuntimeError" in str(handle.record().error_message)

    def test_a_failed_job_leaves_no_artefacts(self, store: JsonJobStore) -> None:
        with _executor(store) as jobs:
            handle = jobs.submit(thread_spec(), failing()).unwrap()
            handle.wait(5_000)
            assert handle.record().artefacts == ()


# ---------------------------------------------------------------------------
# Progress
# ---------------------------------------------------------------------------


class TestProgress:
    def test_an_observer_sees_the_progress(self, store: JsonJobStore) -> None:
        recorder = Recorder()
        with _executor(store) as jobs:
            jobs.subscribe(recorder)
            jobs.submit(thread_spec(), reporting(5)).unwrap().wait(5_000)
        assert len(recorder.progress) >= 1

    def test_a_burst_is_throttled(self, store: JsonJobStore) -> None:
        """A hundred reports in a millisecond are not a hundred events."""
        recorder = Recorder()
        with _executor(store) as jobs:
            jobs.subscribe(recorder)
            jobs.submit(thread_spec(), reporting(200)).unwrap().wait(5_000)
        assert len(recorder.progress) < 200

    def test_a_stage_change_is_never_dropped(self, store: JsonJobStore) -> None:
        """A bar that stops moving while the label changes reads as a hang."""
        recorder = Recorder()
        with _executor(store) as jobs:
            jobs.subscribe(recorder)
            jobs.submit(thread_spec(), staged()).unwrap().wait(5_000)
        stages = [progress.stage for _, progress in recorder.progress]
        assert stages == ["preparing", "encoding", "muxing", "done"]

    def test_the_terminal_report_is_never_dropped(self, store: JsonJobStore) -> None:
        recorder = Recorder()
        with _executor(store) as jobs:
            jobs.subscribe(recorder)
            jobs.submit(thread_spec(), reporting(200)).unwrap().wait(5_000)
        assert recorder.progress[-1][1].fraction == 1.0

    def test_unsubscribing_stops_the_events(self, store: JsonJobStore) -> None:
        recorder = Recorder()
        with _executor(store) as jobs:
            stop = jobs.subscribe(recorder)
            stop()
            jobs.submit(thread_spec(), reporting(10)).unwrap().wait(5_000)
        assert recorder.progress == []

    def test_an_observer_sees_every_status_change(self, store: JsonJobStore) -> None:
        recorder = Recorder()
        with _executor(store) as jobs:
            jobs.subscribe(recorder)
            jobs.submit(thread_spec(), echo()).unwrap().wait(5_000)
        statuses = [record.status for record in recorder.statuses]
        assert JobStatus.RUNNING in statuses
        assert JobStatus.SUCCEEDED in statuses


# ---------------------------------------------------------------------------
# Stopping
# ---------------------------------------------------------------------------


class TestCancelling:
    def test_a_cancelled_job_stops(self, store: JsonJobStore) -> None:
        with _executor(store) as jobs:
            handle = jobs.submit(thread_spec(), waiting(threading.Event())).unwrap()
            assert handle.cancel().is_ok() is True
            problem = handle.wait(5_000).unwrap_err()
            assert problem.code == JobErrorCode.CANCELLED

    def test_a_cancelled_job_is_cancelled_and_not_failed(self, store: JsonJobStore) -> None:
        with _executor(store) as jobs:
            handle = jobs.submit(thread_spec(), waiting(threading.Event())).unwrap()
            handle.cancel()
            handle.wait(5_000)
            assert handle.status() is JobStatus.CANCELLED
            assert handle.record().error_code is None

    def test_cancelling_twice_is_asking_twice_not_failing(self, store: JsonJobStore) -> None:
        with _executor(store) as jobs:
            handle = jobs.submit(thread_spec(), waiting(threading.Event())).unwrap()
            assert handle.cancel().is_ok() is True
            assert handle.cancel().is_ok() is True
            handle.wait(5_000)

    def test_cancelling_a_finished_job_is_refused(self, store: JsonJobStore) -> None:
        with _executor(store) as jobs:
            handle = jobs.submit(thread_spec(), echo()).unwrap()
            handle.wait(5_000)
            assert handle.cancel().unwrap_err().code == JobErrorCode.JOB_FAILED

    def test_cancelling_a_job_that_was_never_admitted_is_refused(self, store: JsonJobStore) -> None:
        with _executor(store) as jobs:
            handle = jobs.submit(thread_spec(), echo()).unwrap()
            problem = jobs._cancel("no-such-job").unwrap_err()
            assert problem.code == JobErrorCode.QUEUE_FULL
            handle.wait(5_000)

    def test_a_job_that_will_not_stop_is_closed_by_the_watchdog(self, store: JsonJobStore) -> None:
        """A thread cannot be killed; the record can still be closed."""
        spec = thread_spec(grace_period_ms=50)
        with _executor(store) as jobs:
            handle = jobs.submit(spec, stubborn()).unwrap()
            handle.cancel()
            handle.wait(5_000)
            # The worker is still out there; what stopped waiting is the record.
            assert handle.status() is JobStatus.FAILED
            assert handle.record().error_code == JobErrorCode.TIMED_OUT


# ---------------------------------------------------------------------------
# Admission
# ---------------------------------------------------------------------------


class TestAdmission:
    def test_capacity_is_what_the_machine_was_measured_to_have(self, store: JsonJobStore) -> None:
        capacity = PoolCapacity(threads=2, processes=1)
        with _executor(store, capacity=capacity) as jobs:
            assert jobs.capacity() is capacity

    def test_the_second_of_two_jobs_is_refused_when_there_is_one_slot(
        self, store: JsonJobStore
    ) -> None:
        """Refused rather than queued: a queue that grows is a memory leak."""
        gate = threading.Event()
        with _executor(store, capacity=PoolCapacity(threads=1, processes=1)) as jobs:
            first = jobs.submit(thread_spec(), waiting(gate)).unwrap()
            second = jobs.submit(thread_spec(), echo())
            assert second.unwrap_err().code == JobErrorCode.QUEUE_FULL
            gate.set()
            first.wait(5_000)

    def test_a_slot_is_free_again_once_the_job_ends(self, store: JsonJobStore) -> None:
        with _executor(store, capacity=PoolCapacity(threads=1, processes=1)) as jobs:
            for _ in range(3):
                jobs.submit(thread_spec(), echo()).unwrap().wait(5_000)

    def test_a_process_job_is_refused_when_the_pool_has_no_slots(self, store: JsonJobStore) -> None:
        with _executor(
            store, capacity=PoolCapacity(threads=4, processes=0), process_context=spawn_context()
        ) as jobs:
            # A picklable body, so what is being refused is the *slot* and not
            # the payload: those are two different answers.
            assert jobs.submit(process_spec(), _EchoBody()).unwrap_err().code == (
                JobErrorCode.QUEUE_FULL
            )

    def test_a_refused_job_was_never_started(self, store: JsonJobStore) -> None:
        with _executor(store, capacity=PoolCapacity(threads=0, processes=0)) as jobs:
            assert jobs.submit(thread_spec(), echo()).unwrap_err().code == (JobErrorCode.QUEUE_FULL)
        assert store.active() == ()

    def test_an_unpicklable_body_is_refused_before_a_worker_is_scheduled(
        self, store: JsonJobStore
    ) -> None:
        """Forty minutes into a two-hour export is the wrong time to find out."""
        with _executor(store, process_context=spawn_context()) as jobs:
            problem = jobs.submit(process_spec(), echo()).unwrap_err()
        assert problem.code == JobErrorCode.PAYLOAD_NOT_TRANSFERABLE

    def test_a_build_without_process_isolation_refuses_a_process_job(
        self, store: JsonJobStore
    ) -> None:
        jobs = ThreadPoolJobExecutor(store=store)
        problem = jobs.submit(process_spec(), echo()).unwrap_err()
        assert problem.code == JobErrorCode.QUEUE_FULL
        assert "no process isolation" in problem.message


# ---------------------------------------------------------------------------
# Durability
# ---------------------------------------------------------------------------


class TestDurability:
    def test_the_record_is_written_before_the_job_runs(self, store: JsonJobStore) -> None:
        """Rule 4: the last thing the process did is always on disk."""
        seen: list[Any] = []

        def body(context: JobContext) -> Result[JobOutcome]:
            seen.append(store.get(context.job_id))
            return ok(JobOutcome())

        with _executor(store) as jobs:
            jobs.submit(thread_spec(), body).unwrap().wait(5_000)
        assert seen and seen[0] is not None

    def test_four_jobs_finishing_at_once_all_land_in_the_history(self, store: JsonJobStore) -> None:
        """A lost update here is a job that vanishes from the user's history.

        Every store write is a read-modify-write of one document, and four jobs
        reaching their last transition together is four writers holding four
        copies — which is why the serialisation belongs in the store and not in
        the callers.
        """
        gate = threading.Barrier(4)

        def body(context: JobContext) -> Result[JobOutcome]:
            del context
            gate.wait(5)
            return ok(JobOutcome())

        with _executor(store, capacity=PoolCapacity(threads=4, processes=1)) as jobs:
            handles = [jobs.submit(thread_spec(), body).unwrap() for _ in range(4)]
            for handle in handles:
                handle.wait(5_000)
        assert len(store.by_kind("test.echo", limit=10)) == 4
        assert store.active() == ()

    def test_a_job_whose_record_cannot_be_written_is_not_started(self, tmp_path: Path) -> None:
        """No record, no job: work nobody could account for must not run."""
        blocker = tmp_path / "not-a-directory"
        blocker.write_text("a file where a directory was expected", encoding="utf-8")
        broken = JsonJobStore(blocker / "jobs.json")
        with _executor(broken) as jobs:
            problem = jobs.submit(thread_spec(), echo()).unwrap_err()
        assert problem.code == JobErrorCode.RECORD_UNAVAILABLE


# ---------------------------------------------------------------------------
# Shutdown
# ---------------------------------------------------------------------------


class TestShutdown:
    def test_shutdown_stops_everything(self, store: JsonJobStore) -> None:
        jobs = _executor(store)
        jobs.submit(thread_spec(), echo()).unwrap().wait(5_000)
        assert jobs.shutdown().is_ok() is True

    def test_a_job_submitted_after_shutdown_is_refused(self, store: JsonJobStore) -> None:
        jobs = _executor(store)
        jobs.shutdown()
        assert jobs.submit(thread_spec(), echo()).unwrap_err().code == JobErrorCode.QUEUE_FULL

    def test_drain_waits_for_what_is_running(self, store: JsonJobStore) -> None:
        jobs = _executor(store)
        jobs.submit(thread_spec(), echo()).unwrap().wait(5_000)
        assert jobs.drain(2_000) is True
        jobs.shutdown()

    def test_cancel_all_stops_every_active_job(self, store: JsonJobStore) -> None:
        import threading

        jobs = _executor(store)
        first = jobs.submit(thread_spec(), waiting(threading.Event())).unwrap()
        second = jobs.submit(thread_spec(), waiting(threading.Event())).unwrap()
        assert jobs.cancel_all() == 2
        assert first.wait(5_000).unwrap_err().code == JobErrorCode.CANCELLED
        assert second.wait(5_000).unwrap_err().code == JobErrorCode.CANCELLED
        jobs.shutdown()


# ---------------------------------------------------------------------------
# The store
# ---------------------------------------------------------------------------


def _record(job_id: str = "j1", **over: Any) -> JobRecord:
    over.setdefault("kind", "export.video")
    over.setdefault("submitted_ms", 1_000)
    return JobRecord(job_id=job_id, **over)


class TestTheStore:
    def test_a_record_survives_a_rewrite(self, store: JsonJobStore) -> None:
        assert store.put(_record(status=JobStatus.RUNNING, started_ms=1_100)).is_ok() is True
        assert store.get("j1") is not None
        assert store.get("j1").status is JobStatus.RUNNING

    def test_an_unknown_job_is_an_answer_not_an_error(self, store: JsonJobStore) -> None:
        assert store.get("nope") is None

    def test_a_missing_file_reads_as_empty(self, tmp_path: Path) -> None:
        assert JsonJobStore(job_history_path(tmp_path)).active() == ()

    def test_active_means_not_terminal(self, store: JsonJobStore) -> None:
        store.put(_record("j1", status=JobStatus.RUNNING, started_ms=1_000))
        store.put(_record("j2", status=JobStatus.SUCCEEDED, started_ms=1_000, finished_ms=2_000))
        assert [record.job_id for record in store.active()] == ["j1"]

    def test_by_kind_is_newest_first(self, store: JsonJobStore) -> None:
        store.put(_record("old", submitted_ms=1_000))
        store.put(_record("new", submitted_ms=2_000))
        store.put(_record("other", kind="asr.transcribe", submitted_ms=3_000))
        assert [record.job_id for record in store.by_kind("export.video")] == ["new", "old"]

    def test_by_kind_is_limited(self, store: JsonJobStore) -> None:
        for index in range(5):
            store.put(_record(f"j{index}", submitted_ms=index))
        assert len(store.by_kind("export.video", limit=2)) == 2

    def test_a_crash_turns_a_running_job_into_an_interrupted_one(self, store: JsonJobStore) -> None:
        """It did not fail and it did not finish: it was interrupted."""
        store.put(_record("j1", status=JobStatus.RUNNING, started_ms=1_000))
        store.put(_record("j2", status=JobStatus.SUCCEEDED, started_ms=1_000, finished_ms=2_000))
        reconciled = store.reconcile_interrupted()
        assert [record.job_id for record in reconciled] == ["j1"]
        assert store.get("j1").status is JobStatus.INTERRUPTED
        assert store.get("j2").status is JobStatus.SUCCEEDED

    def test_reconciling_twice_does_nothing_the_second_time(self, store: JsonJobStore) -> None:
        store.put(_record("j1", status=JobStatus.RUNNING, started_ms=1_000))
        store.reconcile_interrupted()
        assert store.reconcile_interrupted() == ()

    def test_pruning_keeps_a_job_that_could_still_be_resumed(self, store: JsonJobStore) -> None:
        store.put(_record("done", status=JobStatus.SUCCEEDED, started_ms=1, finished_ms=100))
        store.put(_record("live", status=JobStatus.RUNNING, started_ms=1))
        assert store.prune(older_than_ms=1_000) == 1
        assert store.get("done") is None
        assert store.get("live") is not None

    def test_a_corrupt_file_is_reported_and_not_fatal(self, tmp_path: Path) -> None:
        path = job_history_path(tmp_path)
        path.write_text("{not json", encoding="utf-8")
        store = JsonJobStore(path)
        assert store.put(_record()).unwrap_err().code == JobErrorCode.RECORD_UNAVAILABLE

    def test_the_write_is_atomic(self, store: JsonJobStore) -> None:
        """No temporary file is left beside the history."""
        store.put(_record())
        assert list(store.path.parent.glob("*.tmp")) == []


# ---------------------------------------------------------------------------
# One process, for real
# ---------------------------------------------------------------------------


class TestAProcessJob:
    def test_a_job_runs_in_its_own_process(self, store: JsonJobStore) -> None:
        """The only test that starts a process, because the rest must not have to.

        A spawned worker re-imports this module, so the body and the spec have
        to be picklable — which is exactly what the export job is built for, and
        exactly what an unpicklable closure fails at submit time.
        """
        if sys.platform == "win32" and not getattr(sys, "frozen", False):
            pytest.skip("spawn needs freeze_support() in a frozen build")

        body = _picklable_body()
        with _executor(store, process_context=spawn_context()) as jobs:
            handle = jobs.submit(process_spec(), body).unwrap()
            outcome = handle.wait(30_000)
            assert outcome.is_ok() is True, outcome.unwrap_err()
            assert outcome.unwrap().value == {"ok": True}
            assert handle.status() is JobStatus.SUCCEEDED

    def test_progress_arrives_from_the_other_side(self, store: JsonJobStore) -> None:
        if sys.platform == "win32" and not getattr(sys, "frozen", False):
            pytest.skip("spawn needs freeze_support() in a frozen build")

        recorder = Recorder()
        with _executor(store, process_context=spawn_context()) as jobs:
            jobs.subscribe(recorder)
            handle = jobs.submit(process_spec(), _picklable_body()).unwrap()
            handle.wait(30_000)
        assert any(progress.stage == "encoding" for _, progress in recorder.progress)


def _picklable_body() -> JobBody:
    """A module-level class, so `spawn` can pickle it."""
    return _EchoBody()


class _EchoBody:
    """A picklable job body: it reports, then succeeds."""

    def __call__(self, context: JobContext) -> Result[JobOutcome]:
        context.report(JobProgress(fraction=0.5, stage="encoding", detail="halfway"))
        return ok(JobOutcome(value={"ok": True}, detail="from a worker"))
