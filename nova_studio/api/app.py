"""L4 — the application: one factory, one socket, one token.

This is where ADR-0005 becomes running code, and its shape follows from the
decision rather than from convenience:

* **The port is ephemeral.** `create_app` does not choose one; whoever starts the
  server does, and passes it back into the session state so the shell can find
  it. A fixed port would collide with other software and forbid a second
  instance, which for an editor is not acceptable — "open this project in a new
  window" is a normal thing to want.
* **The socket is one endpoint, not many.** One WebSocket at `/api/v1/ws` carries
  every event; a socket per topic would multiply the handshake cost, the token
  checks and the places a gap can appear.
* **Everything under `/api/v1` is authenticated; `/healthz` is not,** and the
  asymmetry is deliberate: the shell polls health *before* it has a token,
  health discloses nothing, and the Host/Origin guard covers it anyway.

The factory takes its dependencies as arguments and stores the session on
`app.state`. There is no container and no global, because a global would be
shared by the second instance in this process, and because the objects here —
the bus, the token, the data directory — are exactly the things that must not be
shared.

Lifespan does three things: start the bus if nobody has, publish that the service
came up, and shut the bus down on the way out. Nothing else. A lifespan that
opened a project or warmed a cache would be doing work the user did not ask for
before they had a window to see it in.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import TYPE_CHECKING

from fastapi import Depends, FastAPI

from nova_studio import __version__
from nova_studio.api.auth import LoopbackGuard, token_dependency
from nova_studio.api.errors import error_responses, install_error_handlers
from nova_studio.api.routers import events, projects, system, timeline
from nova_studio.api.schemas.system import HealthResponse
from nova_studio.api.state import SessionState, new_session_state
from nova_studio.api.workspace import ProjectWorkspace
from nova_studio.api.ws import (
    DEFAULT_HEARTBEAT_SECONDS,
    DEFAULT_MAX_BUFFERED,
    EventBridge,
)

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Callable
    from contextlib import AbstractAsyncContextManager

    from nova_studio.core.events import EventBus

__all__ = ["ApiSettings", "create_app"]


@dataclass(frozen=True, slots=True)
class ApiSettings:
    """How this session's transport is configured.

    Every field has a default that is correct for a desktop session, so the
    shell can create an app with nothing but a bus.
    """

    #: Hosts a `Host` header may name. Loopback by default (ADR-0005 §4); a
    #: development server adds its own, and a packaged shell adds nothing.
    allowed_hosts: tuple[str, ...] | None = None
    #: Topics the WebSocket carries; `None` means every topic.
    topics: tuple[str, ...] | None = None
    #: Events buffered per client before the oldest are dropped.
    max_buffered: int = DEFAULT_MAX_BUFFERED
    #: Idle seconds between heartbeats.
    heartbeat_seconds: float = DEFAULT_HEARTBEAT_SECONDS
    #: Whether the OpenAPI docs are served. On in development, off in a
    #: packaged build: they are a map of the internals and they cost nothing to
    #: withhold from a user who will never read them.
    docs: bool = True
    #: The version reported in `/healthz` and the About box.
    app_version: str = __version__


def create_app(
    bus: EventBus,
    *,
    settings: ApiSettings | None = None,
    session: SessionState | None = None,
) -> FastAPI:
    """Build the ASGI application for one session.

    Args:
        bus: The event bus the WebSocket forwards from and services publish to.
        settings: Transport configuration; desktop defaults when omitted.
        session: The session state. Created from the bus when omitted, which is
            what the desktop shell does and what a test overrides when it wants
            to control the token.

    Returns:
        A FastAPI application with the error handlers, the loopback guard, the
        session-token dependency, the system router and the WebSocket bridge
        installed, and the session available to handlers as `app.state.session`.
    """
    settings = settings or ApiSettings()
    state = session or new_session_state(bus, app_version=settings.app_version)
    bridge = EventBridge(
        bus,
        topics=settings.topics,
        max_buffered=settings.max_buffered,
        heartbeat_seconds=settings.heartbeat_seconds,
    )
    guard = LoopbackGuard(allowed_hosts=settings.allowed_hosts)
    # The projects this session has open. Built before the application because
    # the lifespan closes them, and held on `app.state` so a handler's dependency
    # can reach them without a global.
    workspace = ProjectWorkspace(bus, data_dir=state.data_dir)

    app = FastAPI(
        title="Nova Studio",
        version=settings.app_version,
        summary="The local service behind the Nova Studio editor.",
        description=(
            "Every capability the editor has is here. The desktop window and the "
            "browser dev server are two clients of the same contract."
        ),
        docs_url="/docs" if settings.docs else None,
        redoc_url=None,
        openapi_url="/openapi.json" if settings.docs else None,
        lifespan=_lifespan(state, bus, workspace),
    )

    # The session travels with the app rather than living in a module global:
    # two apps in one process — a test, a second window — must not share a token.
    app.state.session = state
    app.state.bridge = bridge
    app.state.workspace = workspace

    install_error_handlers(app)
    app.middleware("http")(guard.as_middleware())

    # One dependency, applied to every router rather than to every handler: a
    # handler that forgot to ask for it would otherwise be an unauthenticated
    # endpoint, and "forgot" is the usual reason those exist.
    authenticated = [Depends(token_dependency(state.token))]
    app.include_router(system.router, dependencies=authenticated)
    app.include_router(events.router, dependencies=authenticated)
    app.include_router(projects.router, dependencies=authenticated)
    app.include_router(timeline.router, dependencies=authenticated)

    # The projects this session has open, held next to the session rather than
    # beside it in a global: a second window is a second workspace.
    events.install(app, bridge=bridge, session=state, guard=guard)

    # The one endpoint that answers without a token, deliberately outside the
    # routers above: the shell polls it *before* a token has anywhere to live.
    # It is still behind the Host/Origin guard, and it discloses a version
    # string and a process id, which is what makes that acceptable.
    app.get(
        "/healthz",
        response_model=HealthResponse,
        responses=error_responses(),
        tags=["system"],
        summary="Is the service up?",
    )(system.healthz)
    return app


def _lifespan(
    state: SessionState, bus: EventBus, workspace: ProjectWorkspace
) -> Callable[[FastAPI], AbstractAsyncContextManager[None]]:
    """Start and stop the bus with the application, and announce both.

    Also closes every open project on the way out: a process that exits holding
    an archive leaves a staged temporary file or a lock behind, and the next
    launch is the one that has to explain it.
    """

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        if not bus.is_running:
            bus.start()
        bus.publish("api.started", {"version": state.app_version, "port": state.port})
        try:
            yield
        finally:
            workspace.close_all()
            bus.publish("api.stopped", {"port": state.port})
            bus.shutdown()

    return lifespan
