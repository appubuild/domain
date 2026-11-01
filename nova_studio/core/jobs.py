"""L1 — jobs: the scheduling vocabulary and the policies that decide who runs.

ADR-0010 puts a job scheduler in ``core/jobs.py``, and this module is the half of
it that belongs in the kernel.  The split is deliberate and worth stating, because
"scheduler" is usually one object that does everything:

**Here (L1) — vocabulary and policy, no I/O.**
    What a job *is* (:class:`JobSpec`), what it reports (:class:`JobProgress`,
    :class:`JobRecord`), what state it is in (:class:`JobStatus`), and the four
    decisions that must be identical no matter who owns the pools:

    * :class:`ProgressThrottle` — never publish faster than 20 Hz (ADR-0010 §3).
    * :func:`decide_admission` — who gets a slot, and who waits (ADR-0010 §1).
    * :class:`RetryPolicy` — whether a failure is worth another attempt, and how
      long to wait (ADR-0010 §5).
    * :class:`CircuitBreaker` — when a job kind is disabled because its worker
      keeps dying (ADR-0010 §5).

    All four are pure.  Time enters as an argument, never as
    ``time.monotonic()``, and there is no randomness — a randomised backoff
    cannot be asserted on, and the jitter that avoids a thundering herd is the
    executor's business, applied outside this module.

**Not here — mechanism (L3) and execution (L4).**
    The object that owns queues, runs the admission loop and supervises workers
    is a *service*: it drives :class:`nova_studio.ports.jobs.JobExecutor`, which
    is I/O and therefore cannot live in L1.  Pools, subprocesses, watchdogs and
    the actual CPU live behind that port.

Why the vocabulary is L1 rather than L2
---------------------------------------
The policies are mechanisms of the same kind as ``commands.py``'s coalescing or
``events.py``'s delivery: they are rules about work, not about video editing, and
they must be usable by anything that schedules — the application scheduler, a
plugin host running its own workers, or a test harness that runs jobs inline.
Had :class:`JobSpec` lived in ``domain``, L1 could not reference it without
importing outward, which ADR-0002 forbids.

Five decisions carry the weight
-------------------------------
1. **Isolation is declared, not guessed.**  :class:`Isolation` says whether a job
   runs in a thread or a process, and :meth:`JobPriority.default_isolation`
   infers it from the priority class so that the common case cannot be got
   wrong — while an override stays available for the cases the table does not
   cover (a GPU inference job that wants the calling thread).
2. **Preemption is admission, never killing.**  :func:`decide_admission` defers
   a request rather than cancelling running work: killing a job corrupts its
   output and wastes everything it had already done.
3. **A large job may not run in a thread pool.**  ``JobMemoryClass.LARGE`` with
   ``Isolation.THREAD`` is refused at construction, because a CPU-heavy job on
   the thread pool is the exact GIL starvation ADR-0010 §1 exists to prevent.
4. **Only an idempotent job may be retried.**  Retrying an export that appends
   to a file produces a file with the work done twice.  The invariant is
   enforced when the spec is built, not when a retry is attempted.
5. **A worker that dies is a different failure from a job that failed.**  Only
   ``WORKER_LOST`` moves the circuit breaker (ADR-0010 §5): a codec that
   segfaults is a broken kind, whereas a timeout is a slow job that may simply
   need another go.
"""

from __future__ import annotations

import re
import threading
from collections.abc import Mapping
from dataclasses import dataclass, replace
from enum import StrEnum
from typing import Final

from nova_studio.core.errors import NovaInvariantError

__all__ = [
    "CIRCUIT_BREAKER_THRESHOLD",
    "DEFAULT_GRACE_PERIOD_MS",
    "EXPORT_GRACE_PERIOD_MS",
    "KIND_PATTERN",
    "MAX_PROGRESS_HZ",
    "AdmissionVerdict",
    "Affinity",
    "CircuitBreaker",
    "Isolation",
    "JobFailureKind",
    "JobMemoryClass",
    "JobOutcome",
    "JobPriority",
    "JobProgress",
    "JobRecord",
    "JobSpec",
    "JobStatus",
    "PoolCapacity",
    "ProgressThrottle",
    "RetryPolicy",
    "decide_admission",
    "deferral_candidate",
]

#: ADR-0010 §3: progress is published at most 20 times a second per job.  The
#: UI cannot show more, the WebSocket bridge coalesces anyway, and a job that
#: emits on every frame spends more time publishing than working.
MAX_PROGRESS_HZ: Final[int] = 20

#: ADR-0010 §4: how long a cancelled job has to stop before the watchdog
#: terminates its worker.
DEFAULT_GRACE_PERIOD_MS: Final[int] = 5_000

#: ADR-0010 §4: exports get 30 s, because killing one mid-mux leaves a file that
#: plays but has no index — worse than a file that is simply not there.
EXPORT_GRACE_PERIOD_MS: Final[int] = 30_000

#: ADR-0010 §5: two consecutive worker losses disable the job kind.
CIRCUIT_BREAKER_THRESHOLD: Final[int] = 2

#: A job kind is a dotted slug: ``export.mp4``, ``asr.transcribe``,
#: ``proxy.transcode``, ``thumbnail``.  Slugs, not free text, because the kind
#: is what the circuit breaker, the concurrency cap and the telemetry grouping
#: are keyed on — ``Export MP4`` and ``export.mp4`` would otherwise be two
#: different job types with two different failure counts.
KIND_PATTERN: Final[re.Pattern[str]] = re.compile(r"^[a-z][a-z0-9]*(?:\.[a-z0-9-]+)*$")


