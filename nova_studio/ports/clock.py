"""Port: the injected present.

The seam that lets ``domain`` and ``services`` use time without reading it, which is
what makes an edit decision testable without a filesystem and reproducible under a
frozen clock (ADR-0002 rule 1: no ``datetime.now()``, no ``random``, no I/O — time
and identity are injected).

Four protocols, narrowest first, because a consumer should ask for the least it needs:

``WallReading``
    ``now_ms()`` only.  Wall clock; can jump backwards.
``MonotonicReading``
    ``monotonic()`` only.  Cannot jump; meaningless as a date.
``Clock``
    Both readings.  What the domain takes, since an entity carries timestamps *and*
    needs to reason about intervals.
``ControllableClock``
    A ``Clock`` that can also be advanced.  Test doubles implement it; production
    code should not require it.

Asking for the narrow protocol is what keeps a partial clock honest.
:class:`nova_studio.core.clock.MonotonicClock` is a ``MonotonicReading`` and is
*not* a ``Clock``: handing it to something that wants both readings would type-check
and then raise at the moment the second reading was needed — typically during a
long export, which is the worst available time to discover it.  Consumers that want
one reading should accept the one-reading protocol; ``core.di`` and
``core.commands`` already take bare callables for exactly this reason.

Why two readings rather than one
--------------------------------
``now_ms()`` is the wall clock and can jump backwards when NTP corrects it or the
user changes timezone.  ``monotonic()`` cannot jump but is meaningless as a date.  A
single-method clock forces every caller to guess which it is getting, and the guess
surfaces later as a timeout that fires immediately after a clock step, or a timestamp
reading 1970.

Structural typing is deliberate: :class:`nova_studio.core.clock.SystemClock` and the
``FakeClock`` in ``tests/conftest.py`` both satisfy ``Clock`` without importing this
module, so L1 keeps its rule that it may not depend on L2.  The same is true of
``core.ident``'s own minimal clock protocol, which is structurally a
``WallReading`` — L1 redeclares the narrow shape locally rather than importing it.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

__all__ = ["Clock", "ControllableClock", "MonotonicReading", "WallReading"]


@runtime_checkable
class WallReading(Protocol):
    """The wall clock, and nothing else."""

    __slots__ = ()

    def now_ms(self) -> int:
        """Integer milliseconds since the unix epoch.

        May jump backwards.  Use for timestamps and identifiers; never for measuring
        an interval.  Truncation rather than rounding matters: a reading that rounds
        up can precede the event it describes.
        """
        ...


@runtime_checkable
class MonotonicReading(Protocol):
    """A non-decreasing seconds counter, and nothing else."""

    __slots__ = ()

    def monotonic(self) -> float:
        """Seconds from an unspecified epoch, guaranteed non-decreasing.

        Use for durations, deadlines, coalescing windows and throttling; never as a
        date.
        """
        ...


@runtime_checkable
class Clock(WallReading, MonotonicReading, Protocol):
    """Both readings.  Injected; never constructed by the consumer."""

    __slots__ = ()


@runtime_checkable
class ControllableClock(Clock, Protocol):
    """A clock a test can move.

    Production code should accept :class:`Clock`.  Requiring this protocol in a
    service signature would mean that service could only be driven by a fake, which
    is exactly the coupling the port exists to remove.
    """

    __slots__ = ()

    def advance(self, seconds: float) -> None:
        """Move both readings forward by ``seconds``.

        Implementations should refuse a negative duration.  Simulating a backwards
        clock step is a deliberate act with one purpose — proving that id generation
        survives an NTP correction — and it should not be reachable by accident from
        a test that merely mis-computed an interval.
        """
        ...
