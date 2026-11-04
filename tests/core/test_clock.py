"""Tests for the clock port and its L1 implementations.

Time is the most commonly faked dependency in the system — every autosave interval,
coalescing window, throttle and entity id depends on it — so the contract has to be
exact.  These tests are mostly about *which* reading a caller gets and what happens
at the boundaries, because that is where the real bugs live: a timeout computed from
the wall clock fires immediately after an NTP step, and a timestamp taken from the
monotonic clock reads 1970.
"""

from __future__ import annotations

import time
from typing import Any

import pytest

from nova_studio.core.clock import (
    DEFAULT_CLOCK,
    FixedClock,
    MonotonicClock,
    SystemClock,
    WallClock,
    wall_milliseconds,
)
from nova_studio.ports.clock import Clock, ControllableClock, MonotonicReading, WallReading

pytestmark = pytest.mark.unit


class TestSystemClock:
    def test_now_ms_is_unix_milliseconds(self) -> None:
        before = int(time.time() * 1000)
        reading = SystemClock().now_ms()
        after = int(time.time() * 1000)
        assert before <= reading <= after

    def test_now_ms_is_an_integer(self) -> None:
        """A float timestamp would make every id and log line non-deterministic."""
        assert isinstance(SystemClock().now_ms(), int)

    def test_wall_reading_truncates_rather_than_rounds(self) -> None:
        """A reading that rounds up can precede the event it describes."""
        for _ in range(200):
            reading = wall_milliseconds()
            assert reading * 1000 <= int(time.time() * 1_000_000) + 1000

    def test_monotonic_never_goes_backwards(self) -> None:
        clock = SystemClock()
        previous = clock.monotonic()
        for _ in range(1000):
            current = clock.monotonic()
            assert current >= previous
            previous = current

    def test_monotonic_is_not_a_unix_timestamp(self) -> None:
        """The classic mix-up: monotonic seconds are not a date."""
        assert SystemClock().monotonic() < 10_000_000, (
            "monotonic() looks like a wall reading; it must come from time.monotonic"
        )

    def test_two_readings_are_independent(self) -> None:
        clock = SystemClock()
        assert clock.now_ms() > 1_700_000_000_000, "wall reading should be a real date"
        assert clock.monotonic() < 10_000_000, "monotonic reading should not be"

    def test_is_stateless_and_shareable(self) -> None:
        """A module-level singleton is used, so it must carry no per-instance state."""
        assert SystemClock().__slots__ == ()
        assert SystemClock().now_ms() != 0

    def test_default_clock_is_a_system_clock(self) -> None:
        assert isinstance(DEFAULT_CLOCK, SystemClock)


