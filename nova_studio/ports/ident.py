"""L2 port — identity: who mints the names of things.

Every aggregate in the domain needs an identifier at the moment it is created,
and identifiers must keep sorting in creation order across reopen, restore and
sync.  The domain therefore never calls ``uuid4`` and never reads the clock to
make one: it receives an :class:`IdSource` — or the wider :class:`IdGenerator` —
from its caller, exactly as it receives a ``ports.clock.Clock``.

Two protocols, narrowest first, for the same reason as ``clock.py``::

    IdSource      new_entity_id() only    ← what an aggregate factory needs
    IdGenerator   + new_short_id()        ← jobs, sessions, share links

Ask for the least you need.  A consumer that can only mint entity ids should not
be handed a capability to mint short ids it will never use, and a test double
should not have to fake entropy it does not care about.

Naming: the port is deliberately **not** called ``IdFactory``.
``core.ident.IdFactory`` is the default implementation, and letting a port and
its implementation share one name is how the kernel ended up with three
different meanings for "Clock" before they were unified.  One name, one
meaning, per package.

``IdFactory`` satisfies :class:`IdGenerator` structurally — no adapter and no
import of ``ports`` from ``core`` are required (L1 stays free of L2).  Because
the seam is structural, infra may later bind a different implementation —
session-scoped sequences, HMAC-signed ids, a recording double — without touching
a single consumer.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol, runtime_checkable

__all__ = ["IdGenerator", "IdSource"]


@runtime_checkable
class IdSource(Protocol):
    """The narrow seam: mint one time-ordered entity identifier.

    Satisfied by :class:`nova_studio.core.ident.IdFactory` and by any test
    double that can produce ``EntityId`` values.  Implementations must be
    thread-safe: aggregates are created from request handlers and render
    workers alike, and two ids minted concurrently must never collide or
    reorder.
    """

    def new_entity_id(self) -> EntityId:
        """Return the next identifier, ordered by creation not by wall time."""
        ...


@runtime_checkable
class IdGenerator(IdSource, Protocol):
    """The full identity provider: entity ids plus short human-quotable ids.

    Short ids back job ids, request ids and share links — places where a 36
    character UUID is noise.  They are on this port rather than a third port
    because they come from the same factory and the same injected entropy
    source; splitting them would mean two bindings in the container for one
    concept.
    """

    def new_short_id(self, length: int = 8) -> ShortId:
        """Return a Crockford base32 token of ``length`` characters (4–32)."""
        ...


if TYPE_CHECKING:
    # Signatures only: with `from __future__ import annotations` neither the
    # value types nor the default-implementation check need a runtime import —
    # and L2 importing L1 for typing is allowed either way (TC001 prefers it).
    from nova_studio.core.ident import EntityId, IdFactory, ShortId

    # mypy verifies at type-check time — never at runtime — that the default L1
    # implementation satisfies this port, so a signature change on either side
    # fails `make types` instead of surfacing as a binding error in production.
    def _default_satisfies_the_port(factory: IdFactory) -> IdGenerator:
        return factory
