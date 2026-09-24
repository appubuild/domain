"""Typed in-process event bus (ARCHITECTURE.md §5.1).

Everything that reacts to a change in Nova Studio — cache invalidation, preview
re-render, autosave dirty-marking, WebSocket broadcast, telemetry — is a
*subscriber*, never a call site.  That is what makes the Open/Closed principle real
here: adding a reaction to an edit requires zero changes to editing code.

Guarantees
----------
* **Ordering** is preserved per bus, and globally by the monotonic ``seq`` carried
  on every envelope.
* **Delivery** is *sync* (inline, for handlers that must observe state before the
  publisher continues) or *queued* (handed to a single-consumer worker, for
  anything that might block).
* **Isolation**: a handler that raises is logged and counted; the publisher never
  sees the exception and other handlers still run.
* **Thread safety**: publish may be called from any thread or process-pool
  callback.  Handlers are invoked while no bus lock is held, so a handler may
  itself publish without deadlocking.
* **Replay**: the last ``history_size`` envelopes are retained so a client that
  detects a ``seq`` gap can resynchronise instead of reloading everything.

The bus is deliberately loop-agnostic: ASR, decode and export workers run in
threads and processes, so requiring a running ``asyncio`` loop would be a
liability.  An ``async`` view is provided on top via :meth:`EventBus.stream_async`.
"""

from __future__ import annotations

import contextlib
import itertools
import threading
import time
from collections import deque
from collections.abc import Callable, Sequence
from dataclasses import asdict, dataclass, is_dataclass
from enum import StrEnum
from queue import Empty, Queue
from typing import TYPE_CHECKING, Any, Generic, Protocol, TypeAlias, TypeVar

if TYPE_CHECKING:
    import asyncio
    from collections.abc import Iterable

__all__ = [
    "AsyncEventStream",
    "DeliveryMode",
    "EventBus",
    "EventEnvelope",
    "EventHandler",
    "EventPayload",
    "EventStatistics",
    "Subscription",
    "TopicLike",
]

T = TypeVar("T")


class SupportsStr(Protocol):
    """Structural type for anything that can be used as an event topic.

    In practice a topic is a :class:`~enum.StrEnum` member declared in
    ``nova_studio/domain/events.py``.  Accepting any object with a stable ``str``
    value keeps the L1 core free of L2 domain knowledge while still making typos
    impossible at the call site.
    """

    def __str__(self) -> str: ...


#: A topic: a plain string or anything with a stable string form.
TopicLike: TypeAlias = str | SupportsStr


class DeliveryMode(StrEnum):
    """How a handler is invoked."""

    #: Called inline on the publishing thread.  Must not block and must not
    #: publish heavy work; used when a subscriber has to observe or amend state
    #: before the publisher proceeds (e.g. cache invalidation before a save).
    SYNC = "sync"
    #: Handed to the bus worker thread in publication order.  May block briefly.
    QUEUED = "queued"
    #: Appended only to the replay history and the outbound bridge; no Python
    #: handler runs.  Used for events that exist purely to inform the frontend.
    OUTBOX_ONLY = "outbox_only"


@dataclass(frozen=True, slots=True)
class EventEnvelope(Generic[T]):
    """The unit of transport: a topic, a sequence number, a timestamp and a payload.

    Attributes:
        topic: Dot-namespaced topic string, e.g. ``timeline.clip.moved``.
        seq: Monotonically increasing per-bus sequence number.  Clients detect loss
            by watching for gaps and request a replay from the last seen value.
        ts_ms: Publication time in unix milliseconds, from the bus clock.
        payload: Immutable event data.
        source: Optional identifier of the publishing subsystem, for diagnostics.
        command_id: When the event was produced by a command, its id — this is how
            the frontend matches an authoritative event to its optimistic update.
    """

    topic: str
    seq: int
    ts_ms: int
    payload: T
    source: str | None = None
    command_id: str | None = None

    def to_wire(self) -> dict[str, Any]:
        """Serialise for the WebSocket bridge.

        Pydantic payloads are dumped in JSON mode; plain dataclasses and
        primitives pass through so the bridge stays cheap for high-frequency
        events such as transport position updates.

        The pydantic branch is duck-typed rather than an ``isinstance`` check so
        that L1 can serialise a pydantic payload defined in an outer ring without
        importing pydantic itself (see :class:`EventPayload`).
        """
        payload = self.payload
        model_dump = getattr(payload, "model_dump", None)
        if callable(model_dump):
            body: Any = model_dump(mode="json")
        elif isinstance(payload, StrEnum):
            body = str(payload)
        elif is_dataclass(payload) and not isinstance(payload, type):
            body = asdict(payload)
        elif hasattr(payload, "_asdict"):  # namedtuple
            body = dict(payload._asdict())
        else:
            body = payload
        wire: dict[str, Any] = {"topic": self.topic, "seq": self.seq, "ts": self.ts_ms}
        if body is not None:
            wire["payload"] = body
        if self.source is not None:
            wire["source"] = self.source
        if self.command_id is not None:
            wire["command_id"] = self.command_id
        return wire