class JobPriority(StrEnum):
    """ADR-0010 §1 — five classes, ordered by how long the user will wait.

    The class is a *declaration of urgency*, not a nicety: it decides which pool
    the job runs in (:meth:`default_isolation`), who is admitted when a slot is
    free (:func:`decide_admission`) and who is pushed to the back of the queue
    when it is not (:func:`deferral_candidate`).
    """

    #: The user is blocked: the thumbnail of a clip that was just dropped, the
    #: probe of a file that was just imported.  Sub-second, thread pool.
    CRITICAL = "critical"
    #: The next frames the viewer needs: preview render of the visible range.
    #: Late is visible as a stutter, so it outranks everything except CRITICAL.
    HIGH = "high"
    #: User-initiated long work: export, proxy transcode.  Process pool — CPU
    #: bound, and must not starve the UI.
    NORMAL = "normal"
    #: Background AI: transcription, scene detection, auto-reframe.  Process
    #: pool, and always deferrable.
    LOW = "low"
    #: Opportunistic: waveform pre-generation, cache warm-up.  Thread pool, and
    #: the first thing dropped when the machine is busy.
    IDLE = "idle"

    @property
    def rank(self) -> int:
        """Ordering key: ``0`` is the most urgent.  Compare with :meth:`outranks`."""
        return _PRIORITY_RANK[self]

    @property
    def default_isolation(self) -> Isolation:
        """The pool this class runs in unless the spec overrides it (ADR-0010 §1).

        The two long-running classes are CPU-bound and go to processes, because a
        compositing or inference loop in a thread starves the request path under
        the GIL.  The three latency-sensitive classes stay on threads, where
        starting costs microseconds rather than a Python interpreter.
        """
        return (
            Isolation.PROCESS if self in (JobPriority.NORMAL, JobPriority.LOW) else Isolation.THREAD
        )

    def outranks(self, other: JobPriority) -> bool:
        """Whether ``self`` must be allowed to start before ``other``."""
        return self.rank < other.rank


_PRIORITY_RANK: Final[dict[JobPriority, int]] = {
    JobPriority.CRITICAL: 0,
    JobPriority.HIGH: 1,
    JobPriority.NORMAL: 2,
    JobPriority.LOW: 3,
    JobPriority.IDLE: 4,
}


class Isolation(StrEnum):
    """Where a job body runs (ADR-0010 §2).

    Declared by the spec, never inferred at submit time from the payload, so
    that the cost model of a job is readable where the job is written.
    """

    #: A pool thread.  Correct for short or I/O-bound work; a CPU-bound thread
    #: job is the starvation bug this enum exists to prevent.
    THREAD = "thread"
    #: A worker process.  Crash isolation and real parallelism; pays pickling
    #: and, on Windows ``spawn``, a re-import that reloads any model the job
    #: needs (ADR-0010 §Negative consequences).
    PROCESS = "process"


class JobMemoryClass(StrEnum):
    """How much memory a job's working set takes.

    Not the same as :class:`nova_studio.core.commands.MemoryClass`, which prices
    an undo *delta* inside the history stack.  This one prices the memory a
    worker needs while it runs, which is what decides whether a job may share the
    thread pool and whether two of them may run at once on a small machine.
    """

    #: Scalars and ids: a probe, a thumbnail, a cache lookup.
    SMALL = "small"
    #: One bounded artefact: a single frame, one asset's transcript.
    MEDIUM = "medium"
    #: Unbounded or model-sized: a full frame queue, loaded model weights.  May
    #: only run in a process, so that an OOM kills a worker and not the editor.
    LARGE = "large"


class Affinity(StrEnum):
    """What the job needs to make progress, for slot accounting (ADR-0010 §8)."""

    #: Runs anywhere; counted against the thread or process pool.
    ANY = "any"
    #: Compute-bound; counted against the CPU pool.
    CPU = "cpu"
    #: Needs a GPU context.  Counted against ``PoolCapacity.gpu``, which is 1
    #: unless several contexts have been proven safe on this machine — so a
    #: machine with no usable GPU rejects the job at admission rather than
    #: starting it and failing halfway (ADR-0010 §8, ADR-0012 §2).
    GPU = "gpu"
    #: Waiting on a disk or a socket; counted against a separate, larger cap.
    IO = "io"


class JobFailureKind(StrEnum):
    """*How* a job failed, which is what decides whether to retry it.

    A single boolean ``failed`` is why retry logic so often makes things worse:
    the one failure that is always safe to retry is a worker that died, because
    the job provably did not run to completion and left nothing half-done.
    """

    #: The worker process died: a codec segfault, an OOM kill, a power loss.
    #: Definitionally retryable for an idempotent job, and the only kind that
    #: moves the circuit breaker (ADR-0010 §5).
    WORKER_LOST = "worker_lost"
    #: The job overran its deadline.  Retryable in principle, but a job that
    #: timed out on a 4-minute clip will usually time out again, so it does not
    #: trip the breaker and is not retried by default.
    TIMEOUT = "timeout"
    #: The user or the shutdown path asked for it.  Never a fault, never
    #: retried.
    CANCELLED = "cancelled"
    #: The job ran and returned ``Err``: a missing file, an unsupported codec.
    #: Retrying reproduces the same failure, so it is never retried.
    FAULT = "fault"
    #: The job never started: no slot, the kind is disabled, the payload cannot
    #: cross a process boundary.
    REJECTED = "rejected"


