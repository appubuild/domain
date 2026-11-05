"""`api/job_events.py`: the executor's vocabulary, on the bus.

The executor speaks `JobObserver`; the frontend speaks topics. This is the only
place either learns about the other, so what is being pinned is the *translation*
— and three properties of it that a client depends on:

* **The payload is the whole record, or the whole report.** A client that
  reconnects mid-export resyncs from the next event, which is what lets the UI
  be event-driven rather than event-driven with a polling fallback nobody
  removed (ADR-0010 §7).
* **`job.failed` exists beside `job.status`.** It is a second *name* for a
  subset of the stream, so a notifier can subscribe to failures without
  filtering a stream it otherwise ignores — not a second stream.
* **The bridge can be removed.** An observer that could not be unsubscribed
  would keep publishing into a bus that has been shut down.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import pytest

from nova_studio.api.job_events import FAILED, PROGRESSED, STATUS, JobEventBridge, install
from nova_studio.core.jobs import JobProgress, JobStatus
from tests.api.job_fakes import record_of

if TYPE_CHECKING:
    from nova_studio.core.events import EventBus
    from nova_studio.infra.jobs import ConcurrentJobExecutor

pytestmark = pytest.mark.unit

#: The kind every record here carries.
KIND: str = "render.export"


@pytest.fixture
def bridge(bus: EventBus) -> JobEventBridge:
    return JobEventBridge(bus)


def topics(bus: EventBus) -> list[str]:
    """The topics the bus has carried, in order."""
    return [str(event.topic) for event in bus.history]


class TestProgress:
    """`job.progressed` — one report, published whole."""

    def test_a_report_carries_the_id_and_the_numbers(
        self, bus: EventBus, bridge: JobEventBridge
    ) -> None:
        bus.start()
        bridge.on_progress("job-7", JobProgress(fraction=0.5, stage="encoding"))
        event = bus.history[-1]
        assert event.topic == PROGRESSED
        assert event.payload["job_id"] == "job-7"
        assert event.payload["progress"]["stage"] == "encoding"
        assert event.payload["progress"]["fraction"] == 0.5

    def test_the_source_says_who_spoke(self, bus: EventBus, bridge: JobEventBridge) -> None:
        bus.start()
        bridge.on_progress("job-7", JobProgress())
        assert bus.history[-1].source == "jobs"


class TestStatus:
    """`job.status` — every change of state, carrying the record."""

    def test_a_change_of_state_carries_the_whole_record(
        self, bus: EventBus, bridge: JobEventBridge
    ) -> None:
        """So a client that missed the earlier events can resync from this."""
        bus.start()
        bridge.on_status(record_of("job-7", KIND, status=JobStatus.RUNNING))
        event = bus.history[-1]
        assert event.topic == STATUS
        assert event.payload["job_id"] == "job-7"
        assert event.payload["status"] == "running"
        assert event.payload["submitted_ms"] == 1_000

    def test_a_failure_is_published_under_both_names(
        self, bus: EventBus, bridge: JobEventBridge
    ) -> None:
        bus.start()
        bridge.on_status(record_of("job-7", KIND, status=JobStatus.FAILED))
        assert topics(bus) == [STATUS, FAILED]

    def test_a_success_is_not_a_failure(self, bus: EventBus, bridge: JobEventBridge) -> None:
        bus.start()
        bridge.on_status(record_of("job-7", KIND, status=JobStatus.SUCCEEDED))
        assert topics(bus) == [STATUS]

    def test_a_cancellation_is_not_a_failure_either(
        self, bus: EventBus, bridge: JobEventBridge
    ) -> None:
        """Cancelled is not a fault, and a toast that said otherwise would be
        telling the user they broke something they stopped on purpose."""
        bus.start()
        bridge.on_status(record_of("job-7", KIND, status=JobStatus.CANCELLED))
        assert FAILED not in topics(bus)

    def test_the_payload_is_a_copy(self, bus: EventBus, bridge: JobEventBridge) -> None:
        """Published twice — under `job.status` and `job.failed` — so the two
        events must not be able to change each other's payload."""
        bus.start()
        bridge.on_status(record_of("job-7", KIND, status=JobStatus.FAILED))
        first, second = bus.history[-2], bus.history[-1]
        assert first.payload is not second.payload
        assert first.payload == second.payload


class TestInstalling:
    """`install` — and the promise that it can be undone."""

    def test_it_subscribes_the_bridge(self, bus: EventBus) -> None:
        class Recorder:
            def __init__(self) -> None:
                self.observers: list[Any] = []

            def subscribe(self, observer: Any) -> Any:
                self.observers.append(observer)
                return lambda: None

        recorder = Recorder()
        install(recorder, bus)
        assert isinstance(recorder.observers[0], JobEventBridge)

    def test_unsubscribing_stops_the_events(self, bus: EventBus) -> None:
        """A session being torn down must not leave an observer publishing into
        a bus that is about to be shut down."""

        class Source:
            """The narrowest thing `install` will accept: it only listens."""

            def __init__(self) -> None:
                self.observers: list[JobEventBridge] = []

            def subscribe(self, observer: JobEventBridge) -> Any:
                self.observers.append(observer)

                def unsubscribe() -> None:
                    self.observers.remove(observer)

                return unsubscribe

        source = Source()
        unsubscribe = install(source, bus)
        assert len(source.observers) == 1

        source.observers[0].on_status(record_of("job-7", KIND))
        assert topics(bus) == [STATUS]

        unsubscribe()
        assert source.observers == []

    def test_the_source_can_be_named(self, bus: EventBus) -> None:
        """So a client can tell a job's own report from a service narrating
        one."""
        bus.start()
        bridge = JobEventBridge(bus, source="test.jobs")
        bridge.on_progress("job-7", JobProgress())
        assert bus.history[-1].source == "test.jobs"


def test_a_real_executor_can_be_bridged(bus: EventBus, tmp_path: Any) -> None:
    """The shape is the port's, not the stand-in's: the real adapter satisfies
    it, so a test double that only passed against another double would be
    worthless."""
    from nova_studio.infra.jobs import ConcurrentJobExecutor
    from nova_studio.infra.persistence.jobs import (
        JsonJobStore,
        job_history_path,
    )

    store = JsonJobStore(job_history_path(tmp_path))
    executor: ConcurrentJobExecutor = ConcurrentJobExecutor(store=store)
    with executor:
        unsubscribe = install(executor, bus)
        unsubscribe()
