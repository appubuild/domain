"""L4 — the pools: where a job body actually runs.

:class:`~nova_studio.ports.jobs.JobExecutor` is the only protocol in the job
port with real machinery behind it, and this is that machinery: a thread pool
for short work, a **process per job** for long CPU-bound work, a cancellation
token per job, a watchdog with a hard deadline, a progress throttle per job,
and a record written through a :class:`~nova_studio.ports.jobs.JobStore`
*before* the work is allowed to start.

What it deliberately does **not** decide: admission policy, retry backoff and
the circuit breaker are pure functions and state machines in
:mod:`nova_studio.core.jobs`. This module runs
:func:`~nova_studio.core.jobs.decide_admission` against the capacity it was
given and reports what happened; whether a failure deserves another attempt is
the scheduler's call, made from the record this leaves behind.

**Why a process per job and not a process pool.** ``ProcessPoolExecutor`` gives
a worker no way to send anything home until it returns: progress, stage changes
and checkpoints would all arrive at the end, which is the refresh-timer UI
ADR-0010 §7 rules out. So a process job gets its own process, an inherited
:class:`multiprocessing.Queue` for progress and an inherited
:class:`multiprocessing.Event` for cancellation. The costs are real and worth
naming: a process start is ~50 ms on Linux and ~300 ms on Windows, which is
nothing against an export measured in minutes and everything against a
thumbnail job — which is why short work stays on threads.

The seven promises this makes, which are the port's contract rules:

1. **Nothing starts before it is durable.** The record is written first; a job
   whose history cannot be recorded is refused rather than run.
2. **Cancellation is cooperative, with a hard deadline.** A job polls
   ``context.is_cancelled()``. After the grace period a *process* is terminated
   — the one place a job can truly be killed — and a *thread* is abandoned:
   its record is closed and the UI stops waiting, because Python cannot kill a
   thread and pretending otherwise is worse than saying so.
3. **Progress is throttled, but never lost at the edges.** A stage change and
   the terminal report are always published: a bar frozen at 99 % is
   indistinguishable from a hang.
4. **A dead worker is a value.** An exception escaping a body becomes
   ``Err(NS-JOB-5006)``; a worker that died becomes ``Err(NS-JOB-5003)``.
   Neither takes the editor down.
5. **A process job's payload is checked at submit time.** Unpicklable work is
   refused *before* anything is scheduled, not forty minutes into a two-hour
   export.
6. **The UI subscribes; it does not poll.** Observers are called on every
   transition, so a WebSocket bridge fans events out and a client that
   reconnects can resync from the last one.
7. **Shutdown is bounded.** :meth:`shutdown` cancels what is running, waits the
   grace period, and reports ``Err(NS-JOB-5004)`` when something did not come
   back — a process that will not exit is a support ticket with a diagnosis
   attached, not something to swallow.

Threading: one lock guards the tables; observers are called **outside** it, and
on the calling thread, which is why an observer must not block.
"""

from __future__ import annotations

import contextlib
import pickle
import queue as _queue
import threading
from concurrent.futures import (
    BrokenExecutor,
    Executor,
    Future,
    ThreadPoolExecutor,
)
from typing import TYPE_CHECKING, Any

from nova_studio.core.clock import SystemClock
from nova_studio.core.errors import NovaError, NovaInvariantError
from nova_studio.core.ident import new_entity_id
from nova_studio.core.jobs import (
    AdmissionVerdict,
    Isolation,
    JobOutcome,
    JobProgress,
    JobRecord,
    JobSpec,
    JobStatus,
    PoolCapacity,
    ProgressThrottle,
    decide_admission,
)
from nova_studio.core.result import Result, err, ok
from nova_studio.ports.jobs import JobErrorCode, Unsubscribe

if TYPE_CHECKING:
    from collections.abc import Callable, Mapping

    from nova_studio.ports.clock import Clock
    from nova_studio.ports.jobs import JobBody, JobObserver, JobStore

__all__ = ["ConcurrentJobExecutor", "JobHandle", "ThreadPoolJobExecutor"]


#: What a job that raised is recorded as. The traceback is developer-facing;
#: the UI re-renders from the code.
_FAULT_MESSAGE: str = "the job raised an exception"