@dataclass(frozen=True, slots=True)
class EventPayload:
    """Base class for event payloads.

    Frozen and slotted, so a handler cannot mutate an event it receives and a typo
    in a payload field is a ``TypeError`` at construction rather than a silent
    attribute assignment.  Subclasses must also declare ``slots=True``::

        @dataclass(frozen=True, slots=True)
        class ClipMoved(EventPayload):
            clip_id: str
            frame: int

    Why not a ``pydantic.BaseModel``?  Because this is L1.  A pydantic import here
    would pull roughly 150 modules — and with them ``socket``, ``ssl``, ``subprocess``
    and ``urllib`` — into *every* process that touches the kernel: each render
    worker, each plugin host, each CLI invocation.  The wire boundary is L4, and
    that is where pydantic models belong (ADR-0002).  :meth:`EventEnvelope.to_wire`
    still serialises pydantic payloads for higher layers that choose to define them.
    """


#: A handler receives the envelope so it can inspect seq/topic/command_id.
EventHandler: TypeAlias = Callable[[EventEnvelope[Any]], None]
#: A predicate deciding whether a subscription cares about a given topic.
TopicFilter: TypeAlias = Callable[[str], bool]


@dataclass(slots=True)
class _Registration:
    """Internal bookkeeping for one subscription."""

    key: int
    handler: EventHandler
    mode: DeliveryMode
    topics: frozenset[str] | None
    predicate: TopicFilter | None
    priority: int
    errors: int = 0
    calls: int = 0
    cancelled: bool = False


class Subscription:
    """Handle returned by :meth:`EventBus.subscribe`.

    Usable as a context manager so that short-lived subscribers cannot leak::

        with bus.subscribe(Topic.PROJECT_SAVED, on_saved):
            ...
    """

    __slots__ = ("_bus", "_registration")

    def __init__(self, bus: EventBus, registration: _Registration) -> None:
        self._bus = bus
        self._registration = registration

    @property
    def topic_count(self) -> int | None:
        """Number of explicit topics, or ``None`` when a predicate is used."""
        topics = self._registration.topics
        return None if topics is None else len(topics)

    @property
    def call_count(self) -> int:
        """How many times the handler has been invoked."""
        return self._registration.calls

    @property
    def error_count(self) -> int:
        """How many times the handler raised."""
        return self._registration.errors

    def unsubscribe(self) -> bool:
        """Cancel the subscription.  Idempotent; returns whether it was active."""
        if self._registration.cancelled:
            return False
        self._registration.cancelled = True
        return self._bus._remove(self._registration.key)

    def __enter__(self) -> Subscription:
        return self

    def __exit__(self, *_exc: object) -> None:
        self.unsubscribe()


@dataclass(frozen=True, slots=True)
class EventStatistics:
    """Snapshot of bus health, exposed on ``/api/v1/system/events/stats``."""

    published: int
    delivered: int
    handler_errors: int
    dropped: int
    queue_depth: int
    subscriptions: int
    history_size: int
    last_seq: int


