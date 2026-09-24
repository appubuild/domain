"""Event bus tests: ordering, isolation, back-pressure and replay (ADR §5.1)."""

from __future__ import annotations

import asyncio
import threading
from dataclasses import FrozenInstanceError, dataclass
from typing import Any

import pytest

from nova_studio.core.events import (
    DeliveryMode,
    EventBus,
    EventEnvelope,
    EventPayload,
)

pytestmark = pytest.mark.unit


@dataclass(frozen=True, slots=True)
class ClipMoved(EventPayload):
    """A representative payload.

    ``EventPayload`` is a frozen slotted dataclass, so subclasses must carry the
    decorator too — a bare annotation block would leave the fields undeclared.
    """

    clip_id: str
    start: int


class TestPublicationAndDelivery:
    def test_sync_handlers_run_before_publish_returns(self) -> None:
        """The defining property of SYNC: the publisher cannot proceed first."""
        bus = EventBus(autostart=False)
        seen: list[int] = []
        bus.subscribe("t", lambda e: seen.append(e.payload.start), mode=DeliveryMode.SYNC)
        for index in range(5):
            bus.publish("t", ClipMoved(clip_id="c", start=index))
            assert seen == list(range(index + 1))
        bus.shutdown()

    def test_queued_handlers_preserve_order(self) -> None:
        bus = EventBus()
        seen: list[int] = []
        bus.subscribe("t", lambda e: seen.append(e.payload.start))
        for index in range(50):
            bus.publish("t", ClipMoved(clip_id="c", start=index))
        assert bus.drain(timeout=5)
        assert seen == list(range(50))
        bus.shutdown()

    def test_sequence_numbers_are_monotonic(self) -> None:
        bus = EventBus(autostart=False)
        sequences = [bus.publish("t", ClipMoved(clip_id="c", start=i)).seq for i in range(10)]
        assert sequences == sorted(sequences)
        assert len(set(sequences)) == 10
        assert bus.last_seq == sequences[-1]
        bus.shutdown()

    def test_priority_orders_sync_handlers(self) -> None:
        bus = EventBus(autostart=False)
        order: list[str] = []
        bus.subscribe("t", lambda e: order.append("low"), mode=DeliveryMode.SYNC, priority=0)
        bus.subscribe("t", lambda e: order.append("high"), mode=DeliveryMode.SYNC, priority=10)
        bus.subscribe("t", lambda e: order.append("mid"), mode=DeliveryMode.SYNC, priority=5)
        bus.publish("t", ClipMoved(clip_id="c", start=0))
        assert order == ["high", "mid", "low"]
        bus.shutdown()

    def test_multiple_topics_on_one_subscription(self) -> None:
        bus = EventBus(autostart=False)
        seen: list[str] = []
        bus.subscribe(["a", "b"], lambda e: seen.append(e.topic), mode=DeliveryMode.SYNC)
        bus.publish("a", None)
        bus.publish("b", None)
        bus.publish("c", None)
        assert seen == ["a", "b"]
        bus.shutdown()

    def test_prefix_subscription(self) -> None:
        bus = EventBus(autostart=False)
        seen: list[str] = []
        bus.subscribe_prefix("caption.", lambda e: seen.append(e.topic), mode=DeliveryMode.SYNC)
        for topic in ("caption.segment.updated", "caption.word.styled", "timeline.clip.moved"):
            bus.publish(topic, None)
        assert seen == ["caption.segment.updated", "caption.word.styled"]
        bus.shutdown()

    def test_outbox_only_records_without_invoking_handlers(self) -> None:
        bus = EventBus(autostart=False)
        calls: list[int] = []
        bus.subscribe("t", lambda e: calls.append(1), mode=DeliveryMode.OUTBOX_ONLY)
        bus.publish("t", None)
        assert calls == []
        assert bus.last_seq == 1
        assert len(bus.history) == 1
        bus.shutdown()

    def test_wildcard_subscription_receives_everything(self) -> None:
        bus = EventBus(autostart=False)
        seen: list[str] = []
        bus.subscribe(None, lambda e: seen.append(e.topic), mode=DeliveryMode.SYNC)
        bus.publish("a", None)
        bus.publish("b", None)
        assert seen == ["a", "b"]
        bus.shutdown()

    def test_empty_topic_sequence_is_rejected(self) -> None:
        """An empty list is a mistake; None is the wildcard.  They must differ."""
        bus = EventBus(autostart=False)
        with pytest.raises(ValueError, match="empty topic sequence"):
            bus.subscribe([], lambda e: None)
        with pytest.raises(ValueError, match="empty topic sequence"):
            bus.subscribe((), lambda e: None)
        # An empty sequence *with* a predicate is legal: the predicate decides.
        subscription = bus.subscribe([], lambda e: None, predicate=lambda topic: topic == "wanted")
        seen: list[str] = []
        subscription.unsubscribe()
        bus.subscribe(
            None,
            lambda e: seen.append(e.topic),
            predicate=lambda t: t == "wanted",
            mode=DeliveryMode.SYNC,
        )
        bus.publish("wanted", None)
        bus.publish("other", None)
        assert seen == ["wanted"]
        bus.shutdown()


