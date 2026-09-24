"""Identity generation for Nova Studio.

Every persistent entity in Nova Studio carries a stable, globally unique, sortable
identifier.  Identifiers are *never* re-used, never derived from user-visible data
(no slugs, no paths), and never change across renames or moves — that is what makes
undo deltas, caption merge keys (ADR-0009) and the command log (ADR-0008) possible.

Two flavours are produced:

``EntityId``
    A typed ``UUIDv7`` string.  UUIDv7 is time-ordered, which means ids sort in
    creation order — invaluable when debugging a timeline document by eye, and it
    keeps SQLite B-tree inserts append-only instead of random.

``ShortId``
    A human-quotable 8-character Crockford base32 token used for job ids, request
    ids and log correlation, where a user must be able to read it aloud to support.

Security note
-------------
Identifiers are **unique and ordered, not secret or unpredictable**: after the
first id from a factory the counter is deterministic, so an observer can estimate
how many entities were created.  Anything that must be unguessable — the loopback
API session token (ADR-0005), temporary file names — uses :func:`process_token` or
:func:`random_suffix`, which draw from :mod:`secrets` every time.

The clock and the RNG are injectable so that tests can produce deterministic ids.
"""

from __future__ import annotations

import os
import secrets
import threading
import time
from typing import NewType, Protocol

__all__ = [
    "CLOCK_SEQ_BITS",
    "EntityId",
    "IdFactory",
    "ShortId",
    "is_valid_entity_id",
    "new_entity_id",
    "new_short_id",
]

#: RFC 9562 lays UUIDv7 out as 48 bits of unix-ms, 4 bits of version, 12 bits of
#: ``rand_a``, 2 bits of variant and 62 bits of ``rand_b``.  The spec permits an
#: implementation to use ``rand_a`` *and* ``rand_b`` for a monotonic counter.
#:
#: We place the counter in ``rand_b`` rather than ``rand_a``.  This matters:
#: ``rand_b`` is the low-order field, so two ids sharing a timestamp and counter
#: are ordered by ``rand_b``.  A counter in ``rand_a`` with entropy in ``rand_b``
#: would order such ids *randomly*, which silently breaks the sortability that is
#: the whole reason to choose v7 over v4.
CLOCK_SEQ_BITS = 12
_COUNTER_BITS = 62
_CLOCK_SEQ_MAX = (1 << CLOCK_SEQ_BITS) - 1
_COUNTER_MAX = (1 << _COUNTER_BITS) - 1

_UUIDV7_VERSION_NIBBLE = 0x7
#: RFC 9562 variant ``10`` occupies the two most significant bits of ``rand_b``'s
#: leading octet, i.e. bits 63-62 of the 128-bit value.
_RFC4122_VARIANT_BITS = 0b10

#: Crockford base32 without the ambiguous characters I, L, O and U.
_CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

EntityId = NewType("EntityId", str)
ShortId = NewType("ShortId", str)


class Clock(Protocol):
    """Minimal clock abstraction so ids can be generated deterministically in tests."""

    def now_ms(self) -> int:
        """Return the current time as integer milliseconds since the unix epoch."""
        ...


class _SystemClock:
    """Default :class:`Clock` backed by :func:`time.time`."""

    __slots__ = ()

    def now_ms(self) -> int:
        return int(time.time() * 1000)


class _EntropySource(Protocol):
    def rand_bytes(self, count: int) -> bytes: ...


class _SystemEntropy:
    __slots__ = ()

    def rand_bytes(self, count: int) -> bytes:
        return secrets.token_bytes(count)


def _format_uuid(value: int) -> str:
    """Render a 128-bit integer in canonical 8-4-4-4-12 hex form."""
    text = f"{value:032x}"
    return f"{text[0:8]}-{text[8:12]}-{text[12:16]}-{text[16:20]}-{text[20:32]}"


def new_entity_id(clock: Clock | None = None) -> EntityId:
    """Create a time-ordered UUIDv7 identifier.

    The generator is thread-safe and monotonic: two ids produced in the same
    millisecond are ordered by an internal counter, and if the counter would
    overflow the generator advances the timestamp by one millisecond rather than
    producing an out-of-order id.

    Args:
        clock: Optional clock override; defaults to wall-clock milliseconds.

    Returns:
        A lower-case canonical UUID string tagged as :data:`EntityId`.
    """
    return _DEFAULT_FACTORY.new_entity_id(clock)


def _check_short_length(length: int) -> None:
    """Validate a short-id length with the one canonical message."""
    if not 4 <= length <= 32:
        raise ValueError(f"short id length must be in [4, 32], got {length}")