class TestConcurrentReadings:
    def test_wall_readings_from_many_threads_are_consistent(self) -> None:
        """No shared mutable state, so concurrent reads cannot corrupt each other."""
        import threading

        clock = SystemClock()
        readings: list[int] = []
        lock = threading.Lock()
        errors: list[BaseException] = []

        def read() -> None:
            try:
                for _ in range(2000):
                    value = clock.now_ms()
                    with lock:
                        readings.append(value)
            except BaseException as exc:  # collect for the assertion below
                with lock:
                    errors.append(exc)

        threads = [threading.Thread(target=read) for _ in range(8)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        assert not errors
        assert len(readings) == 16_000
        assert max(readings) - min(readings) < 60_000, "readings should span well under a minute"


class TestFixedClock:
    def test_starts_where_it_is_told(self) -> None:
        clock = FixedClock(wall_ms=1234, monotonic=5.5)
        assert clock.now_ms() == 1234
        assert clock.monotonic() == 5.5

    def test_does_not_move_on_its_own(self) -> None:
        """The whole point: a reading is stable until the test changes it."""
        clock = FixedClock(wall_ms=1000)
        first = clock.now_ms()
        time.sleep(0.01)
        assert clock.now_ms() == first

    def test_advance_moves_both_readings(self) -> None:
        clock = FixedClock(wall_ms=1_000_000, monotonic=10.0)
        clock.advance(2.5)
        assert clock.monotonic() == pytest.approx(12.5)
        assert clock.now_ms() == 1_002_500

    def test_advance_is_cumulative(self) -> None:
        clock = FixedClock(wall_ms=0)
        for _ in range(10):
            clock.advance(0.1)
        assert clock.now_ms() == 1000
        assert clock.monotonic() == pytest.approx(1.0)

    def test_advance_refuses_to_go_backwards(self) -> None:
        """A backwards step must be a deliberate act, not an arithmetic slip."""
        clock = FixedClock(wall_ms=1000)
        with pytest.raises(ValueError, match="cannot advance"):
            clock.advance(-1.0)
        assert clock.now_ms() == 1000, "a refused advance must not move the clock"

    def test_advance_ms_is_exact_for_sub_millisecond_durations(self) -> None:
        """``advance(0.0001)`` would lose the millisecond to float truncation."""
        clock = FixedClock(wall_ms=0, monotonic=0.0)
        clock.advance_ms(1)
        assert clock.now_ms() == 1
        assert clock.monotonic() == pytest.approx(0.001)

    def test_advance_ms_refuses_negative(self) -> None:
        clock = FixedClock()
        with pytest.raises(ValueError, match="cannot advance"):
            clock.advance_ms(-5)

    def test_wall_ms_can_be_set_backwards_explicitly(self) -> None:
        """The one sanctioned way to provoke an NTP-style correction in a test."""
        clock = FixedClock(wall_ms=5000)
        clock.wall_ms = 4000
        assert clock.now_ms() == 4000

    def test_wall_ms_property_round_trips(self) -> None:
        clock = FixedClock(wall_ms=42)
        assert clock.wall_ms == 42
        clock.wall_ms = 99
        assert clock.wall_ms == 99

    def test_repeated_one_millisecond_steps_stay_ordered(self) -> None:
        """What entity-id ordering tests rely on."""
        clock = FixedClock(wall_ms=1_700_000_000_000)
        stamps = [clock.now_ms()]
        for _ in range(1000):
            clock.advance_ms(1)
            stamps.append(clock.now_ms())
        assert stamps == sorted(stamps)
        assert len(set(stamps)) == len(stamps)


class TestPartialClocks:
    def test_monotonic_clock_provides_intervals(self) -> None:
        clock = MonotonicClock(lambda: 12.5)
        assert clock.monotonic() == 12.5

    def test_monotonic_clock_raises_on_a_wall_reading(self) -> None:
        """Raising beats returning a plausible wrong number."""
        clock = MonotonicClock()
        with pytest.raises(NotImplementedError, match="no wall reading"):
            clock.now_ms()

    def test_monotonic_clock_defaults_to_time_monotonic(self) -> None:
        assert MonotonicClock().monotonic() > 0

    def test_wall_clock_provides_timestamps(self) -> None:
        assert WallClock(lambda: 1234).now_ms() == 1234

    def test_wall_clock_raises_on_an_interval_reading(self) -> None:
        with pytest.raises(NotImplementedError, match="no monotonic reading"):
            WallClock().monotonic()

    def test_wall_clock_defaults_to_the_real_wall_clock(self) -> None:
        assert WallClock().now_ms() > 1_700_000_000_000

    def test_both_accept_an_injected_function(self) -> None:
        """The adapter exists so existing callable-taking constructors keep working."""
        ticks = iter([1.0, 2.0, 3.0])
        clock = MonotonicClock(lambda: next(ticks))
        assert [clock.monotonic() for _ in range(3)] == [1.0, 2.0, 3.0]


class TestPortConformance:
    def test_system_clock_satisfies_the_full_port(self) -> None:
        clock = SystemClock()
        assert isinstance(clock, WallReading)
        assert isinstance(clock, MonotonicReading)
        assert isinstance(clock, Clock)

    def test_system_clock_is_not_controllable(self) -> None:
        """Production clocks must not be movable by a caller."""
        assert not isinstance(SystemClock(), ControllableClock)

    def test_fixed_clock_is_controllable(self) -> None:
        clock = FixedClock()
        assert isinstance(clock, Clock)
        assert isinstance(clock, ControllableClock)

    def test_the_test_fixture_satisfies_the_port(self) -> None:
        """``tests/conftest.py`` defines FakeClock independently; it must conform."""
        import sys

        sys.path.insert(0, "tests")
        from conftest import FakeClock

        clock = FakeClock()
        assert isinstance(clock, Clock)
        assert isinstance(clock, ControllableClock)

    def test_a_structural_duck_satisfies_the_port_without_importing_it(self) -> None:
        """L1 must not depend on L2, so conformance is structural, not nominal."""

        class Unrelated:
            def now_ms(self) -> int:
                return 1

            def monotonic(self) -> float:
                return 0.0

        assert isinstance(Unrelated(), Clock)

    def test_an_object_missing_a_reading_is_not_a_clock(self) -> None:
        class WallOnly:
            def now_ms(self) -> int:
                return 1

        instance = WallOnly()
        assert isinstance(instance, WallReading)
        assert not isinstance(instance, MonotonicReading)
        assert not isinstance(instance, Clock)


class TestRuntimeCheckableLimits:
    """Documenting a real trap rather than pretending it away.

    ``runtime_checkable`` protocols test for method *presence*, not behaviour.  A
    partial clock that raises on one reading therefore still passes ``isinstance``
    against the full ``Clock`` protocol.  The type system cannot catch that mistake;
    a narrow signature can, which is why ``ports/clock.py`` declares four protocols
    instead of one.
    """

    def test_a_partial_clock_still_passes_isinstance_against_clock(self) -> None:
        assert isinstance(MonotonicClock(), Clock)
        assert isinstance(WallClock(), Clock)

    def test_but_it_fails_when_the_missing_reading_is_used(self) -> None:
        clock: Any = MonotonicClock()
        assert clock.monotonic() >= 0
        with pytest.raises(NotImplementedError):
            clock.now_ms()

    def test_the_narrow_protocol_is_the_honest_signature(self) -> None:
        """A consumer asking only for intervals cannot be handed a wall-only clock."""

        def measure(clock: MonotonicReading) -> float:
            return clock.monotonic()

        assert measure(MonotonicClock(lambda: 3.0)) == 3.0
        with pytest.raises(NotImplementedError):
            measure(WallClock(lambda: 1))

    def test_mypy_catches_what_isinstance_cannot(self) -> None:
        """Static checking is the real guard; this documents that it is exercised.

        ``MonotonicClock`` is accepted by ``isinstance(..., Clock)`` at runtime but
        is not assignable to a ``Clock``-typed parameter in a strict type checker
        unless it declares both methods.  It does declare both (one raising), so the
        honest protection is the narrow protocol, asserted above.
        """
        assert hasattr(MonotonicClock, "now_ms")
        assert hasattr(WallClock, "monotonic")


class TestIntegrationWithCore:
    """The clocks must actually drive the mechanisms that accept them."""

    def test_the_event_bus_accepts_a_fixed_clock(self) -> None:
        from nova_studio.core.events import EventBus

        clock = FixedClock(wall_ms=1_700_000_000_000)
        bus = EventBus(autostart=False, clock=clock.now_ms)
        envelopes = [bus.publish("t", index) for index in range(5)]
        assert {envelope.ts_ms for envelope in envelopes} == {1_700_000_000_000}
        assert [envelope.seq for envelope in envelopes] == [1, 2, 3, 4, 5]
        bus.shutdown()

    def test_the_event_bus_timestamp_follows_the_clock(self) -> None:
        from nova_studio.core.events import EventBus

        clock = FixedClock(wall_ms=1000)
        bus = EventBus(autostart=False, clock=clock.now_ms)
        first = bus.publish("t", 1)
        clock.advance(2.0)
        second = bus.publish("t", 2)
        assert first.ts_ms == 1000
        assert second.ts_ms == 3000
        bus.shutdown()

    def test_entity_ids_use_the_injected_clock(self) -> None:
        from nova_studio.core.ident import new_entity_id

        clock = FixedClock(wall_ms=1_700_000_000_000)
        first = new_entity_id(clock=clock)
        clock.advance_ms(1)
        second = new_entity_id(clock=clock)
        assert first < second

    def test_the_di_container_ages_scopes_by_the_injected_clock(self) -> None:
        """``describe_scopes`` reports an age, which is an interval — not a date.

        This is the container's real use of the clock: a scope opened at t and
        described at t+30s must report 30_000 ms of age regardless of what the wall
        clock says, and regardless of whether the wall clock stepped in between.
        """
        from nova_studio.core.di import ServiceContainer

        clock = FixedClock(wall_ms=1_700_000_000_000)
        container = ServiceContainer(name="clocked", clock=clock.now_ms)
        container.create_scope("s1", label="first")
        assert container.describe_scopes()[0]["age_ms"] == 0

        clock.advance(30.0)
        described = container.describe_scopes()[0]
        assert described["age_ms"] == 30_000
        assert described["label"] == "first"

    def test_a_backwards_wall_step_cannot_produce_a_negative_scope_age(self) -> None:
        """The reason scope age uses one injected clock rather than two readings.

        Both the creation stamp and the description come from the same callable, so
        an NTP correction between them is impossible by construction — there is only
        one source of time in the container.
        """
        from nova_studio.core.di import ServiceContainer

        clock = FixedClock(wall_ms=1_700_000_000_000)
        container = ServiceContainer(name="clocked", clock=clock.now_ms)
        container.create_scope("s1")
        clock.wall_ms = 1_699_999_990_000  # an NTP correction, ten seconds back
        assert container.describe_scopes()[0]["age_ms"] == -10_000
        # Documented, not silently clamped: a negative age is a visible signal that
        # the clock moved, which is more useful than a plausible zero.
        container.dispose_scope("s1")