class TestHandlerIsolation:
    def test_a_raising_handler_does_not_stop_others(self) -> None:
        """Handler faults are isolated: the publisher never sees them."""
        bus = EventBus(autostart=False)
        seen: list[int] = []

        def faulty(_: EventEnvelope[Any]) -> None:
            raise RuntimeError("handler fault")

        bus.subscribe("t", faulty, mode=DeliveryMode.SYNC)
        bus.subscribe("t", lambda e: seen.append(e.payload.start), mode=DeliveryMode.SYNC)
        bus.publish("t", ClipMoved(clip_id="c", start=7))
        assert seen == [7]
        assert bus.stats().handler_errors == 1
        bus.shutdown()

    def test_error_counts_accumulate_per_registration(self) -> None:
        bus = EventBus(autostart=False)

        def faulty(_: EventEnvelope[Any]) -> None:
            raise ValueError("nope")

        subscription = bus.subscribe("t", faulty, mode=DeliveryMode.SYNC)
        for _ in range(3):
            bus.publish("t", None)
        assert subscription.error_count == 3
        assert subscription.call_count == 0
        bus.shutdown()

    def test_successful_calls_are_counted(self) -> None:
        bus = EventBus(autostart=False)
        subscription = bus.subscribe("t", lambda e: None, mode=DeliveryMode.SYNC)
        bus.publish("t", None)
        bus.publish("t", None)
        assert subscription.call_count == 2
        assert subscription.error_count == 0
        bus.shutdown()

    def test_error_hook_receives_context(self) -> None:
        bus = EventBus(autostart=False)
        captured: list[tuple[str, str]] = []
        bus.set_error_hook(
            lambda envelope, handler_name, exc: captured.append(
                (envelope.topic, type(exc).__name__)
            )
        )

        def faulty(_: EventEnvelope[Any]) -> None:
            raise KeyError("boom")

        bus.subscribe("t", faulty, mode=DeliveryMode.SYNC)
        bus.publish("t", None)
        assert captured == [("t", "KeyError")]
        bus.shutdown()

    def test_a_failing_error_hook_cannot_break_the_bus(self) -> None:
        bus = EventBus(autostart=False)

        def bad_hook(*_: Any) -> None:
            raise RuntimeError("hook fault")

        bus.set_error_hook(bad_hook)
        bus.subscribe("t", lambda e: (_ for _ in ()).throw(ValueError("x")), mode=DeliveryMode.SYNC)
        bus.publish("t", None)
        assert bus.stats().handler_errors == 1
        bus.shutdown()


class TestSubscriptionLifecycle:
    def test_unsubscribe_is_idempotent(self) -> None:
        bus = EventBus(autostart=False)
        seen: list[int] = []
        subscription = bus.subscribe("t", lambda e: seen.append(1), mode=DeliveryMode.SYNC)
        assert subscription.unsubscribe() is True
        assert subscription.unsubscribe() is False
        bus.publish("t", None)
        assert seen == []
        bus.shutdown()

    def test_context_manager_unsubscribes_on_exit(self) -> None:
        bus = EventBus(autostart=False)
        seen: list[int] = []
        with bus.subscribe("t", lambda e: seen.append(1), mode=DeliveryMode.SYNC):
            bus.publish("t", None)
        bus.publish("t", None)
        assert seen == [1]
        assert bus.stats().subscriptions == 0
        bus.shutdown()

    def test_unsubscribing_frees_the_topic_bucket(self) -> None:
        bus = EventBus(autostart=False)
        subscription = bus.subscribe("t", lambda e: None, mode=DeliveryMode.SYNC)
        subscription.unsubscribe()
        assert bus.stats().subscriptions == 0
        bus.publish("t", None)
        bus.shutdown()

    def test_clear_removes_everything(self) -> None:
        bus = EventBus(autostart=False)
        bus.subscribe("t", lambda e: None, mode=DeliveryMode.SYNC)
        bus.publish("t", None)
        bus.clear()
        assert bus.stats().subscriptions == 0
        assert bus.history == ()
        bus.shutdown()


