"""Shared pytest fixtures for the Nova Studio test suite.

Fixtures here provide the *fakes* that make L1–L3 testable without any native
dependency (ADR-0016): a deterministic clock, an in-memory event bus with no worker
thread, a bare DI container, and a command context wired to them.

Nothing in this file touches the filesystem outside pytest's ``tmp_path`` or
requires PyAV, OpenCV or model weights.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

import pytest

from nova_studio.core.commands import CommandContext, CommandHistory, CommandRegistry
from nova_studio.core.di import Lifetime, ServiceContainer
from nova_studio.core.events import DeliveryMode, EventBus, EventEnvelope

if TYPE_CHECKING:
    from collections.abc import Callable

pytest_plugins: tuple[str, ...] = ()


class FakeClock:
    """Deterministic clock driving both wall-ms and monotonic-seconds reads.

    Tests advance time explicitly, which makes coalescing windows, autosave
    intervals and throttling behaviour reproducible instead of timing-dependent.
    """

    __slots__ = ("_monotonic", "_wall_ms")

    def __init__(self, *, wall_ms: int = 1_700_000_000_000) -> None:
        self._wall_ms = wall_ms
        self._monotonic = 0.0

    def now_ms(self) -> int:
        """Wall clock in unix milliseconds."""
        return self._wall_ms

    def monotonic(self) -> float:
        """Monotonic seconds, starting at zero."""
        return self._monotonic

    def advance(self, seconds: float) -> None:
        """Advance both clocks by ``seconds``."""
        if seconds < 0:
            raise ValueError("FakeClock cannot move backwards")
        self._monotonic += seconds
        self._wall_ms += int(seconds * 1000)

    def __call__(self) -> float:
        """Callable form for APIs expecting ``Clock`` (monotonic seconds)."""
        return self._monotonic


@pytest.fixture
def fake_clock() -> FakeClock:
    """A deterministic clock starting at unix-ms 1 700 000 000 000."""
    return FakeClock()


@dataclass
class CapturedEvents:
    """Recorder attached to an :class:`EventBus` for assertions."""

    envelopes: list[EventEnvelope[Any]] = field(default_factory=list)

    def topics(self) -> list[str]:
        """All captured topics in order."""
        return [envelope.topic for envelope in self.envelopes]

    def of(self, topic: str) -> list[EventEnvelope[Any]]:
        """Envelopes for one topic, in order."""
        return [item for item in self.envelopes if item.topic == topic]

    def payloads(self, topic: str) -> list[Any]:
        """Payloads for one topic, in order."""
        return [item.payload for item in self.of(topic)]

    def clear(self) -> None:
        """Forget everything captured so far."""
        self.envelopes.clear()


@pytest.fixture
def captured_events() -> CapturedEvents:
    """An empty event recorder."""
    return CapturedEvents()


@pytest.fixture
def event_bus(captured_events: CapturedEvents) -> EventBus:
    """An event bus with no worker thread, capturing every event synchronously.

    ``autostart=False`` keeps unit tests free of background threads; a wildcard
    sync subscription records everything so assertions are order-exact.
    """
    bus = EventBus(history_size=256, autostart=False)

    def record(envelope: EventEnvelope[Any]) -> None:
        captured_events.envelopes.append(envelope)

    bus.subscribe(None, record, mode=DeliveryMode.SYNC)
    return bus


@pytest.fixture
def container(event_bus: EventBus, fake_clock: FakeClock) -> ServiceContainer:
    """A DI container pre-seeded with the clock and the bus."""
    service_container = ServiceContainer(event_bus=event_bus, name="test", clock=fake_clock.now_ms)
    service_container.register_instance(EventBus, event_bus)
    service_container.register_instance(FakeClock, fake_clock)
    service_container.register(
        CommandRegistry, lambda _resolver: CommandRegistry(), lifetime=Lifetime.SINGLETON
    )
    return service_container


@pytest.fixture
def command_registry() -> CommandRegistry:
    """A standalone command registry."""
    return CommandRegistry()


@pytest.fixture
def command_history(event_bus: EventBus, fake_clock: FakeClock) -> CommandHistory:
    """A command history driven by the deterministic clock."""
    return CommandHistory(bus=event_bus, clock=fake_clock.monotonic)


@pytest.fixture
def command_context(fake_clock: FakeClock) -> CommandContext:
    """A command context with no services; commands under test inject their own."""
    return CommandContext(services=None, project_id="project-test", clock=fake_clock.monotonic)


@pytest.fixture
def any_factory() -> Callable[[type], Any]:
    """Return a helper that builds a trivial subclass, for DI graph tests."""

    def build(name: str) -> Any:
        return type(name, (), {"__slots__": ()})

    return build