class JobStatus(StrEnum):
    """The life of one job, which is also what the UI shows (ADR-0010 §6, §7)."""

    #: Accepted and waiting for a slot.
    PENDING = "pending"
    #: A slot was granted; the job is about to start.
    ADMITTED = "admitted"
    #: Running in a worker.
    RUNNING = "running"
    #: Finished and produced its result.
    SUCCEEDED = "succeeded"
    #: Ran and failed with a fault, a timeout or a lost worker.
    FAILED = "failed"
    #: Cancelled cooperatively.  Not a fault: the UI says "stopped".
    CANCELLED = "cancelled"
    #: Was active when the process ended.  Assigned by
    #: :meth:`~nova_studio.ports.jobs.JobStore.reconcile_interrupted` on the
    #: next start, never by a running job.
    INTERRUPTED = "interrupted"

    @property
    def is_terminal(self) -> bool:
        """Whether the job has stopped for good and no longer holds a slot."""
        return self in _TERMINAL_STATUSES

    @property
    def is_active(self) -> bool:
        """Whether the job still holds (or is waiting for) a slot."""
        return self not in _TERMINAL_STATUSES

    @property
    def succeeded(self) -> bool:
        """Whether this status represents work the user can use."""
        return self is JobStatus.SUCCEEDED


_TERMINAL_STATUSES: Final[frozenset[JobStatus]] = frozenset(
    {
        JobStatus.SUCCEEDED,
        JobStatus.FAILED,
        JobStatus.CANCELLED,
        JobStatus.INTERRUPTED,
    }
)


class AdmissionVerdict(StrEnum):
    """What the admission policy decided (:func:`decide_admission`)."""

    #: Take a slot and start now.
    ADMIT = "admit"
    #: Wait.  No slot is free, or more urgent work is already waiting.
    DEFER = "defer"
    #: Never on this machine: the kind has no capacity at all, or its circuit
    #: breaker is open.  Deferring would queue a job that can never start.
    REJECT = "reject"