#: How long the reader thread waits before checking whether it should stop, so
#: that shutting the executor down does not wait on a queue that has gone quiet.
_READER_TICK_SECONDS: float = 0.05


# ---------------------------------------------------------------------------
# What a job is handed
# ---------------------------------------------------------------------------


class _Context:
    """What a running job is handed (port rule: and nothing else).

    Three channels — a flag, a megaphone and a notebook — and no way to reach
    the pools, the store, the clock or another job. That is what allows a job
    body to be tested by calling it directly, and what stops a body from
    quietly depending on state it will not have in a worker process.
    """

    __slots__ = (
        "_alive",
        "_checkpoint",
        "_checkpoint_fn",
        "_clock",
        "_is_cancelled",
        "_job_id",
        "_publish",
        "_spec",
        "_stage",
        "_throttle",
    )

    def __init__(
        self,
        *,
        job_id: str,
        spec: JobSpec,
        is_cancelled: Callable[[], bool],
        publish: Callable[[str, JobProgress], None],
        checkpoint: Callable[[str, Mapping[str, object]], None],
        clock: Clock,
        heartbeat: Callable[[], None] | None = None,
    ) -> None:
        self._job_id = job_id
        self._spec = spec
        self._is_cancelled = is_cancelled
        self._publish = publish
        self._checkpoint_fn = checkpoint
        self._clock = clock
        self._throttle = ProgressThrottle(max_hz=spec.max_progress_hz)
        self._checkpoint = ProgressThrottle(max_hz=1)
        self._stage = ""
        self._alive = heartbeat if heartbeat is not None else _noop

    @property
    def job_id(self) -> str:
        return self._job_id

    @property
    def spec(self) -> JobSpec:
        return self._spec

    def is_cancelled(self) -> bool:
        return self._is_cancelled()

    def report(self, progress: JobProgress) -> None:
        important = progress.stage != self._stage or progress.is_complete
        now_ms = self._clock.now_ms()
        if not self._throttle.should_emit(now_ms, important=important):
            return
        self._throttle.note(now_ms)
        self._stage = progress.stage
        self._publish(self._job_id, progress)

    def checkpoint(self, state: Mapping[str, object]) -> None:
        now_ms = self._clock.now_ms()
        if not self._checkpoint.should_emit(now_ms):
            return
        self._checkpoint.note(now_ms)
        self._checkpoint_fn(self._job_id, dict(state))

    def heartbeat(self) -> None:
        """Tell the supervisor this job is alive and must not be reaped.

        A long GPU wait or a slow network fetch looks exactly like a hang from
        the outside; this is how the job says it is not one.
        """
        self._alive()


def _run_body(
    body: JobBody,
    context: _Context,
) -> Result[JobOutcome]:
    """Call one job body and turn anything it throws into a value.

    A job that raises must not take the worker with it, and it must not take
    the editor either: an exception is recorded as ``NS-JOB-5006``, which is a
    fault of the job and not of the machine running it. ``KeyboardInterrupt``
    and ``SystemExit`` are re-raised, because those are not the job's to
    swallow.
    """
    try:
        return body(context)
    except (KeyboardInterrupt, SystemExit):
        raise
    except BaseException as error:
        # The exception goes in the message as well as the cause: a history row
        # that says only "the job raised" is a row nobody can act on.
        return err(
            NovaError(
                JobErrorCode.JOB_FAILED,
                f"{_FAULT_MESSAGE}: {error!r}",
                cause=repr(error),
            )
        )


# ---------------------------------------------------------------------------
# The submitter's token
# ---------------------------------------------------------------------------


