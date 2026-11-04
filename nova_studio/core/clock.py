"""Clocks: the injected present (ADR-0002 rule 1).

``domain`` may not read the time — no ``datetime.now()``, no ``time.time()`` — because
an entity whose behaviour depends on the wall clock cannot be tested twice with the
same result, and cannot be replayed during crash recovery.  Time is therefore a
dependency: L1 provides the default implementations here, L2 declares the
:mod:`nova_studio.ports.clock` protocols they satisfy, and the container binds one.
Tests bind a fake and advance it explicitly.

Two readings, and confusing them is a real bug rather than a style slip:

``now_ms()``
    Wall clock, unix milliseconds.  **Can jump backwards** — an NTP correction or a
    user changing the timezone moves it.  Correct for timestamps, entity ids and
    anything a human reads.  Wrong for measuring an interval.

``monotonic()``
    Seconds from an unspecified epoch that only ever increases.  Correct for
    durations, deadlines, gesture-coalescing windows and throttling.  Meaningless as
    a date.

Using the wall clock for a timeout means an NTP step can fire it immediately or
never; using the monotonic clock for a timestamp produces a date in 1970.  Both
have shipped in real editors.

Why the implementations live in L1 while the protocol lives in L2
----------------------------------------------------------------
The protocol is the *seam* consumers depend on, and seams belong with the domain
(ADR-0002).  The implementations are two stdlib calls with no I/O, no configuration
and nothing product-specific, so putting them in ``infra`` would create a ring-4
package whose entire contents are ``return time.monotonic()`` — and would force L1,
which already needs a clock for event envelopes and id generation, to depend
outward on it.  L1 stays stdlib-only either way, which is the constraint that
actually matters.
"""

from __future__ import annotations

import time
from typing import TYPE_CHECKING, Final

if TYPE_CHECKING:
    from collections.abc import Callable

__all__ = [
    "DEFAULT_CLOCK",
    "FixedClock",
    "MonotonicClock",
    "SystemClock",
    "WallClock",
    "monotonic_seconds",
    "wall_milliseconds",
]


def wall_milliseconds() -> int:
    """Current unix time in integer milliseconds.

    Truncated, not rounded: a timestamp that rounds up can precede the event it
    describes, and ids must never claim to be from the future.
    """
    return int(time.time() * 1000)


def monotonic_seconds() -> float:
    """Monotonic seconds from an unspecified epoch."""
    return time.monotonic()


class SystemClock:
    """The production clock: wall time from :func:`time.time`, intervals from
    :func:`time.monotonic`.

    Stateless and shared safely between threads.  Satisfies
    :class:`nova_studio.ports.clock.Clock` — and therefore
    :class:`~nova_studio.ports.clock.ControllableClock`'s read half — structurally,
    so no import of the port is needed here: L1 must not depend on L2.
    """

    __slots__ = ()

    def now_ms(self) -> int:
        """Wall clock in unix milliseconds.  May jump backwards."""
        return wall_milliseconds()

    def monotonic(self) -> float:
        """Monotonic seconds.  Never jumps backwards."""
        return monotonic_seconds()


class MonotonicClock:
    """Adapts a ``() -> float`` seconds function to a clock-shaped object.

    This is what :mod:`nova_studio.core.commands` uses for gesture coalescing: it
    measures intervals and has no opinion about the date.  It satisfies
    :class:`nova_studio.ports.clock.MonotonicReading` and deliberately **not**
    :class:`~nova_studio.ports.clock.Clock` — ``now_ms()`` raises rather than
    returning a plausible-looking wrong number.

    ``runtime_checkable`` protocols test method presence, not behaviour, so
    ``isinstance(MonotonicClock(), Clock)`` is nonetheless ``True``.  That is a
    known limit of structural typing, and the reason consumers needing one reading
    should accept the one-reading protocol: the type system cannot catch this
    particular mistake, but a narrow signature makes it unreachable.
    """

    __slots__ = ("_seconds",)

    def __init__(self, seconds: Callable[[], float] = monotonic_seconds) -> None:
        self._seconds = seconds

    def monotonic(self) -> float:
        return self._seconds()

    def now_ms(self) -> int:
        """Always raises: this clock measures intervals and cannot tell the time."""
        raise NotImplementedError(
            "MonotonicClock has no wall reading. Use SystemClock.now_ms() for "
            "timestamps, or MonotonicClock.monotonic() for an interval."
        )