class TestReplayAndResync:
    def test_replay_returns_only_newer_envelopes(self) -> None:
        bus = EventBus(history_size=32, autostart=False)
        envelopes = [bus.publish("t", ClipMoved(clip_id="c", start=i)) for i in range(5)]
        replayed = bus.replay_from(envelopes[1].seq)
        assert [item.seq for item in replayed] == [3, 4, 5]
        bus.shutdown()

    def test_history_is_bounded(self) -> None:
        bus = EventBus(history_size=16, autostart=False)
        for index in range(100):
            bus.publish("t", ClipMoved(clip_id="c", start=index))
        assert len(bus.history) == 16
        assert bus.oldest_seq == 85
        assert bus.last_seq == 100
        bus.shutdown()

    def test_history_size_has_a_floor(self) -> None:
        bus = EventBus(history_size=1, autostart=False)
        for _ in range(5):
            bus.publish("t", None)
        assert len(bus.history) >= 5
        bus.shutdown()

    def test_empty_history_reports_no_oldest(self) -> None:
        bus = EventBus(autostart=False)
        assert bus.oldest_seq is None
        assert bus.last_seq == 0
        assert bus.replay_from(0) == []
        bus.shutdown()


class TestWireSerialisation:
    def test_dataclass_payload_is_dumped_to_a_dict(self) -> None:
        bus = EventBus(autostart=False)
        envelope = bus.publish("timeline.clip.moved", ClipMoved(clip_id="c1", start=12))
        wire = envelope.to_wire()
        assert wire == {
            "topic": "timeline.clip.moved",
            "seq": envelope.seq,
            "ts": envelope.ts_ms,
            "payload": {"clip_id": "c1", "start": 12},
        }
        bus.shutdown()

    def test_a_pydantic_payload_from_an_outer_ring_is_still_serialised(self) -> None:
        """``to_wire`` duck-types ``model_dump`` instead of importing pydantic.

        L1 must stay free of pydantic (see :class:`EventPayload`), but L2+ payloads
        are allowed to use it, and the WebSocket bridge must serialise them in JSON
        mode exactly as before.
        """
        from pydantic import BaseModel, ConfigDict

        class RenderProgress(BaseModel):
            model_config = ConfigDict(frozen=True, extra="forbid")

            job_id: str
            percent: float

        bus = EventBus(autostart=False)
        envelope = bus.publish("render.progress", RenderProgress(job_id="j1", percent=42.5))
        assert envelope.to_wire()["payload"] == {"job_id": "j1", "percent": 42.5}
        bus.shutdown()

    def test_source_and_command_id_appear_only_when_set(self) -> None:
        bus = EventBus(autostart=False)
        plain = bus.publish("t", None).to_wire()
        assert "source" not in plain
        assert "command_id" not in plain
        tagged = bus.publish("t", None, source="svc", command_id="cmd-1").to_wire()
        assert tagged["source"] == "svc"
        assert tagged["command_id"] == "cmd-1"
        bus.shutdown()

    def test_dataclass_and_primitive_payloads(self) -> None:
        from dataclasses import dataclass

        @dataclass(frozen=True)
        class Point:
            x: int
            y: int

        bus = EventBus(autostart=False)
        assert bus.publish("t", Point(1, 2)).to_wire()["payload"] == {"x": 1, "y": 2}
        assert bus.publish("t", 42).to_wire()["payload"] == 42
        assert "payload" not in bus.publish("t", None).to_wire()
        bus.shutdown()

    def test_payload_is_immutable(self) -> None:
        """A handler must not be able to mutate an event it receives."""
        event = ClipMoved(clip_id="c", start=1)
        with pytest.raises(FrozenInstanceError):
            event.start = 5  # type: ignore[misc]

    def test_payload_rejects_undeclared_fields(self) -> None:
        """The property ``extra="forbid"`` used to provide, now from dataclasses.

        A typo in a payload field must fail at construction, loudly, rather than
        silently attaching a stray attribute that no subscriber will ever read.
        """
        with pytest.raises(TypeError):
            ClipMoved(clip_id="c", start=1, strt=2)  # type: ignore[call-arg]

    def test_payload_has_no_instance_dict(self) -> None:
        """Slotted on both levels: payloads are allocated per event, often per frame."""
        event = ClipMoved(clip_id="c", start=1)
        assert not hasattr(event, "__dict__")