class JobHandle:
    """The submitter's token: cancel it, wait for it, or catch up with it.

    A handle outlives the run — it is how a client that has just reconnected
    finds out where a job got to, and how shutdown asks everything to stop.
    """

    __slots__ = ("_executor", "_future", "_job_id", "_spec")

    def __init__(
        self,
        *,
        executor: ConcurrentJobExecutor,
        job_id: str,
        spec: JobSpec,
        future: Future[Result[JobOutcome]],
    ) -> None:
        self._executor = executor
        self._job_id = job_id
        self._spec = spec
        self._future = future

    @property
    def job_id(self) -> str:
        return self._job_id

    @property
    def spec(self) -> JobSpec:
        return self._spec

    def status(self) -> JobStatus:
        return self._executor._status_of(self._job_id)

    def progress(self) -> JobProgress:
        return self._executor._progress_of(self._job_id)

    def record(self) -> JobRecord:
        return self._executor._record_of(self._job_id)

    def cancel(self, *, grace_period_ms: int | None = None) -> Result[None]:
        """Ask the job to stop, arming the watchdog (ADR-0010 §4).

        Returns ``Ok(None)`` once the request has been *made*, not once the job
        has stopped — that is what :meth:`wait` is for.
        """
        return self._executor._cancel(self._job_id, grace_period_ms=grace_period_ms)

    def wait(self, timeout_ms: int | None = None) -> Result[JobOutcome]:
        """Block until the job finishes, up to ``timeout_ms``."""
        return self._executor._wait(self._future, timeout_ms=timeout_ms)


# ---------------------------------------------------------------------------
# One job in its own process
# ---------------------------------------------------------------------------


def _process_main(
    job_id: str,
    spec: JobSpec,
    body: JobBody,
    *,
    cancel: Any,
    events: Any,
) -> None:
    """The worker side of a process job. Module-level, so ``spawn`` can find it.

    Runs the body with a context that publishes through a queue the parent is
    draining, and sends the result home the same way — the only channel a
    spawned process has until it exits.
    """

    def publish(identifier: str, progress: JobProgress) -> None:
        events.put(("progress", identifier, progress))

    def checkpoint(identifier: str, state: Mapping[str, object]) -> None:
        events.put(("checkpoint", identifier, state))

    context = _Context(
        job_id=job_id,
        spec=spec,
        is_cancelled=cancel.is_set,
        publish=publish,
        checkpoint=checkpoint,
        clock=SystemClock(),
    )
    result = _run_body(body, context)
    with contextlib.suppress(Exception):
        # A queue that has been closed means the parent is already gone.
        events.put(("result", job_id, result))


class _JobProcess:
    """One process, its queue, and the thread that drains it.

    The reader thread is the whole trick: a spawned process cannot call back
    into the parent, so progress, checkpoints and the result are *sent* and the
    parent republishes them as if they had happened locally. An observer cannot
    tell which side of the boundary a job ran on, which is the point.
    """

    def __init__(
        self,
        *,
        job_id: str,
        spec: JobSpec,
        body: JobBody,
        mp: Any,
        future: Future[Result[JobOutcome]],
        publish: Callable[[str, JobProgress], None],
        checkpoint: Callable[[str, Mapping[str, object]], None],
        settle: Callable[[str, Result[JobOutcome]], None],
        on_exit: Callable[[str], None],
    ) -> None:
        self._future = future
        self._job_id = job_id
        self._publish = publish
        self._checkpoint = checkpoint
        self._settle = settle
        self._on_exit = on_exit
        self._events: Any = mp.Queue()
        self._cancel: Any = mp.Event()
        self._process: Any = mp.Process(
            target=_process_main,
            args=(job_id, spec, body),
            kwargs={"cancel": self._cancel, "events": self._events},
            daemon=True,
        )
        self._reader = threading.Thread(
            target=self._drain, name=f"nova-job-{job_id[:8]}", daemon=True
        )
        self._done = False

    def start(self) -> None:
        self._process.start()
        self._reader.start()

    def cancel(self) -> None:
        self._cancel.set()

    def terminate(self) -> None:
        """The hard deadline. Only a process can be stopped this way."""
        with contextlib.suppress(Exception):
            self._process.terminate()

    def is_alive(self) -> bool:
        return bool(self._process.is_alive())

    @property
    def exit_code(self) -> int | None:
        code: int | None = self._process.exitcode
        return code

    def _drain(self) -> None:
        while True:
            try:
                kind, identifier, payload = self._events.get(timeout=_READER_TICK_SECONDS)
            except _queue.Empty:
                if not self._process.is_alive():
                    break
                continue
            except (EOFError, OSError, ValueError):
                break
            if kind == "progress":
                self._publish(identifier, payload)
            elif kind == "checkpoint":
                self._checkpoint(identifier, payload)
            elif kind == "result":
                self._finish(payload)
                break
        self._finish_if_orphaned()

    def _finish(self, result: Result[JobOutcome]) -> None:
        if self._done:
            return
        self._done = True
        self._settle(self._job_id, result)
        if not self._future.set_running_or_notify_cancel():
            return
        self._future.set_result(result)
        self._on_exit(self._job_id)

    def _finish_if_orphaned(self) -> None:
        """A process that died without reporting is a worker that was lost.

        A segfaulting codec, an OOM kill, a machine that slept: all of them end
        here, and all of them are ``NS-JOB-5003`` — a value the scheduler may
        retry, not an exception in the editor.
        """
        if self._done:
            return
        code = self._process.exitcode
        if code == 0:
            self._finish(err(NovaError(JobErrorCode.JOB_FAILED, "the job ended without reporting")))
            return
        self._finish(
            err(
                NovaError(
                    JobErrorCode.WORKER_LOST,
                    "the worker running this job died",
                    cause=f"exit code {code}",
                )
            )
        )

    def close(self) -> None:
        with contextlib.suppress(Exception):
            self._events.close()
        with contextlib.suppress(Exception):
            self._events.join_thread()


