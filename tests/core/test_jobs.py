"""The job vocabulary and the four scheduling policies (ADR-0010).

Everything in ``core/jobs.py`` is pure, so nothing here needs a thread, a
process, a clock or a sleep: time is passed in as milliseconds and the expected
publication schedule is asserted exactly.  That is the point of keeping policy
in L1 — a rate limit, an admission rule and a circuit breaker are decisions a
product lives or dies by, and they should be checkable in microseconds.

What is pinned here:

* **Isolation follows the priority class**, so the common declaration cannot be
  got wrong, and the two rules that exist to prevent known bugs (a large job
  may not sit on the thread pool; only an idempotent job may be retried).
* **Progress throttling** keeps its 20 Hz ceiling but never drops a stage
  change or the final report — the two events whose loss looks like a hang.
* **Admission** defers rather than kills, and defers a job while anything more
  urgent is waiting, which is what stops background work from making a dropped
  clip wait for its thumbnail.
* **The circuit breaker** moves only on a lost worker, and says why it opened.
* **Records** round-trip through JSON, because job history is read back by a
  different process than the one that wrote it.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

import pytest

from nova_studio.core import (
    CIRCUIT_BREAKER_THRESHOLD,
    DEFAULT_GRACE_PERIOD_MS,
    EXPORT_GRACE_PERIOD_MS,
    MAX_PROGRESS_HZ,
    AdmissionVerdict,
    Affinity,
    CircuitBreaker,
    Isolation,
    JobFailureKind,
    JobMemoryClass,
    JobOutcome,
    JobPriority,
    JobProgress,
    JobRecord,
    JobSpec,
    JobStatus,
    NovaInvariantError,
    PoolCapacity,
    ProgressThrottle,
    RetryPolicy,
    decide_admission,
    deferral_candidate,
)

if TYPE_CHECKING:
    from collections.abc import Mapping

pytestmark = pytest.mark.unit


def _spec(kind: str = "thumbnail", **overrides: Any) -> JobSpec:
    return JobSpec(**{"kind": kind, **overrides})


def _record(job_id: str = "job-1", **overrides: Any) -> JobRecord:
    return JobRecord(**{"job_id": job_id, "kind": "thumbnail", "submitted_ms": 1_000, **overrides})


def _round_trip(wire: Mapping[str, Any]) -> Mapping[str, Any]:
    """JSON in and out, which is what a persisted or broadcast record does."""
    return json.loads(json.dumps(wire))


class TestJobPriority:
    def test_the_five_classes_are_ordered_by_how_long_the_user_waits(self) -> None:
        assert [priority.rank for priority in JobPriority] == [0, 1, 2, 3, 4]

    def test_a_lower_rank_outranks_a_higher_one(self) -> None:
        assert JobPriority.CRITICAL.outranks(JobPriority.HIGH)
        assert JobPriority.HIGH.outranks(JobPriority.IDLE)
        assert not JobPriority.IDLE.outranks(JobPriority.NORMAL)
        assert not JobPriority.NORMAL.outranks(JobPriority.NORMAL)

    def test_long_running_classes_go_to_processes(self) -> None:
        """ADR-0010 §1: CPU-bound work must not starve the request path."""
        assert JobPriority.NORMAL.default_isolation is Isolation.PROCESS
        assert JobPriority.LOW.default_isolation is Isolation.PROCESS

    def test_latency_sensitive_classes_stay_on_threads(self) -> None:
        assert JobPriority.CRITICAL.default_isolation is Isolation.THREAD
        assert JobPriority.HIGH.default_isolation is Isolation.THREAD
        assert JobPriority.IDLE.default_isolation is Isolation.THREAD

    def test_every_class_has_a_rank(self) -> None:
        """A missing entry would raise KeyError on the first admission."""
        assert set(JobPriority) == set(_ranks().keys())


def _ranks() -> dict[JobPriority, int]:
    return {priority: priority.rank for priority in JobPriority}


class TestJobStatus:
    def test_terminal_statuses_release_the_slot(self) -> None:
        assert JobStatus.PENDING.is_active
        assert JobStatus.RUNNING.is_active
        assert not JobStatus.SUCCEEDED.is_active
        assert not JobStatus.CANCELLED.is_active
        assert not JobStatus.INTERRUPTED.is_active

    def test_active_is_the_negation_of_terminal(self) -> None:
        for status in JobStatus:
            assert status.is_active is not status.is_terminal

    def test_only_success_produced_something_usable(self) -> None:
        assert JobStatus.SUCCEEDED.succeeded
        assert not JobStatus.CANCELLED.succeeded
        assert not JobStatus.INTERRUPTED.succeeded

    def test_an_interrupt_is_not_a_failure(self) -> None:
        """The user is offered a resume, not an error report."""
        assert JobStatus.INTERRUPTED.is_terminal
        assert not JobStatus.INTERRUPTED.succeeded


class TestJobKindNames:
    @pytest.mark.parametrize(
        "kind", ["export.mp4", "asr.transcribe", "thumbnail", "a", "proxy.h264"]
    )
    def test_a_dotted_slug_is_accepted(self, kind: str) -> None:
        assert _spec(kind).kind == kind

    @pytest.mark.parametrize("kind", ["", "Export", "export mp4", "export.", "1st", "export.MP4"])
    def test_anything_else_is_refused(self, kind: str) -> None:
        """The kind keys the circuit breaker and telemetry; free text splits them."""
        with pytest.raises(NovaInvariantError, match="dotted lowercase slug"):
            _spec(kind)


class TestRetryPolicy:
    def test_the_default_is_never_retry(self) -> None:
        policy = RetryPolicy()
        assert policy.max_attempts == 1
        assert policy.retries == 0

    def test_the_default_retries_only_a_lost_worker(self) -> None:
        """The one failure where a second attempt is known to be safe."""
        policy = RetryPolicy(max_attempts=3)
        assert policy.should_retry(1, JobFailureKind.WORKER_LOST)
        assert not policy.should_retry(1, JobFailureKind.TIMEOUT)
        assert not policy.should_retry(1, JobFailureKind.FAULT)
        assert not policy.should_retry(1, JobFailureKind.CANCELLED)

    def test_the_last_attempt_is_not_retried(self) -> None:
        policy = RetryPolicy(max_attempts=3)
        assert policy.should_retry(2, JobFailureKind.WORKER_LOST)
        assert not policy.should_retry(3, JobFailureKind.WORKER_LOST)

    def test_the_delay_doubles_per_attempt(self) -> None:
        policy = RetryPolicy(max_attempts=5, base_delay_ms=500)
        assert [policy.delay_for(attempt) for attempt in (1, 2, 3)] == [500, 1_000, 2_000]

    def test_the_delay_is_capped(self) -> None:
        policy = RetryPolicy(base_delay_ms=1_000, max_delay_ms=5_000)
        assert policy.delay_for(10) == 5_000

    def test_the_delay_is_deterministic(self) -> None:
        """L1 has no randomness, so the schedule is assertable."""
        assert RetryPolicy().delay_for(2) == RetryPolicy().delay_for(2)

    def test_attempt_zero_is_meaningless(self) -> None:
        with pytest.raises(NovaInvariantError, match="at least 1"):
            RetryPolicy().delay_for(0)

    @pytest.mark.parametrize(
        "overrides",
        [
            {"max_attempts": 0},
            {"base_delay_ms": -1},
            {"base_delay_ms": 100, "max_delay_ms": 50},
        ],
    )
    def test_nonsense_is_refused(self, overrides: dict[str, Any]) -> None:
        with pytest.raises(NovaInvariantError):
            RetryPolicy(**overrides)

    def test_a_policy_survives_json(self) -> None:
        policy = RetryPolicy(max_attempts=4, base_delay_ms=250, max_delay_ms=4_000)
        assert RetryPolicy.from_wire(_round_trip(policy.to_wire())) == policy

    def test_a_wire_policy_rejects_unknown_fields(self) -> None:
        wire = dict(RetryPolicy().to_wire(), surprise=1)
        with pytest.raises(NovaInvariantError, match="fields must be exactly"):
            RetryPolicy.from_wire(wire)


class TestJobSpec:
    def test_a_spec_declares_only_a_kind_by_default(self) -> None:
        spec = _spec()
        assert spec.priority is JobPriority.NORMAL
        assert spec.isolation is Isolation.THREAD
        assert spec.memory_class is JobMemoryClass.SMALL
        assert spec.affinity is Affinity.ANY
        assert spec.cancellable
        assert not spec.idempotent

    def test_of_infers_the_pool_from_the_priority(self) -> None:
        assert JobSpec.of("export.mp4", JobPriority.NORMAL).isolation is Isolation.PROCESS
        assert JobSpec.of("thumbnail", JobPriority.CRITICAL).isolation is Isolation.THREAD

    def test_an_explicit_isolation_wins(self) -> None:
        """A GPU inference job wants the calling thread, not a fresh process."""
        spec = JobSpec.of("asr.transcribe", JobPriority.LOW, isolation=Isolation.THREAD)
        assert spec.isolation is Isolation.THREAD

    def test_a_large_job_may_not_run_on_the_thread_pool(self) -> None:
        """A CPU-heavy thread job is the GIL starvation ADR-0010 §1 prevents."""
        with pytest.raises(NovaInvariantError, match="must run in a process"):
            _spec(memory_class=JobMemoryClass.LARGE)

    def test_a_large_job_in_a_process_is_fine(self) -> None:
        spec = _spec(memory_class=JobMemoryClass.LARGE, isolation=Isolation.PROCESS)
        assert spec.isolation is Isolation.PROCESS

    def test_a_process_job_needs_a_watchdog_deadline(self) -> None:
        with pytest.raises(NovaInvariantError, match="grace_period_ms"):
            _spec(isolation=Isolation.PROCESS, grace_period_ms=0)

    def test_the_export_grace_period_protects_the_mux(self) -> None:
        """ADR-0010 §4: 30 s, because a killed mux leaves an unplayable file."""
        assert EXPORT_GRACE_PERIOD_MS == 30_000
        assert DEFAULT_GRACE_PERIOD_MS == 5_000
        spec = _spec(
            kind="export.mp4",
            isolation=Isolation.PROCESS,
            grace_period_ms=EXPORT_GRACE_PERIOD_MS,
        )
        assert spec.grace_period_ms == EXPORT_GRACE_PERIOD_MS

    def test_a_non_positive_timeout_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="timeout_ms"):
            _spec(timeout_ms=0)

    def test_an_unbounded_timeout_is_allowed(self) -> None:
        """Acceptable only for work the user can cancel; the spec cannot know."""
        assert _spec(timeout_ms=None).timeout_ms is None

    def test_retries_require_idempotence(self) -> None:
        """A retried non-idempotent export is silent corruption."""
        with pytest.raises(NovaInvariantError, match="not idempotent"):
            _spec(retry=RetryPolicy(max_attempts=3))

    def test_an_idempotent_job_may_retry(self) -> None:
        spec = _spec(idempotent=True, retry=RetryPolicy(max_attempts=3))
        assert spec.is_retryable

    def test_progress_rate_is_capped(self) -> None:
        assert MAX_PROGRESS_HZ == 20
        with pytest.raises(NovaInvariantError, match="max_progress_hz"):
            _spec(max_progress_hz=120)

    def test_the_progress_interval_follows_the_rate(self) -> None:
        assert _spec().progress_interval_ms == 50
        assert _spec(max_progress_hz=10).progress_interval_ms == 100
        assert _spec(max_progress_hz=1).progress_interval_ms == 1_000

    def test_a_dedupe_key_collapses_identical_work(self) -> None:
        spec = _spec(dedupe_key="asset-7:240x135")
        assert spec.dedupe_key == "asset-7:240x135"

    def test_a_spec_survives_json(self) -> None:
        spec = JobSpec(
            kind="export.mp4",
            priority=JobPriority.NORMAL,
            isolation=Isolation.PROCESS,
            affinity=Affinity.IO,
            idempotent=True,
            timeout_ms=600_000,
            grace_period_ms=EXPORT_GRACE_PERIOD_MS,
            retry=RetryPolicy(max_attempts=3),
            dedupe_key="project-1:spec-9",
        )
        assert JobSpec.from_wire(_round_trip(spec.to_wire())) == spec

    def test_a_wire_spec_rejects_unknown_fields(self) -> None:
        with pytest.raises(NovaInvariantError, match="fields must be exactly"):
            JobSpec.from_wire(dict(_spec().to_wire(), extra=1))

    def test_a_wire_spec_rejects_a_malformed_nested_policy(self) -> None:
        wire = dict(_spec().to_wire())
        wire["retry"] = "often"
        with pytest.raises(NovaInvariantError, match="must be a mapping"):
            JobSpec.from_wire(wire)


class TestJobProgress:
    def test_a_fresh_report_is_empty(self) -> None:
        progress = JobProgress()
        assert progress.fraction == 0.0
        assert progress.percent == 0
        assert not progress.is_complete

    @pytest.mark.parametrize(
        ("fraction", "percent"), [(0.0, 0), (0.5, 50), (0.999, 100), (1.0, 100)]
    )
    def test_the_percent_is_rounded_for_a_bar(self, fraction: float, percent: int) -> None:
        assert JobProgress(fraction=fraction).percent == percent

    def test_completion_is_the_fraction_reaching_one(self) -> None:
        assert JobProgress(fraction=1.0).is_complete
        assert not JobProgress(fraction=0.999).is_complete

    @pytest.mark.parametrize("fraction", [-0.1, 1.1, 2.0])
    def test_a_fraction_outside_the_range_is_refused(self, fraction: float) -> None:
        with pytest.raises(NovaInvariantError, match="within"):
            JobProgress(fraction=fraction)

    def test_a_negative_eta_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="eta_seconds"):
            JobProgress(eta_seconds=-1.0)

    def test_a_stage_names_what_the_job_is_doing(self) -> None:
        """A bar that stops moving while the stage changes reads as a hang."""
        progress = JobProgress(fraction=0.4, stage="encoding", eta_seconds=12.0)
        assert progress.stage == "encoding"

    def test_partial_results_ride_the_same_channel(self) -> None:
        progress = JobProgress(fraction=0.2, payload={"hypothesis": "hello wor"})
        assert progress.payload == {"hypothesis": "hello wor"}

    def test_a_report_survives_json(self) -> None:
        progress = JobProgress(
            fraction=0.42, stage="muxing", eta_seconds=1.5, detail="frame 1842", payload={"n": 1}
        )
        assert JobProgress.from_wire(_round_trip(progress.to_wire())) == progress

    def test_a_null_payload_round_trips(self) -> None:
        progress = JobProgress(fraction=0.1)
        restored = JobProgress.from_wire(_round_trip(progress.to_wire()))
        assert restored.payload is None

    def test_a_wire_report_rejects_unknown_fields(self) -> None:
        with pytest.raises(NovaInvariantError, match="fields must be exactly"):
            JobProgress.from_wire(dict(JobProgress().to_wire(), extra=1))


class TestJobOutcome:
    def test_an_empty_outcome_is_valid(self) -> None:
        outcome = JobOutcome()
        assert not outcome.has_value
        assert outcome.artefacts == ()

    def test_artefacts_name_files_that_are_complete(self) -> None:
        """A cancelled export promotes nothing, so it lists nothing."""
        outcome = JobOutcome(artefacts=("/tmp/out.mp4",), detail="1842 frames, 24.6 MB")
        assert outcome.has_value is False
        assert outcome.artefacts == ("/tmp/out.mp4",)

    def test_a_value_counts_even_when_it_is_falsy(self) -> None:
        assert JobOutcome(value=0).has_value
        assert not JobOutcome(value=None).has_value


class TestJobRecord:
    def test_a_new_record_is_pending(self) -> None:
        record = _record()
        assert record.status is JobStatus.PENDING
        assert record.is_active
        assert record.attempts == 0

    def test_running_requires_a_start_time(self) -> None:
        with pytest.raises(NovaInvariantError, match="requires started_ms"):
            _record(status=JobStatus.RUNNING)

    def test_a_terminal_status_requires_a_finish_time(self) -> None:
        with pytest.raises(NovaInvariantError, match="requires finished_ms"):
            _record(status=JobStatus.SUCCEEDED, started_ms=1_500)

    def test_time_does_not_run_backwards(self) -> None:
        with pytest.raises(NovaInvariantError, match="must not precede"):
            _record(status=JobStatus.SUCCEEDED, started_ms=2_000, finished_ms=1_500)

    def test_only_a_failed_or_stopped_job_carries_an_error_code(self) -> None:
        with pytest.raises(NovaInvariantError, match="must not carry error_code"):
            _record(status=JobStatus.RUNNING, started_ms=1_500, error_code="NS-JOB-5003")

    def test_an_interrupted_job_may_carry_an_explanation(self) -> None:
        record = _record(status=JobStatus.INTERRUPTED, started_ms=1_500, finished_ms=9_000)
        assert record.status is JobStatus.INTERRUPTED

    def test_a_job_can_be_interrupted_before_it_started(self) -> None:
        """The editor died between "submitted" and "admitted".

        The record must survive that, because the job is one the user asked
        for — and it must not claim a start time, because there was not one.
        """
        record = _record().interrupted(9_000)
        assert record.status is JobStatus.INTERRUPTED
        assert record.started_ms is None
        assert "before this job started" in (record.error_message or "")

    def test_a_negative_attempt_count_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="attempts"):
            _record(attempts=-1)

    def test_empty_identifiers_are_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="job_id"):
            JobRecord(job_id="", kind="thumbnail", submitted_ms=0)
        with pytest.raises(NovaInvariantError, match="kind"):
            JobRecord(job_id="job-1", kind="", submitted_ms=0)

    def test_elapsed_time_uses_the_clock_until_the_job_finishes(self) -> None:
        assert _record(submitted_ms=1_000).elapsed_ms(now_ms=6_000) == 5_000

    def test_a_finished_job_reports_its_duration(self) -> None:
        record = _record(
            status=JobStatus.SUCCEEDED, started_ms=1_500, finished_ms=4_000, submitted_ms=1_000
        )
        assert record.elapsed_ms(now_ms=99_999) == 3_000

    def test_starting_records_the_attempt(self) -> None:
        record = _record().started(1_500, attempt=1)
        assert record.status is JobStatus.RUNNING
        assert record.attempts == 1
        assert record.started_ms == 1_500

    def test_a_retry_clears_the_previous_error(self) -> None:
        failed = _record(
            status=JobStatus.FAILED,
            started_ms=1_500,
            finished_ms=2_000,
            attempts=1,
            error_code="NS-JOB-5003",
            error_message="worker died",
        )
        restarted = failed.started(2_500, attempt=2)
        assert restarted.attempts == 2
        assert restarted.error_code is None
        assert restarted.error_message is None
        assert restarted.status is JobStatus.RUNNING
        assert restarted.finished_ms is None
        assert restarted.started_ms == 2_500
        assert restarted.progress.fraction == 0.0

    def test_success_completes_the_progress_bar(self) -> None:
        record = _record(status=JobStatus.RUNNING, started_ms=1_500).succeeded(
            4_000, artefacts=("/tmp/out.mp4",)
        )
        assert record.status is JobStatus.SUCCEEDED
        assert record.progress.is_complete
        assert record.artefacts == ("/tmp/out.mp4",)

    def test_failure_carries_a_stable_code(self) -> None:
        record = _record(status=JobStatus.RUNNING, started_ms=1_500).failed(
            4_000, code="NS-JOB-5003", message="worker died"
        )
        assert record.error_code == "NS-JOB-5003"
        assert record.status is JobStatus.FAILED

    def test_cancellation_leaves_no_artefacts(self) -> None:
        """A half-written file on the desktop is worse than none."""
        record = _record(
            status=JobStatus.RUNNING, started_ms=1_500, artefacts=("/tmp/partial.mp4",)
        ).cancelled(4_000)
        assert record.status is JobStatus.CANCELLED
        assert record.artefacts == ()
        assert record.error_code is None

    def test_interruption_says_what_happened(self) -> None:
        record = _record(status=JobStatus.RUNNING, started_ms=1_500).interrupted(9_000)
        assert record.status is JobStatus.INTERRUPTED
        assert "editor closed" in (record.error_message or "")

    def test_a_checkpoint_is_a_resume_point(self) -> None:
        record = _record().with_checkpoint({"frames": 1_842})
        assert record.checkpoint == {"frames": 1_842}

    def test_transitions_do_not_mutate(self) -> None:
        """The record is broadcast to the frontend; a shared object would be
        observed half-updated (ADR-0013)."""
        original = _record()
        original.started(1_500)
        assert original.status is JobStatus.PENDING

    def test_a_record_survives_json(self) -> None:
        record = _record(
            status=JobStatus.RUNNING,
            started_ms=1_500,
            attempts=1,
            progress=JobProgress(fraction=0.5, stage="encoding"),
            checkpoint={"frames": 100},
            params_hash="deadbeef",
            artefacts=("/tmp/a.mp4",),
        )
        assert JobRecord.from_wire(_round_trip(record.to_wire())) == record

    def test_a_wire_record_rejects_unknown_fields(self) -> None:
        with pytest.raises(NovaInvariantError, match="fields must be exactly"):
            JobRecord.from_wire(dict(_record().to_wire(), extra=1))


class TestPoolCapacity:
    def test_one_core_reserves_nothing_and_keeps_one_worker(self) -> None:
        """ADR-0010 §8: ``max(1, cores - 1)`` — but threads still need two."""
        capacity = PoolCapacity.detect(1)
        assert capacity.processes == 1
        assert capacity.threads == 2
        assert capacity.gpu == 0

    def test_a_core_is_reserved_for_the_ui(self) -> None:
        assert PoolCapacity.detect(8).threads == 7
        assert PoolCapacity.detect(8).processes == 3

    def test_a_gpu_is_one_context_unless_proven_otherwise(self) -> None:
        assert PoolCapacity.detect(8).gpu == 0
        assert PoolCapacity.detect(8, gpu_present=True).gpu == 1

    def test_io_is_capped_separately(self) -> None:
        assert PoolCapacity.detect(4).io == 3
        assert PoolCapacity.detect(64).io == 8

    def test_a_machine_with_no_cores_is_nonsense(self) -> None:
        with pytest.raises(NovaInvariantError, match="physical_cores"):
            PoolCapacity.detect(0)

    def test_slots_follow_affinity_then_isolation(self) -> None:
        capacity = PoolCapacity(threads=4, processes=2, gpu=1, io=6)
        assert capacity.slots_for(JobSpec.of("thumbnail", JobPriority.CRITICAL)) == 4
        assert capacity.slots_for(JobSpec.of("export.mp4", JobPriority.NORMAL)) == 2
        assert capacity.slots_for(_spec(affinity=Affinity.GPU)) == 1
        assert capacity.slots_for(_spec(affinity=Affinity.IO)) == 6

    def test_a_user_override_may_only_tighten(self) -> None:
        """Raising a cap above what was measured is how an editor freezes."""
        measured = PoolCapacity.detect(8, gpu_present=True)
        user = PoolCapacity(threads=2, processes=1, gpu=0, io=2)
        assert measured.overridden_by(user) == user

    def test_an_override_that_asks_for_more_is_ignored(self) -> None:
        measured = PoolCapacity(threads=4, processes=2, gpu=0, io=4)
        greedy = PoolCapacity(threads=64, processes=64, gpu=8, io=64)
        assert measured.overridden_by(greedy) == measured

    def test_negative_caps_are_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="threads"):
            PoolCapacity(threads=-1)


class TestAdmission:
    def test_a_free_slot_is_granted(self) -> None:
        spec = JobSpec.of("thumbnail", JobPriority.CRITICAL)
        verdict = decide_admission(spec, {}, {}, PoolCapacity(threads=2))
        assert verdict is AdmissionVerdict.ADMIT

    def test_a_full_pool_defers(self) -> None:
        """Deferred, never killed: running work keeps its slot (ADR-0010 §1)."""
        spec = JobSpec.of("thumbnail", JobPriority.CRITICAL)
        verdict = decide_admission(spec, {Isolation.THREAD: 2}, {}, PoolCapacity(threads=2))
        assert verdict is AdmissionVerdict.DEFER

    def test_a_pool_with_no_slots_rejects(self) -> None:
        """Queueing work that can never start is a leak with a progress bar."""
        spec = JobSpec.of("thumbnail", JobPriority.CRITICAL)
        verdict = decide_admission(spec, {}, {}, PoolCapacity(threads=0))
        assert verdict is AdmissionVerdict.REJECT

    def test_gpu_work_is_rejected_where_there_is_no_gpu(self) -> None:
        """ADR-0012 §2: refuse at admission rather than fail halfway through."""
        spec = _spec(kind="asr.transcribe", affinity=Affinity.GPU, isolation=Isolation.PROCESS)
        assert decide_admission(spec, {}, {}, PoolCapacity.detect(8)) is AdmissionVerdict.REJECT
        assert (
            decide_admission(spec, {}, {}, PoolCapacity.detect(8, gpu_present=True))
            is AdmissionVerdict.ADMIT
        )

    def test_urgent_work_is_not_made_to_wait_behind_background_work(self) -> None:
        """Eight waveform jobs must not delay a dropped clip's thumbnail."""
        idle = JobSpec.of("waveform", JobPriority.IDLE)
        queued = {JobPriority.CRITICAL: 1}
        assert (
            decide_admission(idle, {Isolation.THREAD: 1}, queued, PoolCapacity(threads=4))
            is AdmissionVerdict.DEFER
        )

    def test_background_work_does_not_block_urgent_work(self) -> None:
        critical = JobSpec.of("thumbnail", JobPriority.CRITICAL)
        queued = {JobPriority.IDLE: 8}
        assert (
            decide_admission(critical, {Isolation.THREAD: 1}, queued, PoolCapacity(threads=4))
            is AdmissionVerdict.ADMIT
        )

    def test_a_job_of_equal_urgency_does_not_defer_itself(self) -> None:
        spec = JobSpec.of("thumbnail", JobPriority.CRITICAL)
        queued = {JobPriority.CRITICAL: 1}
        assert (
            decide_admission(spec, {Isolation.THREAD: 1}, queued, PoolCapacity(threads=4))
            is AdmissionVerdict.ADMIT
        )

    def test_the_deferral_candidate_is_the_least_urgent_waiter(self) -> None:
        assert (
            deferral_candidate({JobPriority.CRITICAL: 1, JobPriority.IDLE: 2}) is JobPriority.IDLE
        )
        assert deferral_candidate({JobPriority.NORMAL: 1, JobPriority.LOW: 1}) is JobPriority.LOW

    def test_an_empty_queue_has_no_candidate(self) -> None:
        assert deferral_candidate({}) is None
        assert deferral_candidate({JobPriority.HIGH: 0}) is None


