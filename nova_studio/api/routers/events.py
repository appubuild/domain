"""L4 — the event router: the one WebSocket, and the history behind it.

`/api/v1/ws` is the only socket, and `/api/v1/events` is the same stream as a
plain REST read. The second exists because the first cannot be used by
everything that needs it: a command-line tool, a Playwright test, and the
frontend's own "am I behind?" check all want recent events without holding a
socket open, and making them open one would put a connection in the way of a
question.

Authentication on a WebSocket cannot be a header — browsers do not let
JavaScript set one on the handshake — so the token arrives in the query string
or in a subprotocol, and is checked before `accept()`. That ordering matters:
accepting first and rejecting after would give an unauthenticated caller a
socket, an open file and a slot in the connection table, which is precisely the
resource an unauthenticated caller should not be able to take.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Final

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, status

# `WebSocket` is imported at runtime on purpose, for the same reason `Request`
# is in `state.py`: FastAPI resolves an endpoint's annotations to decide what
# each parameter *is*, and one that exists only for mypy under
# `from __future__ import annotations` is not a socket — it is a query
# parameter, and the handshake dies of a missing argument.
from starlette.websockets import WebSocket  # noqa: TC002

from nova_studio.api.auth import LoopbackGuard, authorize_websocket
from nova_studio.api.dependencies import session_state
from nova_studio.api.errors import error_responses
from nova_studio.api.schemas.events import EventEnvelopeWire, RecentEventsResponse

if TYPE_CHECKING:
    from nova_studio.api.state import SessionState
    from nova_studio.api.ws import EventBridge

__all__ = ["install", "router"]

router = APIRouter(tags=["events"])

_BRIDGE_ATTRIBUTE: str = "bridge"

#: 416, written out for the same reason 422 is in `errors.py`: the number is
#: stable and the constant's name is not.
RANGE_NOT_SATISFIABLE: Final[int] = 416


def install(
    app: FastAPI, *, bridge: EventBridge, session: SessionState, guard: LoopbackGuard
) -> None:
    """Attach the WebSocket endpoint to an application.

    A function rather than a router-level decorator because the endpoint needs
    the bridge, the session token and the guard, all three of which exist only
    once the application is being built. Registering it here keeps the router
    importable — and its REST half testable — without them.
    """

    @app.websocket("/api/v1/ws")
    async def websocket_endpoint(websocket: WebSocket) -> None:
        # Both checks happen before accept(): an unauthenticated or foreign
        # caller must not get a socket, however briefly. Note that the HTTP
        # middleware does not run for a handshake, so the guard is asked here
        # or it is not asked at all.
        host = websocket.headers.get("host")
        origin = websocket.headers.get("origin")
        if authorize_websocket(websocket, session.token) is None or not guard.allows(host, origin):
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="not allowed")
            return
        await bridge.serve(websocket)


@router.get(
    "/api/v1/events",
    response_model=RecentEventsResponse,
    responses=error_responses(),
    summary="Recent events, for a client that fell behind",
)
async def recent_events(
    state: SessionState = Depends(session_state),
    since: int = Query(0, ge=0, description="Return events after this sequence number."),
    limit: int = Query(200, ge=1, le=2_000, description="Maximum events to return."),
) -> RecentEventsResponse:
    """The tail of the event history, as the WebSocket would have sent it.

    A client that detects a gap too large for the bus's retained history calls
    this (or refetches the slice) instead of pretending the gap did not happen.
    """
    bus = state.bus
    if since and bus.oldest_seq is not None and since + 1 < bus.oldest_seq:
        raise HTTPException(
            status_code=RANGE_NOT_SATISFIABLE,
            detail=(
                f"events before {bus.oldest_seq} are no longer retained; refetch the state you need"
            ),
        )
    envelopes = [EventEnvelopeWire(**envelope.to_wire()) for envelope in bus.replay_from(since)]
    return RecentEventsResponse(
        events=envelopes[:limit],
        last_seq=bus.last_seq,
        oldest_seq=bus.oldest_seq,
        count=min(len(envelopes), limit),
    )