class ConcurrentJobExecutor:
    """Runs job bodies on threads, and long CPU-bound jobs in a process each.

    Args:
        store: Where records are written. Used *before* a job starts: no
            record, no job (port rule 4).
        capacity: The caps this machine was measured to have. Admission is
            decided against what is actually there, not against an assumption.
        clock: Injected, so a test can advance time and assert a throttle.
        thread_pool_factory: How to build the thread pool, given a worker
            count. Injected because the default starts real threads.
        process_context: The ``multiprocessing`` context a process job is
            started on. ``spawn`` everywhere it can be, because a forked worker
            inherits the parent's event loop and sockets, and a job that
            touched them would corrupt the editor rather than fail. ``None``
            disables process jobs, which is what the frozen Windows build does
            until it can call ``freeze_support()``.

    **Why two kinds of isolation.** A CPU-bound job on the thread pool starves
    the preview path (ADR-0010 §1), and ``JobSpec`` enforces the pairing: a
    ``LARGE`` job must be a process. An export is both, which is why
    :mod:`nova_studio.services.render.export` is built to be pickled.
    """

    def __init__(
        self,
        *,
        store: JobStore,
        capacity: PoolCapacity | None = None,
        clock: Clock | None = None,
        thread_pool_factory: Callable[[int], Executor] | None = None,
        process_context: Any | None = None,
    ) -> None:
        self._store = store
        self._capacity = capacity or PoolCapacity()
        self._clock: Clock = clock if clock is not None else SystemClock()
        self._thread_pool_factory = thread_pool_factory or _thread_pool
        self._process_context = process_context
        self._guard = threading.RLock()
        self._records: dict[str, JobRecord] = {}
        self._handles: dict[str, JobHandle] = {}
        self._isolations: dict[str, Isolation] = {}
        self._processes: dict[str, _JobProcess] = {}
        self._cancelled: set[str] = set()
        self._watchdogs: dict[str, threading.Timer] = {}
        self._running: dict[Isolation, int] = {}
        self._observers: list[JobObserver] = []
        self._threads: Executor | None = None
        self._accepting = True

    # -- the port ---------------------------------------------------------

    def __enter__(self) -> ConcurrentJobExecutor:
        return self

    def __exit__(self, *exc_info: object) -> None:
        """Shut the pools down, so a session cannot leak a worker.

        The ``with`` form is the one a composition root should use: an executor
        that outlives its block holds a thread pool and possibly a child
        process, and a process that will not exit is a bug report waiting to
        happen.
        """
        self.shutdown()

    def submit(
        self,
        spec: JobSpec,
        body: JobBody,
        *,
        job_id: str | None = None,
        params_hash: str = "",
    ) -> Result[JobHandle]:
        """Record, admit and start a job. See the port for the contract."""
        if not self._accepting:
            return err(_refused(JobErrorCode.QUEUE_FULL, "the executor is shutting down"))
        if spec.isolation is Isolation.PROCESS:
            if self._process_context is None:
                return err(
                    _refused(
                        JobErrorCode.QUEUE_FULL,
                        "this build offers no process isolation",
                        remedy="Run the job as a thread job, or give the executor a context.",
                    )
                )
            if not _picklable(body):
                # Refused here, not five minutes into the run (port rule 5).
                return err(
                    _refused(
                        JobErrorCode.PAYLOAD_NOT_TRANSFERABLE,
                        "this job body cannot cross the process boundary",
                        remedy="Capture data and module-level factories, not open handles.",
                    )
                )
        with self._guard:
            verdict = decide_admission(spec, self._running, {}, self._capacity)
            if verdict is not AdmissionVerdict.ADMIT:
                # DEFER is refused too: this adapter has no waiting queue, and
                # queueing is the scheduler's job. Nothing was started, so
                # submitting again is safe.
                return err(
                    _refused(
                        JobErrorCode.QUEUE_FULL,
                        f"no {spec.isolation.value} slot for {spec.kind} right now",
                    )
                )
            identifier = job_id or new_entity_id()
            record = JobRecord(
                job_id=identifier,
                kind=spec.kind,
                submitted_ms=self._clock.now_ms(),
                priority=spec.priority,
                status=JobStatus.PENDING,
                params_hash=params_hash,
            )
            written = self._store.put(record)
            if written.is_err():
                return err(written.unwrap_err())
            self._records[identifier] = record
            self._isolations[identifier] = spec.isolation
            self._running[spec.isolation] = self._running.get(spec.isolation, 0) + 1

            future: Future[Result[JobOutcome]] = Future()

            def settled(done: Future[Result[JobOutcome]], *, _id: str = identifier) -> None:
                self._settle_from(_id, done)

            # The runner settles before completing, so this is only for the
            # ways a future can end that a job body never sees: a cancellation
            # and a pool that broke underneath it.
            future.add_done_callback(settled)
            handle = JobHandle(executor=self, job_id=identifier, spec=spec, future=future)
            self._handles[identifier] = handle
            if spec.isolation is Isolation.PROCESS:
                self._start_process(identifier, spec, body, future)
            else:
                self._start_thread(identifier, spec, body, future)
            return ok(handle)

    def subscribe(self, observer: JobObserver) -> Unsubscribe:
        """Register a listener; call the result to remove it (ADR-0010 §7)."""
        with self._guard:
            self._observers.append(observer)

        def unsubscribe() -> None:
            with self._guard:
                if observer in self._observers:
                    self._observers.remove(observer)

        return unsubscribe

    def running(self) -> tuple[JobRecord, ...]:
        """The records of jobs that currently hold a slot."""
        with self._guard:
            return tuple(
                record for record in self._records.values() if record.status is JobStatus.RUNNING
            )

    def capacity(self) -> PoolCapacity:
        return self._capacity

    # -- beyond the port: what a composition root and a router need --------

    @property
    def store(self) -> JobStore:
        """The history this executor writes.

        Exposed because history must be readable when the pools are gone: a
        router listing jobs after a restart has no other way in, and a caller
        that reached around the executor to build a second store would have two
        opinions about where the file is.
        """
        return self._store

    def now_ms(self) -> int:
        """The executor's idea of now, in wall-clock milliseconds.

        Handed to callers so two consecutive responses describe elapsed time
        against the same clock, rather than each one reading its own.
        """
        return self._clock.now_ms()

    def record_for(self, job_id: str) -> JobRecord | None:
        """One record, from the table or from the history on disk.

        Memory first, then the store: a job this process started is in the
        table, and one started by a run that has since closed is only on disk —
        which is exactly the case a client reconnecting after a restart asks
        about. ``None`` is an ordinary answer, because a caller may be asking
        about an id that was pruned.
        """
        with self._guard:
            record = self._records.get(job_id)
        if record is not None:
            return record
        return self._store.get(job_id)

    def reconcile_interrupted(self) -> tuple[JobRecord, ...]:
        """Close the records a previous run left open (ADR-0010 §6).

        Called once, at startup, by the composition root. A job that was
        ``RUNNING`` when the process exited did not survive it — the worker is
        gone, and the file it may have been writing was never promoted — so the
        honest ending is ``interrupted``, not a bar that sits at 40 % forever.

        Returns:
            The records that were changed, so the caller can say how many.
            Empty on a first run, which is the ordinary case.
        """
        return self._store.reconcile_interrupted()

    def cancel(self, job_id: str, *, grace_period_ms: int | None = None) -> Result[None]:
        """Ask one job to stop, by id (ADR-0010 §4).

        The port puts ``cancel`` on the *handle*, because a handle is what a
        submitter keeps. A router only has an id — the handle lives in the
        process that submitted the job, and after a restart there is no handle
        at all — so this is the same operation addressed the way an HTTP client
        can only address it.
        """
        return self._cancel(job_id, grace_period_ms=grace_period_ms)

    def cancel_all(self, *, reason: str = "shutdown") -> int:
        """Cancel every outstanding job; return how many were asked to stop."""
        with self._guard:
            identifiers = [
                identifier for identifier, record in self._records.items() if record.is_active
            ]
        for identifier in identifiers:
            self._cancel(identifier, grace_period_ms=1)
        return len(identifiers)

    def drain(self, timeout_ms: int | None = None) -> bool:
        """Stop accepting new work and wait for what is running."""
        self._accepting = False
        deadline = None if timeout_ms is None else self._clock.monotonic() + timeout_ms / 1000.0
        while True:
            with self._guard:
                busy = any(record.is_active for record in self._records.values())
            if not busy:
                return True
            if deadline is not None and self._clock.monotonic() >= deadline:
                return False
            threading.Event().wait(0.005)

    def shutdown(self, *, grace_period_ms: int = 5_000) -> Result[None]:
        """Stop the pools, giving running jobs ``grace_period_ms`` to finish."""
        asked = self.cancel_all()
        finished = self.drain(grace_period_ms)
        with self._guard:
            processes = list(self._processes.values())
            self._processes.clear()
            threads, self._threads = self._threads, None
        for job in processes:
            if job.is_alive():
                job.terminate()
            job.close()
        if threads is not None:
            with contextlib.suppress(Exception):
                threads.shutdown(wait=False, cancel_futures=True)
        if not finished:
            return err(
                NovaError(
                    JobErrorCode.TIMED_OUT,
                    f"{asked} job(s) did not stop within {grace_period_ms} ms",
                    remedy="Some work may still be running; check the job history.",
                )
            )
        return ok(None)

    # -- starting one job -------------------------------------------------

    def _start_thread(
        self, job_id: str, spec: JobSpec, body: JobBody, future: Future[Result[JobOutcome]]
    ) -> None:
        with self._guard:
            if self._threads is None:
                self._threads = self._thread_pool_factory(max(1, self._capacity.threads))
            pool = self._threads

        def run() -> None:
            context = _Context(
                job_id=job_id,
                spec=spec,
                is_cancelled=lambda: self._is_cancelled(job_id),
                publish=self._publish_progress,
                checkpoint=self._publish_checkpoint,
                clock=self._clock,
            )
            self._transition(job_id, lambda record: record.started(self._clock.now_ms(), attempt=1))
            result = _run_body(body, context)
            # Settled before the future is completed: `wait` returning must
            # mean the record is final, not that it soon will be.
            self._settle(job_id, result)
            if future.set_running_or_notify_cancel():
                future.set_result(result)

        pool.submit(run)

    def _start_process(
        self, job_id: str, spec: JobSpec, body: JobBody, future: Future[Result[JobOutcome]]
    ) -> None:
        job = _JobProcess(
            job_id=job_id,
            spec=spec,
            body=body,
            mp=self._process_context,
            future=future,
            publish=self._publish_progress,
            checkpoint=self._publish_checkpoint,
            settle=self._settle,
            on_exit=self._forget,
        )
        with self._guard:
            self._processes[job_id] = job
        self._transition(job_id, lambda record: record.started(self._clock.now_ms(), attempt=1))
        job.start()

    # -- settling ---------------------------------------------------------

    def _settle_from(self, job_id: str, future: Future[Result[JobOutcome]]) -> None:
        """Close the record the way the job ended.

        One callback for both kinds of isolation, so a job that ran in a process
        is recorded exactly like one that ran on a thread — an observer cannot
        tell which is which, which is the point.
        """
        failure = future.exception()
        if failure is not None:
            self._settle(
                job_id,
                err(
                    NovaError(
                        JobErrorCode.WORKER_LOST
                        if _is_broken_pool(failure)
                        else JobErrorCode.JOB_FAILED,
                        "the worker running this job died"
                        if _is_broken_pool(failure)
                        else _FAULT_MESSAGE,
                        cause=repr(failure),
                    )
                ),
            )
            return
        self._settle(job_id, future.result())

    def _settle(self, job_id: str, result: Result[JobOutcome]) -> None:
        """Close the record the way the result says it ended.

        Idempotent, because two paths can reach it: the runner, which knows
        first, and the future's completion callback, which is the only one that
        hears about a cancellation. A record that is already terminal is left
        alone — a job that succeeded and then had its future cancelled did
        succeed, and the history must say so.
        """
        with self._guard:
            record = self._records.get(job_id)
            if record is not None and not record.is_active:
                return
        now_ms = self._clock.now_ms()
        if result.is_err():
            problem = result.unwrap_err()
            if problem.code == JobErrorCode.CANCELLED:
                self._transition(job_id, lambda record: record.cancelled(now_ms))
            else:
                message = problem.message
                self._transition(
                    job_id,
                    lambda record: record.failed(now_ms, code=problem.code, message=message),
                )
            return
        outcome = result.unwrap()
        artefacts = tuple(outcome.artefacts)
        self._transition(job_id, lambda record: record.succeeded(now_ms, artefacts=artefacts))

    def _forget(self, job_id: str) -> None:
        """A process job has ended: drop the machinery, keep the record."""
        with self._guard:
            job = self._processes.pop(job_id, None)
            watchdog = self._watchdogs.pop(job_id, None)
        if watchdog is not None:
            watchdog.cancel()
        if job is not None:
            job.close()

    # -- transitions and publishing ---------------------------------------

    def _transition(self, job_id: str, change: Callable[[JobRecord], JobRecord]) -> None:
        """Apply one change, persist it, then tell the observers.

        Order matters: the store first, then the observers. A record that was
        broadcast but not written is a lie a crash would expose, and port rule 4
        exists precisely so that cannot happen.
        """
        with self._guard:
            record = self._records.get(job_id)
            if record is None:
                return
            updated = change(record)
            self._records[job_id] = updated
            observers = tuple(self._observers)
            if not updated.is_active:
                self._release_slot(job_id)
        self._store.put(updated)
        for observer in observers:
            observer.on_status(updated)

    def _release_slot(self, job_id: str) -> None:
        with self._guard:
            isolation = self._isolations.pop(job_id, None)
            if isolation is None:
                return
            self._running[isolation] = max(0, self._running.get(isolation, 1) - 1)

    def _publish_progress(self, job_id: str, progress: JobProgress) -> None:
        self._transition(job_id, lambda record: record.with_progress(progress))
        with self._guard:
            observers = tuple(self._observers)
        for observer in observers:
            observer.on_progress(job_id, progress)

    def _publish_checkpoint(self, job_id: str, state: Mapping[str, object]) -> None:
        self._transition(job_id, lambda record: record.with_checkpoint(state))

    # -- asking -----------------------------------------------------------

    def _status_of(self, job_id: str) -> JobStatus:
        with self._guard:
            record = self._records.get(job_id)
        return record.status if record is not None else JobStatus.PENDING

    def _progress_of(self, job_id: str) -> JobProgress:
        with self._guard:
            record = self._records.get(job_id)
        return record.progress if record is not None else JobProgress()

    def _record_of(self, job_id: str) -> JobRecord:
        with self._guard:
            record = self._records.get(job_id)
        if record is None:
            stored = self._store.get(job_id)
            if stored is not None:
                return stored
            raise NovaInvariantError(f"no job {job_id!r} in this executor") from None
        return record

    def _is_cancelled(self, job_id: str) -> bool:
        """Whether cancellation has been asked for this job.

        A set rather than a flag per job: the flag a *process* polls is a
        multiprocessing ``Event`` on the other side of the boundary, and a
        thread needs nothing more than membership.
        """
        with self._guard:
            return job_id in self._cancelled

    # -- stopping ---------------------------------------------------------

    def _cancel(self, job_id: str, *, grace_period_ms: int | None = None) -> Result[None]:
        with self._guard:
            record = self._records.get(job_id)
            if record is None:
                return err(
                    _refused(JobErrorCode.QUEUE_FULL, f"no job {job_id!r} was ever admitted")
                )
            if not record.is_active:
                return err(
                    _refused(JobErrorCode.JOB_FAILED, f"job {job_id!r} has already finished")
                )
            if job_id in self._cancelled:
                return ok(None)  # already asked; the deadline is already armed
            handle = self._handles.get(job_id)
            grace = (
                (handle.spec.grace_period_ms if handle is not None else 5_000)
                if grace_period_ms is None
                else grace_period_ms
            )
            process = self._processes.get(job_id)
            self._cancelled.add(job_id)
        if process is not None:
            process.cancel()
        watchdog = threading.Timer(max(0.001, grace / 1000.0), self._reap, args=(job_id,))
        watchdog.daemon = True
        with self._guard:
            self._watchdogs[job_id] = watchdog
        watchdog.start()
        return ok(None)

    def _reap(self, job_id: str) -> None:
        """The grace period expired and the job is still here.

        A process is terminated, which is the one place a job can truly be
        killed. A thread is abandoned: the record is closed and the UI stops
        waiting, because Python cannot kill a thread and a job that ignores
        cancellation is a bug to be reported, not a hang to be waited on.
        """
        with self._guard:
            record = self._records.get(job_id)
            if record is None or not record.is_active:
                return
            process = self._processes.get(job_id)
        if process is not None and process.is_alive():
            process.terminate()
        self._transition(
            job_id,
            lambda record: record.failed(
                self._clock.now_ms(),
                code=JobErrorCode.TIMED_OUT,
                message="the job did not stop within its grace period",
            ),
        )

    def _wait(
        self, future: Future[Result[JobOutcome]], *, timeout_ms: int | None
    ) -> Result[JobOutcome]:
        seconds = None if timeout_ms is None else timeout_ms / 1000.0
        try:
            return future.result(timeout=seconds)
        except TimeoutError:
            return err(NovaError(JobErrorCode.TIMED_OUT, "the job did not finish in time"))
        except Exception as error:
            if _is_broken_pool(error):
                return err(
                    NovaError(
                        JobErrorCode.WORKER_LOST,
                        "the worker running this job died",
                        cause=repr(error),
                    )
                )
            if _is_cancelled(error):
                return err(NovaError(JobErrorCode.CANCELLED, "the job was cancelled"))
            return err(NovaError(JobErrorCode.JOB_FAILED, _FAULT_MESSAGE, cause=repr(error)))