class TestProgressThrottle:
    def test_the_first_report_always_goes_out(self) -> None:
        throttle = ProgressThrottle()
        assert throttle.should_emit(1_000)

    def test_twenty_hertz_is_a_fifty_millisecond_gap(self) -> None:
        throttle = ProgressThrottle()
        assert throttle.interval_ms == 50

    def test_a_report_inside_the_window_is_dropped(self) -> None:
        throttle = ProgressThrottle()
        throttle.note(1_000)
        assert not throttle.should_emit(1_049)

    def test_a_report_on_the_boundary_is_allowed(self) -> None:
        throttle = ProgressThrottle()
        throttle.note(1_000)
        assert throttle.should_emit(1_050)

    def test_sixty_frames_a_second_do_not_become_sixty_messages(self) -> None:
        """ADR-0010 §3: the UI cannot show more than 20 Hz anyway.

        A 60 fps job publishes on every fourth frame (64 ms apart), so a second
        of work costs 15 messages instead of 60.
        """
        throttle = ProgressThrottle()
        published = 0
        for frame in range(60):
            now = 1_000 + frame * 16
            if throttle.should_emit(now):
                throttle.note(now)
                published += 1
        assert published == 15
        assert published * 4 == 60

    def test_a_stage_change_is_never_dropped(self) -> None:
        """A bar that sits still while the stage changes looks hung."""
        throttle = ProgressThrottle()
        throttle.note(1_000)
        assert throttle.should_emit(1_010, important=True)

    def test_the_final_report_is_never_dropped(self) -> None:
        """Otherwise the UI keeps a finished job at 99 % forever."""
        throttle = ProgressThrottle()
        throttle.note(1_000)
        assert throttle.should_emit(1_005, important=True)

    def test_a_restarted_job_reports_immediately(self) -> None:
        throttle = ProgressThrottle()
        throttle.note(1_000)
        throttle.reset()
        assert throttle.should_emit(1_001)

    def test_a_slower_rate_is_honoured(self) -> None:
        throttle = ProgressThrottle(max_hz=4)
        assert throttle.interval_ms == 250
        throttle.note(1_000)
        assert not throttle.should_emit(1_200)
        assert throttle.should_emit(1_250)

    @pytest.mark.parametrize("hz", [0, 21, 1_000])
    def test_the_rate_is_bounded(self, hz: int) -> None:
        with pytest.raises(NovaInvariantError, match="max_hz"):
            ProgressThrottle(max_hz=hz)