class TestConcurrency:
    def test_publishing_from_many_threads_is_safe(self) -> None:
        bus = EventBus(history_size=4096)
        seen: list[int] = []
        lock = threading.Lock()

        def record(envelope: EventEnvelope[Any]) -> None:
            with lock:
                seen.append(envelope.payload.start)

        bus.subscribe("t", record, mode=DeliveryMode.SYNC)

        def worker(base: int) -> None:
            for index in range(200):
                bus.publish("t", ClipMoved(clip_id="c", start=base + index))

        threads = [threading.Thread(target=worker, args=(base * 1000,)) for base in range(8)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        assert bus.drain(timeout=5)
        assert len(seen) == 1_600
        assert len(set(seen)) == 1_600, "every event must be delivered exactly once"
        sequences = [item.seq for item in bus.history]
        assert sequences == sorted(sequences), "sequence numbers must stay monotonic"
        bus.shutdown()

    def test_a_handler_may_publish_without_deadlocking(self) -> None:
        bus = EventBus(autostart=False)
        seen: list[str] = []

        def relay(envelope: EventEnvelope[Any]) -> None:
            seen.append(envelope.topic)
            if envelope.topic == "first":
                bus.publish("second", None)

        bus.subscribe(None, relay, mode=DeliveryMode.SYNC)
        bus.publish("first", None)
        assert seen == ["first", "second"]
        bus.shutdown()

    def test_shutdown_drains_queued_events(self) -> None:
        bus = EventBus()
        seen: list[int] = []
        bus.subscribe("t", lambda e: seen.append(e.payload.start))
        for index in range(20):
            bus.publish("t", ClipMoved(clip_id="c", start=index))
        bus.shutdown(timeout=5, drain=True)
        assert seen == list(range(20))
        assert not bus.is_running

    def test_start_is_idempotent(self) -> None:
        bus = EventBus()
        bus.start()
        bus.start()
        assert bus.is_running
        bus.shutdown()


class TestAsyncStream:
    async def test_stream_receives_events_from_another_thread(self) -> None:
        bus = EventBus()
        received: list[int] = []
        async with bus.stream(["render.frame"], maxsize=8) as stream:

            def worker() -> None:
                for index in range(3):
                    bus.publish("render.frame", ClipMoved(clip_id="c", start=index))

            thread = threading.Thread(target=worker)
            thread.start()
            for _ in range(3):
                envelope = await stream.next(timeout=5.0)
                assert envelope is not None
                received.append(envelope.payload.start)
            thread.join()
        assert received == [0, 1, 2]
        bus.shutdown()

    async def test_stream_filters_by_topic(self) -> None:
        bus = EventBus()
        async with bus.stream(["wanted"]) as stream:
            bus.publish("wanted", None)
            bus.publish("other", None)
            envelope = await stream.next(timeout=2.0)
            assert envelope is not None
            assert envelope.topic == "wanted"
            assert stream.poll() is None
        bus.shutdown()

    async def test_stream_backpressure_keeps_the_newest(self) -> None:
        """A slow consumer must see current state, not stale state."""
        bus = EventBus(autostart=False)
        stream = bus.stream(["x"], maxsize=2)
        for index in range(6):
            bus.publish("x", ClipMoved(clip_id="c", start=index))
        first = stream.poll()
        second = stream.poll()
        assert first is not None and second is not None
        assert (first.payload.start, second.payload.start) == (4, 5)
        assert stream.dropped == 4
        stream.close()
        bus.shutdown()

    async def test_closed_stream_stops_iteration(self) -> None:
        bus = EventBus(autostart=False)
        stream = bus.stream(["x"])
        stream.close()
        bus.publish("x", None)
        assert await stream.next(timeout=0.1) is None
        stream.close()  # idempotent
        bus.shutdown()

    async def test_next_returns_none_on_timeout(self) -> None:
        bus = EventBus(autostart=False)
        async with bus.stream(["x"]) as stream:
            assert await stream.next(timeout=0.05) is None
        bus.shutdown()

    async def test_async_iteration_protocol(self) -> None:
        bus = EventBus()

        async def consumer() -> list[int]:
            collected: list[int] = []
            async with bus.stream(["x"], maxsize=8) as stream:
                while len(collected) < 3:
                    envelope = await asyncio.wait_for(stream.__anext__(), timeout=5)
                    collected.append(envelope.payload.start)
            return collected

        task = asyncio.create_task(consumer())
        await asyncio.sleep(0.05)
        for index in range(3):
            bus.publish("x", ClipMoved(clip_id="c", start=index))
        assert await task == [0, 1, 2]
        bus.shutdown()


class TestStatistics:
    def test_stats_reflect_activity(self) -> None:
        bus = EventBus(autostart=False)
        subscription = bus.subscribe("t", lambda e: None, mode=DeliveryMode.SYNC)
        for _ in range(3):
            bus.publish("t", None)
        stats = bus.stats()
        assert stats.published == 3
        assert stats.delivered == 3
        assert stats.subscriptions == 1
        assert stats.last_seq == 3
        assert stats.handler_errors == 0
        subscription.unsubscribe()
        bus.shutdown()

    def test_topic_count_reports_explicit_topics_only(self) -> None:
        bus = EventBus(autostart=False)
        explicit = bus.subscribe(["a", "b"], lambda e: None, mode=DeliveryMode.SYNC)
        wildcard = bus.subscribe_prefix("c.", lambda e: None, mode=DeliveryMode.SYNC)
        assert explicit.topic_count == 2
        assert wildcard.topic_count is None
        bus.shutdown()
