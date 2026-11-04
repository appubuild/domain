"""Nova Studio — a production desktop video editor with an AI caption studio.

The package is organised as four rings whose dependencies point strictly inward
(ADR-0002).  Reading the rings in order is the fastest way to understand the
system, because each one only makes sense in terms of the one inside it::

    L1  nova_studio.core       the infrastructure-agnostic kernel
    L2  nova_studio.domain     entities, value objects, invariants
        nova_studio.ports      interfaces the outside world must satisfy
    L3  nova_studio.services   use cases, engines, orchestration
    L4  nova_studio.infra      concrete adapters (PyAV, OpenCV, SQLite, Whisper)
        nova_studio.api        FastAPI routers, DTOs, WebSocket bridge

This module deliberately imports **nothing** from those rings.  ``import
nova_studio`` must stay free, because the desktop launcher, every render worker
and every plugin host imports it before deciding what it actually needs.  Import
the ring you mean::

    from nova_studio.core import EventBus, ServiceContainer
    from nova_studio.domain.timeline import Timeline

Two invariants are worth stating here because they are easy to break by accident
and expensive to discover later:

* **Nothing in L1 or L2 performs I/O.**  Clocks, identifiers, files and codecs
  arrive through ports and are injected by the container.
* **The inner rings are framework-free.**  ``pydantic`` lives at the wire boundary
  (``api``/``infra``); domain models are plain frozen dataclasses.  See ADR-0002
  rule 6 for the measured cost that motivated this.

``scripts/check_layering.py`` and ``tests/core/test_public_api.py`` enforce both
mechanically, so a violation fails the build rather than arriving in review.
"""

from __future__ import annotations

#: Distribution version.  Single source of truth is ``pyproject.toml``; this is
#: duplicated rather than read at import time because querying installed metadata
#: costs an ``importlib.metadata`` lookup on every process start, and the launcher
#: needs the version before the package is necessarily installed (frozen builds).
__version__: str = "0.1.0"

#: The version of the on-disk project format this build writes (ADR-0015).  Kept
#: separate from ``__version__`` because the format must stay stable across
#: application releases: a patch release that cannot open yesterday's project is a
#: data-loss bug, not an inconvenience.
PROJECT_FORMAT_VERSION: int = 1

#: Schema version of the SQLite metadata store (ADR-0004).  Migrations are
#: forward-only and are applied on open by ``infra.persistence``.
DATABASE_SCHEMA_VERSION: int = 1

#: Wire version of the WebSocket protocol spoken to the frontend (ADR-0005).  The
#: client sends this in its handshake; a mismatch triggers a full resync rather
#: than a partial one, because a client that misunderstands the protocol cannot be
#: trusted to know what it missed.
WS_PROTOCOL_VERSION: int = 1

__all__ = [
    "DATABASE_SCHEMA_VERSION",
    "PROJECT_FORMAT_VERSION",
    "WS_PROTOCOL_VERSION",
    "__version__",
]