class ThreadPoolJobExecutor(ConcurrentJobExecutor):
    """The same executor, refusing to start a process.

    For tests, and for the frozen Windows build until it can call
    ``multiprocessing.freeze_support()`` — a spawned worker in a packaged app
    that has not re-imports the application and starts a second copy of it. A
    process job submitted here is refused at once rather than run in the wrong
    place.
    """

    def __init__(
        self,
        *,
        store: JobStore,
        capacity: PoolCapacity | None = None,
        clock: Clock | None = None,
        thread_pool_factory: Callable[[int], Executor] | None = None,
    ) -> None:
        super().__init__(
            store=store,
            capacity=capacity,
            clock=clock,
            thread_pool_factory=thread_pool_factory,
            process_context=None,
        )


def spawn_context() -> Any:
    """The context a process job should start on.

    ``spawn``, never ``fork``: a forked worker inherits the parent's event loop,
    its sockets and its locks, and a job that touched any of them would corrupt
    the editor rather than fail. It is also what Windows does, so the behaviour
    a developer sees is the behaviour a user gets.
    """
    import multiprocessing

    return multiprocessing.get_context("spawn")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _noop() -> None:
    """The heartbeat of a job nobody is watching."""


def _thread_pool(workers: int) -> Executor:
    return ThreadPoolExecutor(max_workers=workers, thread_name_prefix="nova-job")


def _picklable(body: JobBody) -> bool:
    """Whether a body can cross the process boundary. Checked, not hoped."""
    try:
        pickle.dumps(body)
    except Exception:
        return False
    return True


def _is_broken_pool(error: BaseException) -> bool:
    return isinstance(error, BrokenExecutor) or type(error).__name__ in (
        "BrokenProcessPool",
        "TerminatedWorkerError",
    )


def _is_cancelled(error: BaseException) -> bool:
    from concurrent.futures import CancelledError

    return isinstance(error, CancelledError)


def _refused(code: JobErrorCode, message: str, *, remedy: str | None = None) -> NovaError:
    return NovaError(code, message, remedy=remedy)