class EventBus:
    """The process-wide event bus.

    Args:
        history_size: Number of envelopes retained for replay/resync.
        queue_size: Bound on the queued-handler backlog.  When full, the bus
            drops the *oldest* queued item and counts it, because an unbounded
            queue would convert a slow handler into an out-of-memory crash.
        clock: Injectable millisecond clock for deterministic tests.
        worker_name: Thread name for the queued-handler worker.
        autostart: Whether to start the worker thread immediately.  Tests that
            only use sync handlers pass ``False`` to avoid spawning threads.
    """

    def __init__(
        self,
        *,
        history_size: int = 2_048,
        queue_size: int = 8_192,
        clock: Callable[[], int] | None = None,
        worker_name: str = "nova-event-bus",
        autostart: bool = True,
    ) -> None:
        self._history_size = max(16, history_size)
        self._clock = clock or (lambda: int(time.time() * 1000))
        self._seq = itertools.count(1)
        self._subscription_keys = itertools.count(1)
        self._lock = threading.RLock()
        self._registry: dict[int, _Registration] = {}
        self._by_topic: dict[str, list[int]] = {}
        self._wildcards: list[int] = []
        self._history: deque[EventEnvelope[Any]] = deque(maxlen=self._history_size)
        self._queue: Queue[_QueueItem] = Queue(maxsize=queue_size)
        self._streams: list[AsyncEventStream[Any]] = []
        self._published = 0
        self._delivered = 0
        self._handler_errors = 0
        self._dropped = 0
        self._worker: threading.Thread | None = None
        self._stopping = threading.Event()
        self._worker_name = worker_name
        self._error_hook: Callable[[EventEnvelope[Any], str, BaseException], None] | None = None
        if autostart:
            self.start()

    # -- lifecycle ---------------------------------------------------------

    def start(self) -> None:
        """Start the queued-handler worker thread.  Idempotent."""
        with self._lock:
            if self._worker is not None and self._worker.is_alive():
                return
            self._stopping.clear()
            worker = threading.Thread(
                target=self._drain_loop,
                name=self._worker_name,
                daemon=True,
            )
            self._worker = worker
            worker.start()

    def shutdown(self, *, timeout: float = 2.0, drain: bool = True) -> None:
        """Stop the worker, optionally draining pending events first.

        Called during application shutdown so that queued handlers (notably the
        final autosave flush) get a chance to run before the process exits.
        """
        with self._lock:
            worker = self._worker
            self._worker = None
        if worker is None:
            return
        if drain:
            # Sentinel wakes the worker; it keeps draining until the queue is empty.
            self._stopping.set()
            self._queue.put_nowait(_SHUTDOWN_ITEM)
        else:
            self._stopping.set()
        worker.join(timeout=timeout)
        for stream in list(self._streams):
            stream.close()

    @property
    def is_running(self) -> bool:
        """Whether the queued-handler worker is alive."""
        worker = self._worker
        return worker is not None and worker.is_alive()

    # -- subscription ------------------------------------------------------

    def subscribe(
        self,
        topics: TopicLike | Sequence[TopicLike] | None,
        handler: EventHandler,
        *,
        mode: DeliveryMode = DeliveryMode.QUEUED,
        priority: int = 0,
        predicate: TopicFilter | None = None,
    ) -> Subscription:
        """Register a handler.

        Args:
            topics: One topic, a sequence of topics, or ``None`` to receive every
                topic (subject to ``predicate``).
            handler: Callable receiving the :class:`EventEnvelope`.
            mode: Delivery mode; see :class:`DeliveryMode`.
            priority: Higher runs first within the same topic.  Ties break by
                subscription order, so behaviour is deterministic.
            predicate: Optional extra filter on the topic string, useful for
                prefix matching (``topic.startswith("caption.")``).

        Returns:
            A :class:`Subscription` handle for later cancellation.
        """
        # ``topics=None`` is the wildcard: subscribe to every topic.  An empty
        # sequence is a mistake and is rejected, because silently subscribing to
        # nothing would produce a handler that never fires.
        topic_set: frozenset[str] | None
        if topics is None:
            topic_set = None
        elif isinstance(topics, str) or not isinstance(topics, Sequence):
            topic_set = frozenset({str(topics)})
        else:
            topic_set = frozenset(str(topic) for topic in topics)
            if not topic_set and predicate is None:
                raise ValueError(
                    "subscribe() was given an empty topic sequence; pass None to "
                    "subscribe to every topic, or supply a predicate"
                )

        with self._lock:
            key = next(self._subscription_keys)
            registration = _Registration(
                key=key,
                handler=handler,
                mode=mode,
                topics=topic_set,
                predicate=predicate,
                priority=priority,
            )
            self._registry[key] = registration
            if topic_set is None:
                self._wildcards.append(key)
                self._wildcards.sort(key=lambda k: -self._registry[k].priority)
            else:
                for topic in topic_set:
                    bucket = self._by_topic.setdefault(topic, [])
                    bucket.append(key)
                    bucket.sort(key=lambda k: -self._registry[k].priority)
        return Subscription(self, registration)

    def subscribe_prefix(
        self,
        prefix: str,
        handler: EventHandler,
        *,
        mode: DeliveryMode = DeliveryMode.QUEUED,
        priority: int = 0,
    ) -> Subscription:
        """Subscribe to every topic starting with ``prefix``."""
        return self.subscribe(
            None,
            handler,
            mode=mode,
            priority=priority,
            predicate=lambda topic: topic.startswith(prefix),
        )

    def _remove(self, key: int) -> bool:
        with self._lock:
            registration = self._registry.pop(key, None)
            if registration is None:
                return False
            if registration.topics is None:
                if key in self._wildcards:
                    self._wildcards.remove(key)
            else:
                for topic in registration.topics:
                    bucket = self._by_topic.get(topic)
                    if bucket and key in bucket:
                        bucket.remove(key)
                    if bucket is not None and not bucket:
                        self._by_topic.pop(topic, None)
            return True

    def set_error_hook(
        self,
        hook: Callable[[EventEnvelope[Any], str, BaseException], None] | None,
    ) -> None:
        """Install a callback invoked when a handler raises.

        The logging adapter installs this so handler faults reach the structured
        log with full context; the bus itself has no logging dependency (L1).
        """
        self._error_hook = hook

    # -- publication -------------------------------------------------------

    def publish(
        self,
        topic: TopicLike,
        payload: Any = None,
        *,
        source: str | None = None,
        command_id: str | None = None,
    ) -> EventEnvelope[Any]:
        """Publish an event and return its envelope.

        Sync handlers run before this method returns; queued handlers are
        scheduled.  The envelope's ``seq`` lets a caller correlate a later
        authoritative event with an optimistic UI update.
        """
        topic_text = str(topic)
        envelope: EventEnvelope[Any] = EventEnvelope(
            topic=topic_text,
            seq=next(self._seq),
            ts_ms=self._clock(),
            payload=payload,
            source=source,
            command_id=command_id,
        )

        with self._lock:
            self._published += 1
            self._history.append(envelope)
            registrations = self._resolve(topic_text)
            streams = list(self._streams)

        for stream in streams:
            stream._offer(envelope)

        for registration in registrations:
            if registration.cancelled:
                continue
            if registration.mode is DeliveryMode.SYNC:
                self._invoke(registration, envelope)
            elif registration.mode is DeliveryMode.QUEUED:
                self._enqueue(registration, envelope)
            # OUTBOX_ONLY: recorded in history + streams, no handler call.
        return envelope

    def publish_many(
        self,
        events: Iterable[tuple[TopicLike, Any]],
        *,
        source: str | None = None,
    ) -> list[EventEnvelope[Any]]:
        """Publish a batch, preserving order.  Returns the envelopes."""
        return [self.publish(topic, payload, source=source) for topic, payload in events]

    def _resolve(self, topic: str) -> list[_Registration]:
        """Collect matching registrations ordered by descending priority.

        Called with ``self._lock`` held; returns registration objects so the lock
        can be released before handlers run.
        """
        found: list[_Registration] = []
        for key in self._by_topic.get(topic, ()):
            registration = self._registry.get(key)
            if registration is not None and not registration.cancelled:
                found.append(registration)
        for key in self._wildcards:
            registration = self._registry.get(key)
            if registration is None or registration.cancelled:
                continue
            predicate = registration.predicate
            if (predicate is None or predicate(topic)) and registration not in found:
                found.append(registration)
        found.sort(key=lambda item: -item.priority)
        return found

    def _invoke(self, registration: _Registration, envelope: EventEnvelope[Any]) -> None:
        try:
            registration.handler(envelope)
        except Exception as exc:
            registration.errors += 1
            with self._lock:
                self._handler_errors += 1
            hook = self._error_hook
            if hook is not None:
                # A diagnostic hook must never be able to break the bus.
                with contextlib.suppress(Exception):  # pragma: no cover
                    hook(envelope, registration.handler.__qualname__, exc)
        else:
            registration.calls += 1
            with self._lock:
                self._delivered += 1

    def _enqueue(self, registration: _Registration, envelope: EventEnvelope[Any]) -> None:
        """Queue an event for the worker thread.

        Back-pressure policy: a full queue sheds its *oldest* item rather than
        blocking the publisher or growing without bound.  An unbounded queue would
        convert one slow handler into an out-of-memory crash, and blocking would
        let a slow subscriber stall the command that published the event.
        """
        item = _QueueItem(registration, envelope)
        try:
            self._queue.put_nowait(item)
        except Exception:  # Full is the expected case here; see the docstring above
            try:
                self._queue.get_nowait()
                with self._lock:
                    self._dropped += 1
            except Empty:  # pragma: no cover - raced with the worker
                pass
            try:
                self._queue.put_nowait(item)
            except Exception:  # pragma: no cover - genuinely wedged
                with self._lock:
                    self._dropped += 1

    def _drain_loop(self) -> None:
        """Worker loop: deliver queued events in order until shutdown."""
        while True:
            try:
                item = self._queue.get(timeout=0.25)
            except Empty:
                if self._stopping.is_set() and self._queue.empty():
                    return
                continue
            if item.registration is None:
                # Shutdown sentinel: deliver whatever is already queued, then stop.
                self._drain_remaining()
                return
            self._invoke(item.registration, item.envelope)

    def _drain_remaining(self) -> None:
        """Deliver every queued item left at shutdown, in order."""
        while True:
            try:
                item = self._queue.get_nowait()
            except Empty:
                return
            if item.registration is not None:
                self._invoke(item.registration, item.envelope)

    def drain(self, timeout: float = 5.0) -> bool:
        """Block until the queued backlog is empty or ``timeout`` elapses.

        Used by tests and by the shutdown sequence so that queued side effects
        (autosave, telemetry flush) complete deterministically.
        """
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self._queue.empty():
                # Give the worker a moment to finish the in-flight item.
                time.sleep(0.005)
                if self._queue.empty():
                    return True
            time.sleep(0.005)
        return self._queue.empty()

    # -- replay / resync ---------------------------------------------------

    def replay_from(self, seq: int) -> list[EventEnvelope[Any]]:
        """Return retained envelopes with ``envelope.seq > seq``.

        A WebSocket client that detects a gap calls this to resynchronise.  If the
        requested sequence has already been evicted from history the caller must
        perform a full slice resync instead — detected by comparing the oldest
        retained sequence (:attr:`oldest_seq`).
        """
        with self._lock:
            return [item for item in self._history if item.seq > seq]

    @property
    def oldest_seq(self) -> int | None:
        """Sequence number of the oldest retained envelope, if any."""
        with self._lock:
            return self._history[0].seq if self._history else None

    @property
    def last_seq(self) -> int:
        """Sequence number of the most recently published envelope."""
        with self._lock:
            return self._history[-1].seq if self._history else 0

    @property
    def history(self) -> tuple[EventEnvelope[Any], ...]:
        """A snapshot of the retained envelopes, oldest first."""
        with self._lock:
            return tuple(self._history)

    # -- async view --------------------------------------------------------

    def stream(
        self,
        topics: Sequence[TopicLike] | None = None,
        *,
        maxsize: int = 512,
        predicate: TopicFilter | None = None,
    ) -> AsyncEventStream[Any]:
        """Open an async iterator over matching events.

        Intended for the WebSocket bridge and for services that await progress
        events.  The stream must be closed (or used as an async context manager)
        so the bus does not retain a reference.
        """
        topic_set = None if topics is None else frozenset(str(topic) for topic in topics)
        stream: AsyncEventStream[Any] = AsyncEventStream(
            bus=self, topics=topic_set, predicate=predicate, maxsize=maxsize
        )
        with self._lock:
            self._streams.append(stream)
        return stream

    def _detach(self, stream: AsyncEventStream[Any]) -> None:
        with self._lock:
            if stream in self._streams:
                self._streams.remove(stream)

    # -- diagnostics -------------------------------------------------------

    def stats(self) -> EventStatistics:
        """Return a health snapshot for the status bar and diagnostics endpoint."""
        with self._lock:
            return EventStatistics(
                published=self._published,
                delivered=self._delivered,
                handler_errors=self._handler_errors,
                dropped=self._dropped,
                queue_depth=self._queue.qsize(),
                subscriptions=len(self._registry),
                history_size=len(self._history),
                last_seq=self.last_seq,
            )

    def clear(self) -> None:
        """Remove every subscription and clear history.  Test support only."""
        with self._lock:
            self._registry.clear()
            self._by_topic.clear()
            self._wildcards.clear()
            self._history.clear()
            self._published = 0
            self._delivered = 0
            self._handler_errors = 0
            self._dropped = 0
        for stream in list(self._streams):
            stream.close()