class WallClock:
    """Adapts a ``() -> int`` milliseconds function to a clock-shaped object.

    The mirror of :class:`MonotonicClock`, for consumers such as the event bus and
    the DI container that timestamp events and rebinds but never measure a duration.
    Satisfies :class:`nova_studio.ports.clock.WallReading`; ``monotonic()`` raises.
    Accepting a bare callable keeps those constructors' existing signatures working
    while still offering a named type for the container to bind.
    """

    __slots__ = ("_milliseconds",)

    def __init__(self, milliseconds: Callable[[], int] = wall_milliseconds) -> None:
        self._milliseconds = milliseconds

    def now_ms(self) -> int:
        return self._milliseconds()

    def monotonic(self) -> float:
        """Always raises: this clock tells the time and cannot measure an interval."""
        raise NotImplementedError(
            "WallClock has no monotonic reading. Use SystemClock.monotonic() for a "
            "duration, or WallClock.now_ms() for a timestamp."
        )


class FixedClock:
    """A clock that does not move unless told to.

    For tests that need a *stable* reading rather than a controllable one: an
    autosave interval check, an id-ordering assertion, a cache-expiry boundary.
    ``tests/conftest.py`` ships the richer ``FakeClock`` (two independently advanced
    readings); this is the smaller tool for the simpler job, and lives in L1 so that
    core's own tests need no fixture plumbing.

    ``advance`` refuses negative durations.  A test that needs to simulate a clock
    stepping backwards is testing id generation, and should say so explicitly by
    setting ``wall_ms`` directly — an accidental negative advance in an unrelated
    test would otherwise pass silently and prove nothing.
    """

    __slots__ = ("_monotonic", "_wall_ms")

    def __init__(self, *, wall_ms: int = 0, monotonic: float = 0.0) -> None:
        self._wall_ms = wall_ms
        self._monotonic = monotonic

    @property
    def wall_ms(self) -> int:
        """The current wall reading."""
        return self._wall_ms

    @wall_ms.setter
    def wall_ms(self, value: int) -> None:
        """Set the wall reading directly, including backwards.

        Explicit and intentionally awkward to type, so that a backwards jump only
        ever happens in a test that means to provoke one.
        """
        self._wall_ms = value

    def now_ms(self) -> int:
        return self._wall_ms

    def monotonic(self) -> float:
        return self._monotonic

    def advance(self, seconds: float) -> None:
        """Move both readings forward by ``seconds``."""
        if seconds < 0:
            raise ValueError(
                f"FixedClock cannot advance by {seconds}; set wall_ms directly to "
                "simulate a backwards clock step."
            )
        self._monotonic += seconds
        self._wall_ms += int(seconds * 1000)

    def advance_ms(self, milliseconds: int) -> None:
        """Move both readings forward by an exact number of milliseconds.

        Separate from :meth:`advance` because sub-millisecond durations lose
        precision through the float conversion, and an id-ordering test cares about
        exactly one millisecond.
        """
        if milliseconds < 0:
            raise ValueError(
                f"FixedClock cannot advance by {milliseconds}; set wall_ms directly "
                "to simulate a backwards clock step."
            )
        self._monotonic += milliseconds / 1000
        self._wall_ms += milliseconds


#: The clock used when a caller does not supply one.  A module-level singleton is
#: safe because every implementation above is stateless.
DEFAULT_CLOCK: Final[SystemClock] = SystemClock()
