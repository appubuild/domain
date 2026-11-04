"""L4 — the WebSocket bridge: one socket, authoritative state, recoverable loss.

Everything the UI shows that it did not ask for comes through here: a clip moved
by a background job, an export's progress, a transcription's partial hypothesis,
the transport position during playback. That makes this the most load-bearing
ninety lines in the API, and three decisions carry the weight.

**Sequence numbers, and a client that checks them.** Every envelope carries the
bus's monotonic `seq`. A client that sees `…41, 42, 47` knows it lost four
events, and knows *precisely* which four — so recovery is a request, not a
guess. Without the gap check the alternative is a UI that silently shows a
stale timeline and a user who cannot say what they saw.

**A gap is repaired from history, or not at all.** `resync` replays from the
bus's retained history when the gap is inside it, and says `complete: false`
when it is not — which is the truthful answer, and the signal for the client to
refetch the slice over REST. A bridge that "best-effort" replayed a partial
window would be handing the UI a state that looks consistent and is not.

**The socket is a notification channel, not a data pipe.** Payloads are small;
anything large (a preview frame, a waveform) goes over a binary channel or a
REST response. A socket that carried frame buffers would need congestion
control, and would eventually get it wrong during a scrub.

Back-pressure is the bus's, not ours: `AsyncEventStream` drops its *oldest*
buffered event when a slow client falls behind and counts it, because for a
progress stream the newest position is the one that matters. The count is
forwarded to the client on every heartbeat, so "the UI is behind" is a number
somebody can see rather than a mystery.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import time
from typing import TYPE_CHECKING, Any, Final

# Runtime imports: `WebSocket` because this module is the only place the socket
# protocol lives and the type is what documents it; `WebSocketDisconnect` because
# `serve` catches it.
from starlette.websockets import WebSocket, WebSocketDisconnect

if TYPE_CHECKING:
    from collections.abc import Callable, Sequence

    from nova_studio.core.events import AsyncEventStream, EventBus

__all__ = [
    "DEFAULT_HEARTBEAT_SECONDS",
    "DEFAULT_MAX_BUFFERED",
    "EventBridge",
]

#: How long the pump waits for an event before it sends a heartbeat. Long enough
#: that an idle editor is silent, short enough that a NAT or a laptop sleep does
#: not silently kill the socket.
DEFAULT_HEARTBEAT_SECONDS: Final[float] = 15.0

#: Events buffered per client before the oldest are dropped. Sized for a burst —
#: a render starting, a transcription catching up — not for a backlog.
DEFAULT_MAX_BUFFERED: Final[int] = 512

#: What the server sends, as a closed set the client can switch on.
HELLO: Final[str] = "hello"
EVENT: Final[str] = "event"
HEARTBEAT: Final[str] = "heartbeat"
RESYNC: Final[str] = "resync"
PONG: Final[str] = "pong"
GOODBYE: Final[str] = "goodbye"

#: What the client may send.
_PING: Final[str] = "ping"
_RESYNC: Final[str] = "resync"
_UNSUBSCRIBE: Final[str] = "unsubscribe"


class EventBridge:
    """One bus, many sockets: forward envelopes as JSON, and repair what is lost.

    Args:
        bus: The process event bus to forward from.
        topics: Topics this bridge carries, or ``None`` for every topic.
        max_buffered: Events buffered per client before the oldest are dropped.
        heartbeat_seconds: Idle interval between heartbeats.
        wall_clock: Unix-time source for heartbeat stamps, injected so a test can
            read a stamp it chose rather than one the real clock happened to give.
    """

    def __init__(
        self,
        bus: EventBus,
        *,
        topics: Sequence[str] | None = None,
        max_buffered: int = DEFAULT_MAX_BUFFERED,
        heartbeat_seconds: float = DEFAULT_HEARTBEAT_SECONDS,
        wall_clock: Callable[[], float] = time.time,
    ) -> None:
        self._bus = bus
        self._topics = None if topics is None else frozenset(topics)
        self._max_buffered = max(1, max_buffered)
        self._heartbeat = max(0.5, heartbeat_seconds)
        self._wall_clock = wall_clock

    # -- serving one socket ------------------------------------------------

    async def serve(self, websocket: WebSocket) -> None:
        """Run one client's socket until either side closes it.

        Two pumps run at once — events going out, client messages coming in —
        because a socket that only ever writes cannot answer a `ping`, and one
        that only ever reads cannot deliver an event. Whichever finishes first
        ends the other; a `WebSocketDisconnect` is a normal ending, not an error.
        """
        await websocket.accept()
        await self._send(
            websocket,
            {
                "type": HELLO,
                "seq": self._bus.last_seq,
                "topics": None if self._topics is None else sorted(self._topics),
                "heartbeat_seconds": self._heartbeat,
            },
        )
        with contextlib.suppress(WebSocketDisconnect):
            async with self._bus.stream(
                topics=None if self._topics is None else sorted(self._topics),
                maxsize=self._max_buffered,
            ) as stream:
                outgoing = asyncio.create_task(self._pump_events(websocket, stream))
                incoming = asyncio.create_task(self._pump_client(websocket))
                try:
                    await asyncio.wait({outgoing, incoming}, return_when=asyncio.FIRST_COMPLETED)
                finally:
                    for task in (outgoing, incoming):
                        task.cancel()
                    for task in (outgoing, incoming):
                        with contextlib.suppress(asyncio.CancelledError, Exception):
                            await task
        with contextlib.suppress(Exception):
            await self._send(websocket, {"type": GOODBYE, "seq": self._bus.last_seq})
        # Close our own side: nothing else will. A socket left open after the
        # goodbye is a connection the client holds open until *it* times out, which on
        # a desktop app that opens one per window is a leak the user pays for.
        with contextlib.suppress(Exception):
            await websocket.close()

    # -- the two directions ------------------------------------------------

    async def _pump_events(self, websocket: WebSocket, stream: AsyncEventStream[Any]) -> None:
        """Bus to client: events as they arrive, a heartbeat when they do not."""
        while True:
            envelope = await stream.next(timeout=self._heartbeat)
            if envelope is None:
                await self._send(
                    websocket,
                    {
                        "type": HEARTBEAT,
                        "seq": self._bus.last_seq,
                        "dropped": stream.dropped,
                        "at_ms": int(self._wall_clock() * 1000),
                    },
                )
                continue
            await self._send(websocket, {"type": EVENT, **envelope.to_wire()})

    async def _pump_client(self, websocket: WebSocket) -> None:
        """Client to server: `ping`, `resync`, `unsubscribe`."""
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                return
            text = message.get("text")
            if not text:
                continue
            try:
                request = json.loads(text)
            except json.JSONDecodeError:
                continue
            if not isinstance(request, dict):
                continue
            kind = request.get("type")
            if kind == _PING:
                await self._send(websocket, {"type": PONG, "seq": self._bus.last_seq})
            elif kind == _RESYNC:
                await self._send(websocket, self._resync_body(request.get("since")))
            elif kind == _UNSUBSCRIBE:
                return

    # -- resync ------------------------------------------------------------

    def _resync_body(self, since: object) -> dict[str, Any]:
        """Everything after ``since``, or an honest admission that it is gone.

        ``complete`` is the part that matters: when the requested sequence has
        already been evicted from the bus's history, the only correct answer is
        "I cannot replay that far", and the client must refetch the slice. A
        partial replay presented as complete is a UI showing a state that never
        existed.
        """
        requested = since if isinstance(since, int) and since >= 0 else 0
        oldest = self._bus.oldest_seq
        # ``requested + 1``: a client that has seen nothing asks for 0 and wants
        # everything, which is satisfiable exactly when history starts at the
        # beginning. Anything older than that has been evicted, and the honest
        # answer is "I cannot replay that far".
        complete = oldest is None or oldest <= requested + 1
        events = (
            [{"type": EVENT, **item.to_wire()} for item in self._bus.replay_from(requested)]
            if complete
            else []
        )
        return {
            "type": RESYNC,
            "since": requested,
            "events": events,
            "last_seq": self._bus.last_seq,
            "oldest_seq": oldest,
            "complete": complete,
        }

    # -- internals ---------------------------------------------------------

    async def _send(self, websocket: WebSocket, payload: dict[str, Any]) -> None:
        """Send one JSON frame, swallowing a socket that closed mid-write."""
        with contextlib.suppress(Exception):
            await websocket.send_text(json.dumps(payload, separators=(",", ":")))
