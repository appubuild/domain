"""L4 — the system router: health, identity, capabilities.

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

from fastapi import APIRouter, Depends

from nova_studio import __version__
from nova_studio.api.errors import error_responses, respond
from nova_studio.api.schemas.system import (
    CapabilitiesResponse,
    HealthResponse,
    SystemInfoResponse,
    platform_name,
    probe_components,
    python_version,
)
from nova_studio.api.state import SessionState, session_state
from nova_studio.core.result import ok
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
        to_body=lambda body: body.model_dump(mode="json"),
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
        to_body=lambda body: body.model_dump(mode="json"),
        instance="/api/v1/system/capabilities",
    )