class TestCircuitBreaker:
    def test_a_kind_starts_enabled(self) -> None:
        breaker = CircuitBreaker()
        assert not breaker.is_open("export.mp4")
        assert breaker.reason("export.mp4") == ""
        assert breaker.open_kinds() == ()

    def test_one_loss_is_a_warning_not_a_disable(self) -> None:
        breaker = CircuitBreaker()
        assert not breaker.record_failure("export.mp4", JobFailureKind.WORKER_LOST)
        assert not breaker.is_open("export.mp4")

    def test_two_consecutive_losses_disable_the_kind(self) -> None:
        """ADR-0010 §5: the exact threshold."""
        assert CIRCUIT_BREAKER_THRESHOLD == 2
        breaker = CircuitBreaker()
        breaker.record_failure("export.mp4", JobFailureKind.WORKER_LOST)
        assert breaker.record_failure("export.mp4", JobFailureKind.WORKER_LOST)
        assert breaker.is_open("export.mp4")

    def test_only_a_lost_worker_moves_it(self) -> None:
        """A timeout or a returned Err means the worker survived."""
        breaker = CircuitBreaker()
        for _ in range(5):
            breaker.record_failure("export.mp4", JobFailureKind.TIMEOUT)
        assert not breaker.is_open("export.mp4")

    def test_a_success_clears_the_streak(self) -> None:
        breaker = CircuitBreaker()
        breaker.record_failure("export.mp4", JobFailureKind.WORKER_LOST)
        breaker.record_success("export.mp4")
        assert not breaker.record_failure("export.mp4", JobFailureKind.WORKER_LOST)
        assert not breaker.is_open("export.mp4")

    def test_a_success_does_not_silently_re_enable(self) -> None:
        """Re-enabling is a deliberate act; a stray success must not undo it."""
        breaker = CircuitBreaker()
        breaker.record_failure("export.mp4", JobFailureKind.WORKER_LOST)
        breaker.record_failure("export.mp4", JobFailureKind.WORKER_LOST)
        breaker.record_success("export.mp4")
        assert breaker.is_open("export.mp4")

    def test_reset_re_enables_the_kind(self) -> None:
        breaker = CircuitBreaker()
        breaker.record_failure("export.mp4", JobFailureKind.WORKER_LOST)
        breaker.record_failure("export.mp4", JobFailureKind.WORKER_LOST)
        breaker.reset("export.mp4")
        assert not breaker.is_open("export.mp4")
        assert not breaker.record_failure("export.mp4", JobFailureKind.WORKER_LOST)

    def test_the_reason_names_the_kind_and_the_count(self) -> None:
        """This text is what the UI shows instead of failing a third time."""
        breaker = CircuitBreaker()
        breaker.record_failure("export.hevc", JobFailureKind.WORKER_LOST)
        breaker.record_failure("export.hevc", JobFailureKind.WORKER_LOST)
        reason = breaker.reason("export.hevc")
        assert "export.hevc" in reason
        assert "2 consecutive worker losses" in reason

    def test_one_kind_does_not_disable_another(self) -> None:
        breaker = CircuitBreaker()
        breaker.record_failure("export.hevc", JobFailureKind.WORKER_LOST)
        breaker.record_failure("export.hevc", JobFailureKind.WORKER_LOST)
        assert not breaker.is_open("export.mp4")

    def test_disabled_kinds_are_listed_in_stable_order(self) -> None:
        breaker = CircuitBreaker()
        for kind in ("proxy.transcode", "asr.transcribe", "export.hevc"):
            breaker.record_failure(kind, JobFailureKind.WORKER_LOST)
            breaker.record_failure(kind, JobFailureKind.WORKER_LOST)
        assert breaker.open_kinds() == ("asr.transcribe", "export.hevc", "proxy.transcode")

    def test_the_threshold_is_configurable(self) -> None:
        breaker = CircuitBreaker(threshold=1)
        assert breaker.threshold == 1
        assert breaker.record_failure("export.mp4", JobFailureKind.WORKER_LOST)

    def test_a_threshold_below_one_is_nonsense(self) -> None:
        with pytest.raises(NovaInvariantError, match="threshold"):
            CircuitBreaker(threshold=0)