@dataclass(frozen=True, slots=True, kw_only=True)
class RetryPolicy:
    """How many attempts a failure is worth, and how long to wait between them.

    Deterministic exponential backoff with no jitter: L1 has no randomness, so
    the numbers are assertable, and the executor is free to add jitter before it
    sleeps.  The default retries exactly one kind of failure —
    :attr:`JobFailureKind.WORKER_LOST` — because that is the only one where a
    second attempt is known to be safe.
    """

    #: Total attempts, including the first.  ``1`` means "never retry".
    max_attempts: int = 1
    #: Delay before the second attempt; doubles per attempt after that.
    base_delay_ms: int = 500
    #: Ceiling for the delay, so a long chain of losses cannot park a job for
    #: an hour.
    max_delay_ms: int = 30_000
    #: The failures worth another attempt.
    retry_on: frozenset[JobFailureKind] = frozenset({JobFailureKind.WORKER_LOST})

    def __post_init__(self) -> None:
        if self.max_attempts < 1:
            raise NovaInvariantError(f"max_attempts must be at least 1, got {self.max_attempts}")
        if self.base_delay_ms < 0:
            raise NovaInvariantError(
                f"base_delay_ms must not be negative, got {self.base_delay_ms}"
            )
        if self.max_delay_ms < self.base_delay_ms:
            raise NovaInvariantError(
                f"max_delay_ms ({self.max_delay_ms}) must not be below "
                f"base_delay_ms ({self.base_delay_ms})"
            )

    @property
    def retries(self) -> int:
        """How many *additional* attempts this policy allows."""
        return self.max_attempts - 1

    def delay_for(self, attempt: int) -> int:
        """Milliseconds to wait before attempt ``attempt + 1`` (1-based ``attempt``).

        ``attempt = 1`` (the first attempt has just failed) yields
        ``base_delay_ms``; each further failure doubles it, capped at
        ``max_delay_ms``.
        """
        if attempt < 1:
            raise NovaInvariantError(f"attempt must be at least 1, got {attempt}")
        # A shift rather than a power: `int ** int` is typed as `Any` in
        # typeshed, and doubling is exactly what a shift expresses.
        delay = self.base_delay_ms << (attempt - 1)
        return min(delay, self.max_delay_ms)

    def should_retry(self, attempt: int, failure: JobFailureKind) -> bool:
        """Whether ``failure`` on attempt ``attempt`` deserves another go."""
        return failure in self.retry_on and attempt < self.max_attempts

    def to_wire(self) -> dict[str, object]:
        """A JSON-ready mapping, for the persisted job record."""
        return {
            "max_attempts": self.max_attempts,
            "base_delay_ms": self.base_delay_ms,
            "max_delay_ms": self.max_delay_ms,
            "retry_on": sorted(member.value for member in self.retry_on),
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> RetryPolicy:
        """Rebuild a policy from :meth:`to_wire`, rejecting unknown fields."""
        _reject_unknown_fields(data, _RETRY_FIELDS)
        raw = data["retry_on"]
        if not isinstance(raw, list):
            raise NovaInvariantError(f"'retry_on' must be a list, got {type(raw).__name__}")
        return cls(
            max_attempts=_wire_int(data, "max_attempts"),
            base_delay_ms=_wire_int(data, "base_delay_ms"),
            max_delay_ms=_wire_int(data, "max_delay_ms"),
            retry_on=frozenset(JobFailureKind(_wire_str({"value": item}, "value")) for item in raw),
        )


@dataclass(frozen=True, slots=True, kw_only=True)
class JobSpec:
    """The declaration of a job: what it is, and what it is allowed to cost.

    Built once where the job is defined and passed to
    :meth:`~nova_studio.ports.jobs.JobExecutor.submit`.  Every field is a
    *declaration* — the executor validates against it rather than discovering
    the shape of the work at runtime (ADR-0010 §2).
    """

    #: Dotted slug (``export.mp4``, ``asr.transcribe``).  Key for the circuit
    #: breaker, the concurrency cap and telemetry.
    kind: str
    priority: JobPriority = JobPriority.NORMAL
    isolation: Isolation = Isolation.THREAD
    memory_class: JobMemoryClass = JobMemoryClass.SMALL
    affinity: Affinity = Affinity.ANY
    #: Whether ``cancel`` is honoured.  ``False`` for work that must complete to
    #: leave the project consistent — the scheduler then refuses to kill it and
    #: the UI offers no cancel button.
    cancellable: bool = True
    #: Whether running it twice leaves the same result as running it once.
    #: Required for retries and for deduplication, and enforced rather than
    #: assumed, because a retried non-idempotent export is silent corruption.
    idempotent: bool = False
    #: How long a cancelled job has before the watchdog terminates its worker.
    grace_period_ms: int = DEFAULT_GRACE_PERIOD_MS
    #: Wall-clock budget for the whole job.  ``None`` means unbounded, which is
    #: only acceptable for work the user can cancel.
    timeout_ms: int | None = None
    retry: RetryPolicy = RetryPolicy()
    #: Collapses identical queued work: 200 thumbnail requests for one clip
    #: become one job with 200 listeners.
    dedupe_key: str | None = None
    #: Progress publications per second, capped at :data:`MAX_PROGRESS_HZ`.
    max_progress_hz: int = MAX_PROGRESS_HZ

    def __post_init__(self) -> None:
        if not KIND_PATTERN.match(self.kind):
            raise NovaInvariantError(
                f"job kind must be a dotted lowercase slug matching "
                f"{KIND_PATTERN.pattern}, got {self.kind!r}"
            )
        if self.memory_class is JobMemoryClass.LARGE and self.isolation is not Isolation.PROCESS:
            raise NovaInvariantError(
                f"a {JobMemoryClass.LARGE} job must run in a process, got {self.isolation}: "
                "a large CPU-bound job on the thread pool starves the UI (ADR-0010 §1)"
            )
        if self.isolation is Isolation.PROCESS and self.grace_period_ms <= 0:
            raise NovaInvariantError(
                "a process job must declare a positive grace_period_ms: the watchdog "
                "that reaps a hung worker has no deadline otherwise (ADR-0010 §4)"
            )
        if self.timeout_ms is not None and self.timeout_ms <= 0:
            raise NovaInvariantError(f"timeout_ms must be positive, got {self.timeout_ms}")
        if self.retry.max_attempts > 1 and not self.idempotent:
            raise NovaInvariantError(
                f"job {self.kind!r} retries ({self.retry.max_attempts} attempts) but is not "
                "idempotent; a retry would repeat its side effects"
            )
        if not 1 <= self.max_progress_hz <= MAX_PROGRESS_HZ:
            raise NovaInvariantError(
                f"max_progress_hz must be between 1 and {MAX_PROGRESS_HZ}, "
                f"got {self.max_progress_hz}"
            )

    @classmethod
    def of(
        cls,
        kind: str,
        priority: JobPriority,
        *,
        isolation: Isolation | None = None,
    ) -> JobSpec:
        """Declare a job, inferring the pool from its priority (ADR-0010 §1).

        Everything else keeps its default; use :func:`dataclasses.replace` for
        the fields that matter, which keeps the declaration to one readable
        expression at the point where the job is defined.
        """
        return cls(
            kind=kind,
            priority=priority,
            isolation=isolation if isolation is not None else priority.default_isolation,
        )

    @property
    def progress_interval_ms(self) -> int:
        """Minimum milliseconds between two progress publications."""
        return max(1, 1000 // self.max_progress_hz)

    @property
    def is_retryable(self) -> bool:
        """Whether any failure can produce another attempt."""
        return self.retry.max_attempts > 1

    def to_wire(self) -> dict[str, object]:
        """A JSON-ready mapping, for job history and diagnostics."""
        return {
            "kind": self.kind,
            "priority": self.priority.value,
            "isolation": self.isolation.value,
            "memory_class": self.memory_class.value,
            "affinity": self.affinity.value,
            "cancellable": self.cancellable,
            "idempotent": self.idempotent,
            "grace_period_ms": self.grace_period_ms,
            "timeout_ms": self.timeout_ms,
            "retry": self.retry.to_wire(),
            "dedupe_key": self.dedupe_key,
            "max_progress_hz": self.max_progress_hz,
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> JobSpec:
        """Rebuild a spec from :meth:`to_wire`, rejecting unknown fields."""
        _reject_unknown_fields(data, _SPEC_FIELDS)
        retry = data["retry"]
        if not isinstance(retry, Mapping):
            raise NovaInvariantError(f"'retry' must be a mapping, got {type(retry).__name__}")
        return cls(
            kind=_wire_str(data, "kind"),
            priority=JobPriority(_wire_str(data, "priority")),
            isolation=Isolation(_wire_str(data, "isolation")),
            memory_class=JobMemoryClass(_wire_str(data, "memory_class")),
            affinity=Affinity(_wire_str(data, "affinity")),
            cancellable=bool(data["cancellable"]),
            idempotent=bool(data["idempotent"]),
            grace_period_ms=_wire_int(data, "grace_period_ms"),
            timeout_ms=_optional_int(data, "timeout_ms"),
            retry=RetryPolicy.from_wire(retry),
            dedupe_key=_optional_str(data, "dedupe_key"),
            max_progress_hz=_wire_int(data, "max_progress_hz"),
        )


@dataclass(frozen=True, slots=True, kw_only=True)
class JobProgress:
    """One progress report from a running job (ADR-0010 §3).

    Progress is a value, not a callback into the UI, so that a job running in
    another process can report it, a scheduler can throttle it, and the
    WebSocket bridge can coalesce it without any of the three knowing about the
    others.
    """

    #: Completed fraction, ``0.0``–``1.0``.  May go backwards only if a stage
    #: restarts it, which is why the UI shows the stage name beside the bar.
    fraction: float = 0.0
    #: What the job is doing: ``probing``, ``transcribing``, ``encoding``,
    #: ``muxing``.  A stage change is never dropped by the throttle, because a
    #: bar that sits still while the stage changes looks hung.
    stage: str = ""
    #: Estimated seconds remaining; ``None`` until the job can guess.
    eta_seconds: float | None = None
    #: One human-readable line: which file, which frame.
    detail: str = ""
    #: Partial results — an ASR partial hypothesis, a first-pass frame count —
    #: carried on the same channel (ADR-0010 §3).  Must be JSON-serialisable
    #: because it crosses to the frontend.
    payload: Mapping[str, object] | None = None

    def __post_init__(self) -> None:
        if not 0.0 <= self.fraction <= 1.0:
            raise NovaInvariantError(f"fraction must be within [0, 1], got {self.fraction}")
        if self.eta_seconds is not None and self.eta_seconds < 0.0:
            raise NovaInvariantError(f"eta_seconds must not be negative, got {self.eta_seconds}")

    @property
    def is_complete(self) -> bool:
        """Whether this report says the job has finished its work."""
        return self.fraction >= 1.0

    @property
    def percent(self) -> int:
        """Whole percent, for a progress bar or a job list row."""
        return round(self.fraction * 100)

    def to_wire(self) -> dict[str, object]:
        """A JSON-ready mapping, for the WebSocket bridge."""
        return {
            "fraction": self.fraction,
            "stage": self.stage,
            "eta_seconds": self.eta_seconds,
            "detail": self.detail,
            "payload": dict(self.payload) if self.payload else None,
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> JobProgress:
        """Rebuild a report from :meth:`to_wire`, rejecting unknown fields."""
        _reject_unknown_fields(data, _PROGRESS_FIELDS)
        payload = data["payload"]
        if payload is not None and not isinstance(payload, Mapping):
            raise NovaInvariantError(
                f"'payload' must be a mapping or null, got {type(payload).__name__}"
            )
        return cls(
            fraction=_wire_float(data, "fraction"),
            stage=_wire_str(data, "stage"),
            eta_seconds=_optional_float(data, "eta_seconds"),
            detail=_wire_str(data, "detail"),
            payload=dict(payload) if payload is not None else None,
        )


@dataclass(frozen=True, slots=True, kw_only=True)
class JobOutcome:
    """What a finished job produced.

    Deliberately untyped: a result that crossed a process boundary is an opaque
    object, and the caller that submitted the job knows what it asked for.  The
    interesting field is :attr:`artefacts` — paths a later job or the UI can
    open — not the in-memory value.
    """

    #: The job's return value, if it had one.
    value: object | None = None
    #: Paths the job wrote.  A cancelled or interrupted job has none.
    artefacts: tuple[str, ...] = ()
    #: One line for the job history row: "1 842 frames, 24.6 MB".
    detail: str = ""

    @property
    def has_value(self) -> bool:
        """Whether the job returned something rather than ``None``."""
        return self.value is not None


@dataclass(frozen=True, slots=True, kw_only=True)
class JobRecord:
    """The persisted life of one job (ADR-0010 §6).

    Written by the store so that history, retry and post-crash reporting are
    possible: a job that was ``RUNNING`` when the power went out becomes
    ``INTERRUPTED`` on the next start and appears in the UI as something to
    resume, rather than vanishing.

    Every transition returns a new record; none of them mutate, because the
    record is also what gets broadcast to the frontend and a shared mutable
    object would be observed half-updated (ADR-0013).
    """

    job_id: str
    kind: str
    #: When the job was accepted, as wall-clock milliseconds.
    submitted_ms: int
    priority: JobPriority = JobPriority.NORMAL
    status: JobStatus = JobStatus.PENDING
    #: Hash of the parameters, so a resumed job can tell whether the inputs
    #: changed while it was away.
    params_hash: str = ""
    started_ms: int | None = None
    finished_ms: int | None = None
    #: Attempts made so far, starting at 0.
    attempts: int = 0
    progress: JobProgress = JobProgress()
    #: Stable ``NS-*-NNNN`` code when the job did not succeed.
    error_code: str | None = None
    #: Developer-facing text for the log; the UI re-renders from the code.
    error_message: str | None = None
    artefacts: tuple[str, ...] = ()
    #: A resume point a long job leaves behind — frames written, segments done.
    #: JSON-serialisable, so a job can restart mid-way after a crash.
    checkpoint: Mapping[str, object] | None = None

    def __post_init__(self) -> None:
        if not self.job_id:
            raise NovaInvariantError("job_id must not be empty")
        if not self.kind:
            raise NovaInvariantError("kind must not be empty")
        if self.attempts < 0:
            raise NovaInvariantError(f"attempts must not be negative, got {self.attempts}")
        if self.started_ms is None and self.status in _STARTED_STATUSES:
            raise NovaInvariantError(f"status {self.status} requires started_ms")
        if self.finished_ms is None and self.status.is_terminal:
            raise NovaInvariantError(f"terminal status {self.status} requires finished_ms")
        if (
            self.finished_ms is not None
            and self.started_ms is not None
            and self.finished_ms < self.started_ms
        ):
            raise NovaInvariantError("finished_ms must not precede started_ms")
        if self.error_code is not None and self.status not in _FAILED_STATUSES:
            raise NovaInvariantError(
                f"status {self.status} must not carry error_code {self.error_code!r}"
            )

    @property
    def is_active(self) -> bool:
        """Whether the job still occupies, or is waiting for, a slot."""
        return self.status.is_active

    def elapsed_ms(self, now_ms: int) -> int:
        """Milliseconds since submission, or the job's duration once finished."""
        end = self.finished_ms if self.finished_ms is not None else now_ms
        return max(0, end - self.submitted_ms)

    def with_progress(self, progress: JobProgress) -> JobRecord:
        """The same record, carrying a newer progress report."""
        return replace(self, progress=progress)

    def with_checkpoint(self, checkpoint: Mapping[str, object]) -> JobRecord:
        """The same record, carrying a resume point for after a crash."""
        return replace(self, checkpoint=dict(checkpoint))

    def started(self, now_ms: int, *, attempt: int = 1) -> JobRecord:
        """Mark the job as running its ``attempt``-th try.

        Starting an attempt clears the previous one's ending: a retry inherits
        the :attr:`checkpoint` and nothing else, so a record that had already
        failed carries neither its finish time nor its error forward — and a
        finished record that is somehow started again is not left claiming a
        finish that precedes its new start.  Progress resets to zero as well,
        because an attempt begins again; a job that can resume reads the
        checkpoint, not the bar.
        """
        return replace(
            self,
            status=JobStatus.RUNNING,
            started_ms=now_ms,
            finished_ms=None,
            attempts=attempt,
            progress=JobProgress(),
            error_code=None,
            error_message=None,
        )

    def succeeded(self, now_ms: int, *, artefacts: tuple[str, ...] = ()) -> JobRecord:
        """Mark the job as finished and usable."""
        return replace(
            self,
            status=JobStatus.SUCCEEDED,
            finished_ms=now_ms,
            artefacts=artefacts,
            progress=replace(self.progress, fraction=1.0),
            error_code=None,
            error_message=None,
        )

    def failed(self, now_ms: int, *, code: str, message: str | None = None) -> JobRecord:
        """Mark the job as failed with a stable error code."""
        return replace(
            self,
            status=JobStatus.FAILED,
            finished_ms=now_ms,
            error_code=code,
            error_message=message,
        )

    def cancelled(self, now_ms: int) -> JobRecord:
        """Mark the job as stopped because the user or shutdown asked."""
        return replace(
            self,
            status=JobStatus.CANCELLED,
            finished_ms=now_ms,
            error_code=None,
            error_message=None,
            artefacts=(),
        )

    def interrupted(self, now_ms: int) -> JobRecord:
        """Mark a job that was active when the process ended (ADR-0010 §6)."""
        return replace(
            self,
            status=JobStatus.INTERRUPTED,
            finished_ms=now_ms,
            error_message="the editor closed while this job was running",
        )

    def to_wire(self) -> dict[str, object]:
        """A JSON-ready mapping, for the row in ``ai_jobs``/``export_jobs``."""
        return {
            "job_id": self.job_id,
            "kind": self.kind,
            "priority": self.priority.value,
            "status": self.status.value,
            "submitted_ms": self.submitted_ms,
            "params_hash": self.params_hash,
            "started_ms": self.started_ms,
            "finished_ms": self.finished_ms,
            "attempts": self.attempts,
            "progress": self.progress.to_wire(),
            "error_code": self.error_code,
            "error_message": self.error_message,
            "artefacts": list(self.artefacts),
            "checkpoint": dict(self.checkpoint) if self.checkpoint else None,
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> JobRecord:
        """Rebuild a record from :meth:`to_wire`, rejecting unknown fields."""
        _reject_unknown_fields(data, _RECORD_FIELDS)
        progress = data["progress"]
        if not isinstance(progress, Mapping):
            raise NovaInvariantError(f"'progress' must be a mapping, got {type(progress).__name__}")
        artefacts = data["artefacts"]
        if not isinstance(artefacts, list):
            raise NovaInvariantError(f"'artefacts' must be a list, got {type(artefacts).__name__}")
        checkpoint = data["checkpoint"]
        if checkpoint is not None and not isinstance(checkpoint, Mapping):
            raise NovaInvariantError(
                f"'checkpoint' must be a mapping or null, got {type(checkpoint).__name__}"
            )
        return cls(
            job_id=_wire_str(data, "job_id"),
            kind=_wire_str(data, "kind"),
            priority=JobPriority(_wire_str(data, "priority")),
            status=JobStatus(_wire_str(data, "status")),
            submitted_ms=_wire_int(data, "submitted_ms"),
            params_hash=_wire_str(data, "params_hash"),
            started_ms=_optional_int(data, "started_ms"),
            finished_ms=_optional_int(data, "finished_ms"),
            attempts=_wire_int(data, "attempts"),
            progress=JobProgress.from_wire(progress),
            error_code=_optional_str(data, "error_code"),
            error_message=_optional_str(data, "error_message"),
            artefacts=tuple(str(item) for item in artefacts),
            checkpoint=dict(checkpoint) if checkpoint is not None else None,
        )


_STARTED_STATUSES: Final[frozenset[JobStatus]] = frozenset(
    {
        JobStatus.RUNNING,
        JobStatus.SUCCEEDED,
        JobStatus.FAILED,
        JobStatus.CANCELLED,
        JobStatus.INTERRUPTED,
    }
)

_FAILED_STATUSES: Final[frozenset[JobStatus]] = frozenset(
    {JobStatus.FAILED, JobStatus.CANCELLED, JobStatus.INTERRUPTED}
)


@dataclass(frozen=True, slots=True, kw_only=True)
class PoolCapacity:
    """How many jobs of each kind may run at once (ADR-0010 §8).

    Derived from what the machine was measured to have, not from a guess: a cap
    that assumes eight cores on a two-core laptop is how an editor freezes while
    "exporting in the background".
    """

    #: Thread-pool slots: short or I/O-bound work (CRITICAL, HIGH, IDLE).
    threads: int = 4
    #: Process-pool slots: CPU-bound work (NORMAL, LOW).
    processes: int = 1
    #: GPU contexts.  ``1`` at most unless several were proven safe, and ``0``
    #: when no usable GPU was detected — which rejects GPU work at admission
    #: instead of failing it halfway through (ADR-0012 §2).
    gpu: int = 0
    #: Slots for work that is mostly waiting on a disk or a socket.
    io: int = 2

    def __post_init__(self) -> None:
        for name in ("threads", "processes", "gpu", "io"):
            value = getattr(self, name)
            if value < 0:
                raise NovaInvariantError(f"{name} must not be negative, got {value}")

    @classmethod
    def detect(cls, physical_cores: int, *, gpu_present: bool = False) -> PoolCapacity:
        """Derive caps from measured capability (ADR-0010 §8).

        One core is reserved for the UI and the preview path, which is the whole
        point: the user must be able to keep scrubbing while an export runs.
        Processes get half of what is left because CPU-bound work is bounded by
        cores; threads get the full count because their work is short or spends
        most of its time waiting.
        """
        if physical_cores < 1:
            raise NovaInvariantError(f"physical_cores must be at least 1, got {physical_cores}")
        cpu = max(1, physical_cores - 1)
        return cls(
            threads=max(2, cpu),
            processes=max(1, cpu // 2),
            gpu=1 if gpu_present else 0,
            io=max(2, min(8, cpu)),
        )

    def slots_for(self, spec: JobSpec) -> int:
        """How many concurrent jobs of this spec's kind the machine allows."""
        if spec.affinity is Affinity.GPU:
            return self.gpu
        if spec.affinity is Affinity.IO:
            return self.io
        return self.threads if spec.isolation is Isolation.THREAD else self.processes

    def overridden_by(self, user: PoolCapacity) -> PoolCapacity:
        """Apply a Settings ▸ Performance override, tightening only.

        A user may lower a cap — the machine is theirs and they may know
        something the detector does not — but may not raise one above what was
        measured.  Raising it is precisely the "editor froze" bug the cap exists
        to prevent, and a support engineer reading the telemetry needs the
        effective caps, not the requested ones.
        """
        return PoolCapacity(
            threads=min(self.threads, user.threads),
            processes=min(self.processes, user.processes),
            gpu=min(self.gpu, user.gpu),
            io=min(self.io, user.io),
        )


def decide_admission(
    spec: JobSpec,
    running: Mapping[Isolation, int],
    queued: Mapping[JobPriority, int],
    capacity: PoolCapacity,
) -> AdmissionVerdict:
    """Whether ``spec`` may take a slot right now (ADR-0010 §1).

    Two rules, in order:

    1. **Capacity.**  No slot free in the pool the spec wants → ``DEFER``;
       the pool has no slots at all → ``REJECT``, because queueing work that can
       never start is a memory leak with a progress bar.
    2. **Urgency.**  Even with a slot free, a job defers while any *more urgent*
       work is waiting.  This is what stops eight background waveform jobs from
       filling the thread pool and making a dropped clip wait for a thumbnail —
       the priority inversion ADR-0010's context names explicitly.

    Args:
        spec: The job asking for a slot.
        running: Concurrent jobs per pool, as counted by the scheduler.
        queued: Waiting jobs per priority class.
        capacity: The measured caps for this machine.

    Returns:
        :attr:`AdmissionVerdict.ADMIT`, :attr:`AdmissionVerdict.DEFER` or
        :attr:`AdmissionVerdict.REJECT`.
    """
    slots = capacity.slots_for(spec)
    if slots <= 0:
        return AdmissionVerdict.REJECT
    if running.get(spec.isolation, 0) >= slots:
        return AdmissionVerdict.DEFER
    if any(count > 0 for priority, count in queued.items() if priority.outranks(spec.priority)):
        return AdmissionVerdict.DEFER
    return AdmissionVerdict.ADMIT


def deferral_candidate(queued: Mapping[JobPriority, int]) -> JobPriority | None:
    """The least urgent class that has work waiting, or ``None``.

    When a slot frees and several classes are waiting, this is the one the
    scheduler pushes further back (ADR-0010 §1: "otherwise the lowest-priority
    queued job is deferred").  Returning it as a value keeps the policy pure and
    leaves the queue itself to the scheduler, which is the only thing that knows
    about ordering within a class.
    """
    waiting = [priority for priority, count in queued.items() if count > 0]
    if not waiting:
        return None
    return max(waiting, key=lambda priority: (priority.rank, priority.value))


class ProgressThrottle:
    """Rate-limit one job's progress reports (ADR-0010 §3).

    Time is passed in, never read, so a policy test can advance a fake clock and
    assert the exact publication schedule.  Two reports are exempt from the
    limit because dropping them is worse than the cost of sending them:

    * a **stage change** — a bar that stops moving while the stage label changes
      reads as a hang, even when the job is healthy;
    * a **terminal** report — the final ``1.0`` must always arrive, or the UI
      keeps a job at 99 % forever.
    """

    __slots__ = ("_interval_ms", "_last_ms")

    def __init__(self, *, max_hz: int = MAX_PROGRESS_HZ) -> None:
        if not 1 <= max_hz <= MAX_PROGRESS_HZ:
            raise NovaInvariantError(
                f"max_hz must be between 1 and {MAX_PROGRESS_HZ}, got {max_hz}"
            )
        self._interval_ms = max(1, 1000 // max_hz)
        self._last_ms: int | None = None

    @property
    def interval_ms(self) -> int:
        """Minimum milliseconds between two ordinary reports."""
        return self._interval_ms

    def should_emit(self, now_ms: int, *, important: bool = False) -> bool:
        """Whether a report at ``now_ms`` may be published.

        Args:
            now_ms: Injected wall clock, in milliseconds.
            important: Set when the report changes stage or completes the job;
                those are never dropped.
        """
        if important or self._last_ms is None:
            return True
        return now_ms - self._last_ms >= self._interval_ms

    def note(self, now_ms: int) -> None:
        """Record that a report was published at ``now_ms``."""
        self._last_ms = now_ms

    def reset(self) -> None:
        """Forget the last publication, so the next report is always allowed.

        Used when a job restarts after a retry: its progress returns to zero and
        the first report of the new attempt must not be swallowed.
        """
        self._last_ms = None


class CircuitBreaker:
    """Disable a job kind whose workers keep dying (ADR-0010 §5).

    A codec that segfaults FFmpeg on one particular machine, or a model that
    OOMs on a 4 GB card, will keep failing for as long as it is offered.  Two
    consecutive worker losses for the same kind disable it and record *why*, so
    the UI can say "HEVC export is disabled on this machine after two crashes —
    try software encoding" instead of failing a third time and losing another
    twenty minutes of the user's work.

    Only :attr:`JobFailureKind.WORKER_LOST` counts.  A timeout or a returned
    ``Err`` means the worker survived, which is exactly the evidence that the
    kind is not broken.

    Thread-safe: losses are recorded from the supervisor while the UI reads
    :meth:`is_open` from the request path.
    """

    __slots__ = ("_consecutive", "_lock", "_open", "_threshold")

    def __init__(self, *, threshold: int = CIRCUIT_BREAKER_THRESHOLD) -> None:
        if threshold < 1:
            raise NovaInvariantError(f"threshold must be at least 1, got {threshold}")
        self._threshold = threshold
        self._consecutive: dict[str, int] = {}
        self._open: dict[str, str] = {}
        self._lock = threading.Lock()

    @property
    def threshold(self) -> int:
        """How many consecutive worker losses open the breaker."""
        return self._threshold

    def is_open(self, kind: str) -> bool:
        """Whether ``kind`` is disabled."""
        with self._lock:
            return kind in self._open

    def open_kinds(self) -> tuple[str, ...]:
        """Every disabled kind, sorted so the settings screen is stable."""
        with self._lock:
            return tuple(sorted(self._open))

    def reason(self, kind: str) -> str:
        """Why ``kind`` is disabled, or ``""`` when it is not."""
        with self._lock:
            return self._open.get(kind, "")

    def record_failure(self, kind: str, failure: JobFailureKind) -> bool:
        """Record a failure; return ``True`` if it disabled ``kind`` just now.

        Only a lost worker moves the counter; every other kind of failure leaves
        it alone, and a success clears it.
        """
        with self._lock:
            if failure is not JobFailureKind.WORKER_LOST:
                return False
            count = self._consecutive.get(kind, 0) + 1
            self._consecutive[kind] = count
            if count < self._threshold:
                return False
            self._open[kind] = (
                f"{kind!r} was disabled after {count} consecutive worker losses; "
                "the job type will stay off until it is reset or the editor restarts"
            )
            return True

    def record_success(self, kind: str) -> None:
        """Record that ``kind`` finished, clearing its streak."""
        with self._lock:
            self._consecutive.pop(kind, None)

    def reset(self, kind: str) -> None:
        """Re-enable ``kind`` — the user pressed "try again" in Settings."""
        with self._lock:
            self._consecutive.pop(kind, None)
            self._open.pop(kind, None)


# -- wire helpers -------------------------------------------------------------

_RETRY_FIELDS: Final[set[str]] = {
    "max_attempts",
    "base_delay_ms",
    "max_delay_ms",
    "retry_on",
}
_SPEC_FIELDS: Final[set[str]] = {
    "kind",
    "priority",
    "isolation",
    "memory_class",
    "affinity",
    "cancellable",
    "idempotent",
    "grace_period_ms",
    "timeout_ms",
    "retry",
    "dedupe_key",
    "max_progress_hz",
}
_PROGRESS_FIELDS: Final[set[str]] = {"fraction", "stage", "eta_seconds", "detail", "payload"}
_RECORD_FIELDS: Final[set[str]] = {
    "job_id",
    "kind",
    "priority",
    "status",
    "submitted_ms",
    "params_hash",
    "started_ms",
    "finished_ms",
    "attempts",
    "progress",
    "error_code",
    "error_message",
    "artefacts",
    "checkpoint",
}


def _reject_unknown_fields(data: Mapping[str, object], expected: set[str]) -> None:
    if set(data) != expected:
        raise NovaInvariantError(
            f"fields must be exactly {sorted(expected)}, got {sorted(str(key) for key in data)}"
        )


def _wire_int(data: Mapping[str, object], key: str) -> int:
    raw = data[key]
    if isinstance(raw, bool) or not isinstance(raw, int):
        raise NovaInvariantError(f"{key!r} must be an int, got {type(raw).__name__}")
    return raw


def _wire_float(data: Mapping[str, object], key: str) -> float:
    raw = data[key]
    if isinstance(raw, bool) or not isinstance(raw, int | float):
        raise NovaInvariantError(f"{key!r} must be a number, got {type(raw).__name__}")
    return float(raw)


def _wire_str(data: Mapping[str, object], key: str) -> str:
    raw = data[key]
    if not isinstance(raw, str):
        raise NovaInvariantError(f"{key!r} must be a str, got {type(raw).__name__}")
    return raw


def _optional_int(data: Mapping[str, object], key: str) -> int | None:
    raw = data[key]
    if raw is None:
        return None
    return _wire_int(data, key)


def _optional_float(data: Mapping[str, object], key: str) -> float | None:
    raw = data[key]
    if raw is None:
        return None
    return _wire_float(data, key)


def _optional_str(data: Mapping[str, object], key: str) -> str | None:
    raw = data[key]
    if raw is None:
        return None
    return _wire_str(data, key)
