"""`api/ws.py` — one socket, authoritative state, recoverable loss.

Three promises are pinned here, and they are the three a socket can break in a
way the user notices:

1. **Every frame carries a sequence number**, so a client that sees a gap knows
   *which* events it lost rather than merely that it is behind.
2. **A gap is repaired from history, or admitted.** `resync` replays what is
   retained and says `complete: false` when it is not — never a partial window
   dressed up as the whole truth.
3. **Silence is not ambiguity.** A heartbeat on an idle socket proves the server
   is there, and carries the dropped count, so "the UI is behind" is a number
   somebody can read instead of a mystery.

The scripted doubles at the bottom exist because two of those promises are
about *time* and *loss*, and neither can be arranged through a real socket
without a sleep and a hope.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
from collections import deque
from typing import TYPE_CHECKING, Any

import pytest
from starlette.websockets import WebSocketDisconnect

from nova_studio.api.ws import EventBridge
from nova_studio.core.events import EventEnvelope
from tests.api.conftest import build_app, client_for, socket_for

if TYPE_CHECKING:
    from collections.abc import Iterator, Sequence

    from fastapi.testclient import TestClient

    from nova_studio.api.state import SessionState
    from nova_studio.core.events import EventBus

pytestmark = pytest.mark.unit


def envelope(topic: str, seq: int, payload: dict[str, Any] | None = None) -> EventEnvelope[Any]:
    """One event, as the bus would hand it to the bridge."""
    return EventEnvelope(topic=topic, seq=seq, ts_ms=1_700_000_000_000 + seq, payload=payload or {})


async def until(predicate: Any, *, timeout: float = 2.0) -> None:
    """Wait for `predicate()` to be true, or fail the test. Never sleep blindly."""
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while loop.time() < deadline:
        if predicate():
            return
        await asyncio.sleep(0)
    raise AssertionError("the condition never became true")


class TestTheHandshake:
    def test_the_first_frame_is_hello(self, client: TestClient, token: str) -> None:
        with socket_for(client, token) as socket:
            hello = socket.receive_json()
        assert hello["type"] == "hello"
        assert hello["heartbeat_seconds"] > 0
        assert isinstance(hello["seq"], int)

    def test_hello_names_the_topics_when_the_bridge_filters(
        self, bus: EventBus, session: SessionState, token: str
    ) -> None:
        app = build_app(bus, session, topics=("wanted",))
        with client_for(app) as client, socket_for(client, token) as socket:
            hello = socket.receive_json()
        assert hello["topics"] == ["wanted"]

    def test_hello_names_no_topics_when_everything_is_carried(
        self, client: TestClient, token: str
    ) -> None:
        with socket_for(client, token) as socket:
            assert socket.receive_json()["topics"] is None


class TestEvents:
    def test_an_event_is_forwarded_with_its_sequence(
        self, client: TestClient, token: str, bus: EventBus
    ) -> None:
        with socket_for(client, token) as socket:
            socket.receive_json()  # hello
            bus.publish("timeline.clip.moved", {"clip_id": "c1"}, source="test")
            event = socket.receive_json()
        assert event["type"] == "event"
        assert event["topic"] == "timeline.clip.moved"
        assert event["payload"] == {"clip_id": "c1"}
        assert event["source"] == "test"
        assert event["seq"] == bus.last_seq

    def test_sequences_arrive_in_order(self, client: TestClient, token: str, bus: EventBus) -> None:
        with socket_for(client, token) as socket:
            socket.receive_json()
            for index in range(5):
                bus.publish("test.tick", {"index": index})
            sequences = [socket.receive_json()["seq"] for _ in range(5)]
        assert sequences == sorted(sequences)
        assert len(set(sequences)) == 5

    def test_a_topic_filter_excludes_the_rest(
        self, bus: EventBus, session: SessionState, token: str
    ) -> None:
        app = build_app(bus, session, topics=("wanted",))
        with client_for(app) as client, socket_for(client, token) as socket:
            socket.receive_json()
            bus.publish("unwanted", {})
            bus.publish("wanted", {"n": 1})
            event = socket.receive_json()
        assert event["topic"] == "wanted"


class TestClientMessages:
    def test_a_ping_is_answered_with_the_current_sequence(
        self, client: TestClient, token: str, bus: EventBus
    ) -> None:
        with socket_for(client, token) as socket:
            socket.receive_json()
            socket.send_text(json.dumps({"type": "ping"}))
            pong = socket.receive_json()
        assert pong["type"] == "pong"
        assert pong["seq"] == bus.last_seq

    def test_a_frame_that_is_not_json_does_not_kill_the_socket(
        self, client: TestClient, token: str
    ) -> None:
        """A browser extension, a half-written client, a stray byte: all real."""
        with socket_for(client, token) as socket:
            socket.receive_json()
            socket.send_text("this is not json")
            socket.send_text(json.dumps({"type": "ping"}))
            assert socket.receive_json()["type"] == "pong"

    def test_a_frame_that_is_json_but_not_a_request_is_ignored(
        self, client: TestClient, token: str
    ) -> None:
        with socket_for(client, token) as socket:
            socket.receive_json()
            socket.send_text(json.dumps(["not", "a", "request"]))
            socket.send_text(json.dumps({"type": "ping"}))
            assert socket.receive_json()["type"] == "pong"

    def test_an_unknown_request_is_ignored_rather_than_refused(
        self, client: TestClient, token: str
    ) -> None:
        """A newer client sending a frame this build does not know should keep
        working, not be disconnected for being ahead of us."""
        with socket_for(client, token) as socket:
            socket.receive_json()
            socket.send_text(json.dumps({"type": "something.from.the.future"}))
            socket.send_text(json.dumps({"type": "ping"}))
            assert socket.receive_json()["type"] == "pong"

    def test_unsubscribe_ends_the_socket(self, client: TestClient, token: str) -> None:
        """Unsubscribing is a request, so it is answered before the socket goes."""
        with socket_for(client, token) as socket:
            socket.receive_json()
            socket.send_text(json.dumps({"type": "unsubscribe"}))
            assert socket.receive_json()["type"] == "goodbye"
            with pytest.raises(WebSocketDisconnect):
                socket.receive_json()


class TestResync:
    def test_it_replays_from_the_requested_sequence(
        self, client: TestClient, token: str, bus: EventBus
    ) -> None:
        with socket_for(client, token) as socket:
            socket.receive_json()
            bus.publish("test.one", {"n": 1})
            bus.publish("test.two", {"n": 2})
            socket.receive_json()
            socket.receive_json()
            socket.send_text(json.dumps({"type": "resync", "since": 0}))
            resync = socket.receive_json()
        assert resync["type"] == "resync"
        assert resync["complete"] is True
        assert [event["topic"] for event in resync["events"]] == [
            "api.started",
            "test.one",
            "test.two",
        ]

    def test_it_says_when_the_gap_predates_history(
        self, client: TestClient, token: str, bus: EventBus
    ) -> None:
        """A history of 32 cannot answer `since=0` after 40 events. The honest
        answer is "refetch", and a replay that pretended otherwise would hand the
        UI a state that never existed."""
        with socket_for(client, token) as socket:
            socket.receive_json()
            for index in range(40):
                bus.publish("test.tick", {"index": index})
            socket.send_text(json.dumps({"type": "resync", "since": 0}))
            # The events published above are still in flight, so the resync
            # answer arrives behind them.
            resync = socket.receive_json()
            while resync["type"] != "resync":
                resync = socket.receive_json()
        assert resync["complete"] is False
        assert resync["events"] == []
        assert resync["oldest_seq"] == bus.oldest_seq

    def test_it_reports_where_the_stream_is(
        self, client: TestClient, token: str, bus: EventBus
    ) -> None:
        with socket_for(client, token) as socket:
            socket.receive_json()
            socket.send_text(json.dumps({"type": "resync", "since": 0}))
            resync = socket.receive_json()
        assert resync["last_seq"] == bus.last_seq
        assert resync["since"] == 0


class TestTheHeartbeat:
    def test_an_idle_socket_is_not_silent(
        self, bus: EventBus, session: SessionState, token: str
    ) -> None:
        """A NAT, a laptop sleep and a proxy all kill a socket quietly; the
        heartbeat is what turns that into something the client can notice."""
        app = build_app(bus, session, heartbeat_seconds=0.5)
        with client_for(app) as client, socket_for(client, token) as socket:
            socket.receive_json()  # hello
            frame = socket.receive_json()
            while frame["type"] != "heartbeat":
                frame = socket.receive_json()
        assert frame["type"] == "heartbeat"
        assert frame["dropped"] >= 0

    async def test_it_carries_the_dropped_count_and_a_timestamp(self) -> None:
        """The count is the whole point: a slow client learns that it missed
        events, and roughly how many, rather than that something felt odd."""
        bus = FakeBus(last_seq=41, oldest_seq=40, dropped=7)
        socket = ScriptedSocket()
        bridge = EventBridge(bus, heartbeat_seconds=0.5, wall_clock=lambda: 1_700_000_000.0)
        task = asyncio.create_task(bridge.serve(socket))
        await until(lambda: bool(socket.of("heartbeat")))
        socket.release()
        await asyncio.wait_for(task, timeout=2.0)
        heartbeat = socket.of("heartbeat")[0]
        assert heartbeat["dropped"] == 7
        assert heartbeat["seq"] == 41
        assert heartbeat["at_ms"] == 1_700_000_000_000

    async def test_an_event_wakes_the_socket_before_the_heartbeat_does(self) -> None:
        bus = FakeBus(last_seq=4, oldest_seq=1, events=[envelope("test.wake", 4, {"n": 1})])
        socket = ScriptedSocket()
        bridge = EventBridge(bus, heartbeat_seconds=30.0)
        task = asyncio.create_task(bridge.serve(socket))
        await until(lambda: bool(socket.of("event")))
        socket.release()
        await asyncio.wait_for(task, timeout=2.0)
        assert socket.of("event")[0]["topic"] == "test.wake"
        assert socket.of("heartbeat") == []


class TestTheEnding:
    async def test_a_socket_that_leaves_is_told_goodbye(self) -> None:
        bus = FakeBus(last_seq=3, oldest_seq=1)
        socket = ScriptedSocket(hold_open=False)
        bridge = EventBridge(bus)
        await bridge.serve(socket)
        assert [frame["type"] for frame in socket.sent] == ["hello", "goodbye"]
        assert socket.sent[0]["topics"] is None

    async def test_a_disconnect_is_not_an_error(self) -> None:
        """A client closing its window is the common case, not a failure."""
        bus = FakeBus(last_seq=1, oldest_seq=1)
        socket = ScriptedSocket(hold_open=False)
        bridge = EventBridge(bus)
        await bridge.serve(socket)  # must not raise
        assert socket.sent[0]["type"] == "hello"

    async def test_the_bridge_closes_its_own_side(self) -> None:
        """Nothing else closes it: a socket left open after the goodbye is a
        connection the client keeps until its own timeout."""
        bus = FakeBus(last_seq=1, oldest_seq=1)
        socket = ScriptedSocket(hold_open=False)
        await EventBridge(bus).serve(socket)
        assert socket.closed_with == 1000

    async def test_the_bridge_passes_its_configuration_to_the_bus(self) -> None:
        bus = FakeBus(last_seq=1, oldest_seq=1)
        socket = ScriptedSocket(hold_open=False)
        bridge = EventBridge(bus, topics=("a", "b"), max_buffered=16)
        await bridge.serve(socket)
        assert bus.streamed_with == {"topics": ["a", "b"], "maxsize": 16}


# -- doubles -----------------------------------------------------------------
#
# `EventBridge` talks to a bus and a socket through five methods, so the two
# things a real socket cannot arrange on demand — silence, and loss — are
# arranged here instead.


class ScriptedStream:
    """Events the bridge will read; `None` means "the timeout elapsed"."""

    def __init__(self, events: Sequence[EventEnvelope[Any] | None], *, dropped: int = 0) -> None:
        self._events = deque(events)
        self.dropped = dropped

    async def next(self, timeout: float | None = None) -> EventEnvelope[Any] | None:
        if self._events:
            return self._events.popleft()
        # Nothing left to deliver: behave like an idle stream rather than
        # spinning the event loop at full speed.
        await asyncio.sleep(0.01)
        return None


class FakeBus:
    """The four things the bridge asks of a bus, with answers a test chooses."""

    def __init__(
        self,
        *,
        last_seq: int = 0,
        oldest_seq: int | None = None,
        events: Sequence[EventEnvelope[Any]] = (),
        dropped: int = 0,
    ) -> None:
        self._last_seq = last_seq
        self._oldest_seq = oldest_seq
        self._events = list(events)
        self._dropped = dropped
        self.streamed_with: dict[str, Any] = {}

    @property
    def last_seq(self) -> int:
        return self._last_seq

    @property
    def oldest_seq(self) -> int | None:
        return self._oldest_seq

    def replay_from(self, since: int) -> list[EventEnvelope[Any]]:
        if self._oldest_seq is not None and self._oldest_seq > since + 1:
            return []
        return [item for item in self._events if item.seq > since]

    @contextlib.asynccontextmanager
    async def stream(
        self, *, topics: Sequence[str] | None = None, maxsize: int = 0
    ) -> Iterator[ScriptedStream]:
        self.streamed_with = {"topics": topics, "maxsize": maxsize}
        yield ScriptedStream(self._events, dropped=self._dropped)


class ScriptedSocket:
    """A WebSocket that records what it is sent, and leaves when told to.

    Args:
        incoming: Frames the "client" sends, delivered in order.
        hold_open: When true (the default) the socket waits for :meth:`release`
            once those run out, so a test can watch heartbeats on an open
            socket. When false it disconnects as soon as they run out, which is
            what "the window was closed" looks like.
    """

    def __init__(self, incoming: Sequence[str] = (), *, hold_open: bool = True) -> None:
        self.sent: list[dict[str, Any]] = []
        self.closed_with: int | None = None
        self._incoming = deque(incoming)
        self._released = asyncio.Event()
        if not hold_open:
            self._released.set()

    async def accept(self) -> None:
        return None

    async def send_text(self, text: str) -> None:
        self.sent.append(json.loads(text))

    async def receive(self) -> dict[str, Any]:
        if self._incoming:
            return {"type": "websocket.receive", "text": self._incoming.popleft()}
        await self._released.wait()
        return {"type": "websocket.disconnect"}

    async def close(self, code: int = 1000, reason: str = "") -> None:
        self.closed_with = code

    def release(self) -> None:
        """Make the next `receive` a disconnect, ending the client pump."""
        self._released.set()

    def of(self, kind: str) -> list[dict[str, Any]]:
        """Everything sent of one frame type."""
        return [frame for frame in self.sent if frame["type"] == kind]
