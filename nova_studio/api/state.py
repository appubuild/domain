"""L4 — the session: everything one running instance is, in one frozen value.

A desktop editor can be running more than once. Two windows, two projects, two
journals, two session tokens — and every one of those is per-instance state that
must not leak between them. Bundling them into one frozen object, created once at
startup and injected into every handler, is what makes that structural rather
than a matter of remembering.

Why frozen, and why one object rather than several module globals:

* **A global is shared between instances.** Two `EventBridge`s in one process —
  a test, or a future multi-window shell — would both see the last one's bus.
  Dependencies injected from a value cannot have that bug.
* **Frozen, so a handler cannot quietly rebind it.** A mutation that survives to
  the next request is the kind of defect that appears an hour later in a
  different feature.
* **It carries the address it bound.** "Which port did this instance get" is
  asked by the shell that started it, and the answer has to come from the
  instance that knows rather than from a shared file two instances would race
  over.

This is also the answer to "where does the token live": in the session value,
handed to the window once by the code that created it, and never read from a
global by anything else.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import TYPE_CHECKING

# `Request` is imported at runtime on purpose: FastAPI resolves this module's
# annotations to decide what a dependency *is*, and under
# `from __future__ import annotations` a `Request` that exists only for mypy
# degrades into "a parameter with no known type", i.e. a query string. The
# endpoint then 422s with "request: field required", which reads like nonsense
# until you know this.
from nova_studio.api.auth import SessionToken
from nova_studio.infra.paths import data_dir

if TYPE_CHECKING:
    from pathlib import Path

    from nova_studio.core.events import EventBus

__all__ = ["SessionState", "new_session_state"]


@dataclass(frozen=True, slots=True)
class SessionState:
    """One running instance: what it owns and where it can be reached.

    Attributes:
        data_dir: Where this instance writes journals, caches and logs.
        host: The host it is bound to — `127.0.0.1` for a real session.
        port: The port it chose, or `0` before it is listening.
        started_ms: When it started, in unix milliseconds.
        bus: The event bus its services publish to and the bridge forwards from.
        token: This session's bearer token.
        app_version: The build, for the About box and for bug reports.
    """

    data_dir: Path
    bus: EventBus
    token: SessionToken
    host: str = "127.0.0.1"
    port: int = 0
    started_ms: int = 0
    app_version: str = ""

    @property
    def origin(self) -> str:
        """The base URL of this session, for the shell that has to find it."""
        return f"http://{self.host}:{self.port}"

    @property
    def uptime_ms(self) -> int:
        """How long this session has been up, in milliseconds."""
        return max(0, int(time.time() * 1000) - self.started_ms)


def new_session_state(
    bus: EventBus,
    *,
    host: str = "127.0.0.1",
    port: int = 0,
    app_version: str = "",
) -> SessionState:
    """Build the state for a session that is about to start.

    The data directory is resolved here rather than at import time, so that a
    test can set `NOVA_DATA_DIR` and get an answer that reflects it.
    """
    directory, _from_env = data_dir()
    return SessionState(
        data_dir=directory,
        bus=bus,
        token=SessionToken(),
        host=host,
        port=port,
        started_ms=int(time.time() * 1000),
        app_version=app_version,
    )