class AsyncEventStream(Generic[T]):
    """Async iterator over a filtered slice of the bus.

    Backpressure policy: when the internal buffer is full the *oldest* event is
    discarded and ``dropped`` increments.  For a UI progress stream this is the
    right trade — showing the newest position matters more than showing every
    intermediate one.
    """

    __slots__ = (
        "_bus",
        "_closed",
        "_dropped",
        "_loop",
        "_predicate",
        "_queue",
        "_topics",
        "_wakeup",
    )

    def __init__(
        self,
        *,
        bus: EventBus,
        topics: frozenset[str] | None,
        predicate: TopicFilter | None,
        maxsize: int,
    ) -> None:
        self._bus = bus
        self._topics = topics
        self._predicate = predicate
        self._queue: deque[EventEnvelope[Any]] = deque(maxlen=max(1, maxsize))
        self._loop: asyncio.AbstractEventLoop | None = None
        self._closed = False
        self._dropped = 0
        self._wakeup: asyncio.Event | None = None

    @property
    def dropped(self) -> int:
        """How many events were discarded due to a full buffer."""
        return self._dropped

    @property
    def pending(self) -> int:
        """How many events are buffered and not yet consumed."""
        return len(self._queue)

    def _offer(self, envelope: EventEnvelope[Any]) -> None:
        """Called by the bus on publish.  Must be cheap and must not block."""
        if self._closed:
            return
        if self._topics is not None and envelope.topic not in self._topics:
            return
        predicate = self._predicate
        if predicate is not None and not predicate(envelope.topic):
            return
        if len(self._queue) == self._queue.maxlen:
            self._dropped += 1
        self._queue.append(envelope)
        wakeup = self._wakeup
        loop = self._loop
        if wakeup is not None and loop is not None:
            # The loop may already be closed during shutdown; a lost wakeup is
            # harmless because the consumer is going away too.
            with contextlib.suppress(RuntimeError):  # pragma: no cover
                loop.call_soon_threadsafe(wakeup.set)

    async def __aiter__(self) -> Any:
        return self

    async def __anext__(self) -> EventEnvelope[Any]:
        if self._loop is None:
            # Imported here, not at module scope: a synchronous process — a render
            # worker, a CLI command — must not pay for the event loop, and must not
            # drag in socket/ssl just to publish events.
            import asyncio

            self._loop = asyncio.get_running_loop()
            self._wakeup = asyncio.Event()
        while True:
            if self._queue:
                return self._queue.popleft()
            if self._closed:
                raise StopAsyncIteration
            assert self._wakeup is not None
            self._wakeup.clear()
            if self._queue:  # re-check: an event may have arrived meanwhile
                continue
            await self._wakeup.wait()

    async def next(self, timeout: float | None = None) -> EventEnvelope[Any] | None:
        """Await the next event, or ``None`` on timeout / close."""
        try:
            if timeout is None:
                return await self.__anext__()
            import asyncio

            return await asyncio.wait_for(self.__anext__(), timeout)
        except TimeoutError:
            return None
        except StopAsyncIteration:
            return None

    def poll(self) -> EventEnvelope[Any] | None:
        """Non-blocking fetch of the next buffered event."""
        return self._queue.popleft() if self._queue else None

    def close(self) -> None:
        """Detach from the bus and stop iteration.  Idempotent."""
        if self._closed:
            return
        self._closed = True
        self._bus._detach(self)
        wakeup, loop = self._wakeup, self._loop
        if wakeup is not None and loop is not None:
            with contextlib.suppress(RuntimeError):  # pragma: no cover
                loop.call_soon_threadsafe(wakeup.set)

    async def __aenter__(self) -> AsyncEventStream[T]:
        return self

    async def __aexit__(self, *_exc: object) -> None:
        self.close()


@dataclass(frozen=True, slots=True)
class _QueueItem:
    """One queued delivery.

    ``registration`` is ``None`` for the shutdown sentinel, which lets the worker
    distinguish "stop" from "deliver" by type narrowing rather than by an identity
    comparison against a foreign object.
    """

    registration: _Registration | None
    envelope: EventEnvelope[Any]


_SHUTDOWN_ITEM: _QueueItem = _QueueItem(
    None, EventEnvelope(topic="nova.bus.shutdown", seq=0, ts_ms=0, payload=None)
)