def _short_id_from(raw: bytes) -> ShortId:
    """Map whole bytes to Crockford base32.

    The modulo bias over a 32-symbol alphabet from 256 values is 0
    (256 % 32 == 0), so ``byte >> 3`` is uniformly distributed without
    rejection sampling.
    """
    return ShortId("".join(_CROCKFORD_ALPHABET[byte >> 3] for byte in raw))


def new_short_id(length: int = 8) -> ShortId:
    """Create a short, human-quotable identifier.

    Args:
        length: Number of Crockford base32 characters.  Each character carries 5
            bits of entropy, so the default of 8 gives 40 bits — ample for job and
            request ids within a single desktop session.

    Returns:
        An upper-case token tagged as :data:`ShortId`.

    Raises:
        ValueError: If ``length`` is not between 4 and 32 inclusive.
    """
    _check_short_length(length)
    return _short_id_from(secrets.token_bytes(length))


def is_valid_entity_id(candidate: str) -> bool:
    """Return ``True`` when ``candidate`` is a syntactically valid UUIDv7 string.

    Used when loading project documents and API payloads so that a malformed id
    produces a precise error instead of a confusing downstream failure.
    """
    if len(candidate) != 36 or candidate.count("-") != 4:
        return False
    try:
        value = int(candidate.replace("-", ""), 16)
    except ValueError:
        return False
    version = (value >> 76) & 0xF
    variant = (value >> 62) & 0x3
    return version == 7 and variant == 0b10


class IdFactory:
    """Thread-safe, monotonic UUIDv7 factory.

    One instance is shared process-wide via :func:`new_entity_id`; tests construct
    their own instance with a fake clock and entropy source to obtain reproducible
    ids.
    """

    __slots__ = ("_clock", "_counter", "_entropy", "_last_ms", "_lock")

    def __init__(
        self,
        clock: Clock | None = None,
        entropy: _EntropySource | None = None,
    ) -> None:
        self._clock: Clock = clock if clock is not None else _SystemClock()
        self._entropy: _EntropySource = entropy if entropy is not None else _SystemEntropy()
        self._lock = threading.Lock()
        self._last_ms = 0
        self._counter = int.from_bytes(self._entropy.rand_bytes(2), "big") & _CLOCK_SEQ_MAX

    def new_entity_id(self, clock: Clock | None = None) -> EntityId:
        """Generate the next identifier.

        Ordering is guaranteed by construction: the 48-bit millisecond timestamp
        occupies the high bits and the 62-bit monotonic counter the low ones, so
        lexicographic order of the rendered strings equals generation order even
        when many ids share one millisecond or the system clock jumps backwards.

        Args:
            clock: Optional one-shot clock override; useful in tests that need a
                specific timestamp without replacing the factory's clock.
        """
        active_clock = clock if clock is not None else self._clock
        with self._lock:
            now = active_clock.now_ms()
            if now < self._last_ms:
                # Clock moved backwards (NTP correction, DST, VM resume).  Never
                # emit a non-monotonic id: hold the last known timestamp and let
                # the counter provide ordering.
                now = self._last_ms

            # The counter advances on *every* id, including when the timestamp did
            # not move.  Skipping the increment on a held timestamp would emit the
            # same id twice, which is worse than emitting an out-of-order one.
            self._counter += 1
            if self._counter > _COUNTER_MAX:
                # Counter exhausted — unreachable in practice (4.6e18 ids), but
                # handled so that ordering and uniqueness never break.
                self._counter = 0
                now = self._last_ms + 1
            self._last_ms = now

            value = (
                (now & ((1 << 48) - 1)) << 80
                | _UUIDV7_VERSION_NIBBLE << 76
                | ((self._counter >> _COUNTER_BITS) & _CLOCK_SEQ_MAX) << 64
                | _RFC4122_VARIANT_BITS << 62
                | (self._counter & _COUNTER_MAX)
            )
        return EntityId(_format_uuid(value))

    def new_short_id(self, length: int = 8) -> ShortId:
        """Create a short, human-quotable identifier from factory entropy.

        Lives on the factory so one injected object satisfies the full
        ``ports.ident.IdGenerator`` port.  Bytes come from this factory's
        entropy source — unlike the module-level function, which always draws
        from ``secrets`` — so a test double with fixed entropy mints fixed
        tokens, for the same reason the factory takes an injected clock.
        """
        _check_short_length(length)
        return _short_id_from(self._entropy.rand_bytes(length))


_DEFAULT_FACTORY = IdFactory()


def process_token() -> str:
    """Return a per-process random token used for loopback API authentication.

    The desktop shell injects this into the frontend at window creation so that the
    core service can reject requests from other local processes (ADR-0005 §4).
    """
    return secrets.token_urlsafe(32)


def random_suffix(length: int = 6) -> str:
    """Return a lowercase alphanumeric suffix for temporary file names."""
    alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
    return "".join(alphabet[b % len(alphabet)] for b in os.urandom(length))
