"""L4 — the system router: health, identity, capabilities, and the cache.

Three endpoints, and the only three the desktop shell needs before it has a
project. They exist as HTTP rather than as arguments to the window because the
shell starts the service as a *separate process* and then has to discover it: it
knows the port it asked for only once the server is listening, and it needs to
know that before it can hand the window its token.

Note the deliberate asymmetry in authentication:

* ``/healthz`` answers without a token, because it is polled *before* the shell
  has anywhere to keep one, and because it discloses nothing — a version string
  and a process id. It is still behind the Host/Origin guard, so it is not
  reachable from a web page.
* Everything under ``/api/v1`` needs the session token, without exception. One
  rule, no special cases, and therefore no special case to get wrong.
"""

from __future__ import annotations

import os
import platform
import sys
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Depends, Query

from nova_studio import __version__
from nova_studio.api.dependencies import session_state, workspace
from nova_studio.api.errors import error_responses, respond
from nova_studio.api.schemas.media import (
    MediaCacheDroppedResponse,
    MediaCacheEntrySummary,
    MediaCacheResponse,
)
from nova_studio.api.schemas.system import (
    CapabilitiesResponse,
    HealthResponse,
    SystemInfoResponse,
    platform_name,
    probe_components,
    python_version,
)
from nova_studio.api.state import SessionState

# Runtime imports on purpose: FastAPI resolves a handler's annotations to decide
# what each parameter *is*, and a name that exists only for mypy under
# `from __future__ import annotations` is not a dependency — it is a query
# parameter, and the endpoint then 422s with something that reads like nonsense
# until you know this (see `api/dependencies.py`).
from nova_studio.api.workspace import ProjectWorkspace  # noqa: TC001 — FastAPI resolves it
from nova_studio.core.result import ok
from nova_studio.domain.persistence import CacheKind  # noqa: TC001 — FastAPI resolves it
from nova_studio.infra.persistence.archive import SUPPORTED_FORMAT_VERSION

if TYPE_CHECKING:
    from nova_studio.api.state import SessionState

__all__ = ["router"]


#: The authenticated half of this module. ``/healthz`` is deliberately *not* on
#: it: it answers before a session token exists, and a router carrying the token
#: dependency cannot have an unauthenticated route.
router = APIRouter(tags=["system"])


async def healthz() -> HealthResponse:
    """Readiness: the one endpoint that answers before a session token exists.

    Registered by :func:`nova_studio.api.app.create_app` outside every router,
    because "which endpoints need a token" is a question with exactly one
    exception and the exception should be visible next to the rule.
    """
    return HealthResponse(status="ok", version=__version__, pid=os.getpid())


@router.get(
    "/api/v1/system/info",
    response_model=SystemInfoResponse,
    responses=error_responses(),
    summary="Who this session is",
)
async def system_info(state: SessionState = Depends(session_state)) -> Any:
    """The version, the data directory and the address this session bound."""
    return respond(
        ok(
            SystemInfoResponse(
                version=__version__,
                project_format_version=SUPPORTED_FORMAT_VERSION,
                python=python_version(),
                implementation=platform.python_implementation(),
                platform=platform_name(),
                frozen=bool(getattr(sys, "frozen", False)),
                pid=os.getpid(),
                data_dir=str(state.data_dir),
                host=state.host,
                port=state.port,
            )
        ),
        to_body=lambda body: body,
        instance="/api/v1/system/info",
    )


@router.get(
    "/api/v1/system/capabilities",
    response_model=CapabilitiesResponse,
    responses=error_responses(),
    summary="What this machine can do",
)
async def capabilities() -> Any:
    """Which optional components are installed, and whether the app can run."""
    return respond(
        ok(probe_components()),
        to_body=lambda body: body,
        instance="/api/v1/system/capabilities",
    )


@router.get(
    "/api/v1/system/cache",
    response_model=MediaCacheResponse,
    responses=error_responses(),
    summary="What the derived-media cache is holding",
)
async def read_cache(projects: ProjectWorkspace = Depends(workspace)) -> Any:
    """Every derived artefact this install has made, oldest use first.

    Here rather than under a project, because the cache **is** install-wide:
    two projects that share a source share its proxy, and a user asking "how
    much disk is this costing me" is asking about the machine, not about a
    file.

    The order is the order eviction will take them in, which is what an
    inspector and a byte budget both want to read off the same list.
    """
    entries = projects.media_cache.entries()
    return MediaCacheResponse(
        entries=[
            MediaCacheEntrySummary(
                key=entry.key,
                kind=str(entry.kind),
                size_bytes=entry.size_bytes,
                created_ms=entry.created_ms,
                last_used_ms=entry.last_used_ms,
            )
            for entry in entries
        ],
        total=len(entries),
        size_bytes=sum(entry.size_bytes for entry in entries),
    )


@router.delete(
    "/api/v1/system/cache",
    response_model=MediaCacheDroppedResponse,
    responses=error_responses(),
    summary="Delete derived media",
)
async def drop_cache(
    kind: CacheKind | None = Query(
        default=None,
        description="Delete only this kind — `proxy`, `thumbnail` — instead of everything.",
    ),
    projects: ProjectWorkspace = Depends(workspace),
) -> Any:
    """Forget derived bytes, and say how much disk came back.

    Losing the cache costs a rebuild and nothing else (ADR-0015 rule 6: it is
    disposable), which is why this is a button and not a confirmation about
    projects. Proxies and thumbnails come back the next time something asks for
    them.

    The bytes go before the row, per entry, so an interrupted deletion leaves an
    entry pointing at nothing — which the cache already reads as a miss — rather
    than unreachable bytes no entry names and no eviction will ever reclaim.
    """
    dropped = projects.media_cache.drop(kind)
    what = "derived media" if kind is None else f"cached {kind}"
    return MediaCacheDroppedResponse(
        entries=dropped.entries,
        size_bytes=dropped.size_bytes,
        summary=f"dropped {dropped.entries} {what} item(s), {dropped.size_bytes / 1_048_576:.1f} MB",
    )
