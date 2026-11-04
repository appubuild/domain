"""L4 — auth: the session token, and the loopback guard around it.

ADR-0005 §4 is blunt about why this exists: **loopback is not a trust boundary**.
Binding to `127.0.0.1` stops other machines; it does nothing about the other
processes on this one, and nothing at all about the browser — a web page the
user happens to have open can issue requests to `127.0.0.1:8765` and, with a
DNS-rebinding trick, can often make them same-origin. So the service defends
itself with two cheap checks:

1. **A bearer token**, 256 bits from `secrets`, generated per launch and handed
   to the window exactly once. Anything without it is refused.
2. **A Host and Origin check.** Every request must name a loopback host, and a
   request that carries an `Origin` (which a browser always does for a
   cross-origin fetch) must name a loopback *origin*. A page on
   `https://evil.example` cannot satisfy either, whatever DNS says.

Neither is a substitute for the other. The token stops a local process that
guessed the port; the Host check stops a web page that knows it.

Three details earn their place:

* **Comparison is constant-time.** `==` on a secret leaks its length and its
  prefix through timing, which is a small leak and a silly one to leave.
* **The WebSocket takes the token from the query string.** Browsers cannot set
  headers on a WebSocket handshake, so the client passes `?token=`; the REST
  dependency reads the `Authorization` header. One verifier, two transports.
* **The guard is constructed with the hosts it accepts**, not with a global
  default, so the desktop shell can stay strict while `make dev` allows the
  Vite origin on another port — configurability that is visible at the call site
  rather than buried in an environment variable.
"""

from __future__ import annotations

import hmac
import secrets
from typing import TYPE_CHECKING, Final
from urllib.parse import urlsplit

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from starlette.responses import JSONResponse

from nova_studio.api.errors import PROBLEM_MEDIA_TYPE
from nova_studio.core.errors import ErrorDomain

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable, Iterable

    from starlette.middleware.base import RequestResponseEndpoint
    from starlette.requests import Request as StarletteRequest
    from starlette.responses import Response
    from starlette.websockets import WebSocket

__all__ = [
    "TOKEN_BYTES",
    "LoopbackGuard",
    "SessionToken",
    "new_session_token",
    "token_dependency",
]

#: 256 bits, which is what ADR-0005 asks for and what makes guessing it a
#: non-event even at a million attempts a second for the life of the session.
TOKEN_BYTES: Final[int] = 32

#: The loopback hosts a request may name, in canonical form (an IPv6 literal
#: carries its brackets). Ports are deliberately not pinned: the service's own
#: port is ephemeral, and the dev server's frontend runs on another one.
LOOPBACK_HOSTS: Final[frozenset[str]] = frozenset({"127.0.0.1", "localhost", "[::1]"})

_BEARER: Final[str] = "bearer"
_SCHEME = HTTPBearer(auto_error=False, scheme_name="Session token")


def new_session_token() -> str:
    """A fresh session token, generated once per launch."""
    return secrets.token_urlsafe(TOKEN_BYTES)


class SessionToken:
    """The token this process will accept, and the only thing that knows it.

    Held by the application and injected into the dependency, so a test can
    construct a second one and assert that the first refuses it.
    """

    __slots__ = ("_token",)

    def __init__(self, token: str | None = None) -> None:
        self._token = token or new_session_token()

    def __repr__(self) -> str:
        """Never the token: a repr that leaks a credential ends up in a log."""
        return f"SessionToken(len={len(self._token)})"

    def __str__(self) -> str:
        return self.__repr__()

    @property
    def value(self) -> str:
        """The token itself, for the one caller that hands it to the window."""
        return self._token

    def matches(self, presented: str | None) -> bool:
        """Whether ``presented`` is this token, in constant time.

        A missing or non-string token is a refusal rather than an exception,
        because "no credentials" is the common case and an attacker should not
        be able to tell it apart from "wrong credentials".
        """
        if not isinstance(presented, str) or not presented:
            return False
        return hmac.compare_digest(presented, self._token)


def token_dependency(
    session: SessionToken,
) -> Callable[[HTTPAuthorizationCredentials | None], str]:
    """Build the FastAPI dependency that enforces one session's token.

    Returns a dependency rather than being one, because the token is known only
    when the application is created — a module-level dependency would have to
    read a global, and a global credential is the thing this module exists to
    avoid.
    """

    def require(
        credentials: HTTPAuthorizationCredentials | None = Depends(_SCHEME),
    ) -> str:
        presented = credentials.credentials if credentials is not None else None
        if not session.matches(presented):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="this request does not carry this session's token",
                headers={"WWW-Authenticate": _BEARER.capitalize()},
            )
        return presented or ""

    return require


def authorize_websocket(websocket: WebSocket, session: SessionToken) -> str | None:
    """The token of a WebSocket that is allowed to connect, or ``None``.

    Read from the query string because a browser cannot set a header on the
    handshake, and from the subprotocol as a fallback because some clients
    prefer it to putting a credential in a URL that may be logged.
    """
    presented = websocket.query_params.get("token")
    if not presented:
        protocols = [
            item.strip() for item in websocket.headers.get("sec-websocket-protocol", "").split(",")
        ]
        presented = next(
            (
                item.removeprefix("nova-token.")
                for item in protocols
                if item.startswith("nova-token.")
            ),
            None,
        )
    return presented if session.matches(presented) else None


class LoopbackGuard:
    """Accept only requests that name a loopback host, and say so when they do not.

    Args:
        allowed_hosts: The hostnames a `Host` header may carry. Defaults to the
            loopback set. A development server adds its own; nothing else should.
        allowed_origins: The origins an `Origin` header may carry. Defaults to
            any port on the allowed hosts, which is what lets the Vite dev
            server on `:5173` talk to the API on an ephemeral port.
    """

    __slots__ = ("_hosts", "_origins")

    def __init__(
        self,
        *,
        allowed_hosts: Iterable[str] | None = None,
        allowed_origins: Iterable[str] | None = None,
    ) -> None:
        # Normalised on the way in, so a caller may name an IPv6 host either as
        # `::1` or as `[::1]` and get the same guard.
        self._hosts = (
            frozenset(_host_of(host) for host in allowed_hosts)
            if allowed_hosts is not None
            else LOOPBACK_HOSTS
        )
        if allowed_origins is not None:
            self._origins = frozenset(allowed_origins)
        else:
            self._origins = frozenset(
                f"{scheme}://{host}" for host in self._hosts for scheme in ("http", "https")
            )

    @property
    def allowed_hosts(self) -> frozenset[str]:
        """The hosts this guard accepts."""
        return self._hosts

    def host_is_allowed(self, host: str | None) -> bool:
        """Whether a `Host` header (which may carry a port) is one of ours."""
        if not host:
            return False
        return _host_of(host) in self._hosts

    def origin_is_allowed(self, origin: str | None) -> bool:
        """Whether an `Origin` header is one of ours.

        An absent `Origin` is allowed: a same-origin fetch from a `file://` or
        a native client sends none, and refusing it would break the very shell
        this guard protects.
        """
        if not origin:
            return True
        split = urlsplit(origin)
        if not split.scheme or not split.hostname:
            return False
        return f"{split.scheme}://{_host_of(split.netloc)}" in self._origins

    def allows(self, host: str | None, origin: str | None = None) -> bool:
        """Whether a request naming this Host and Origin may proceed.

        The single answer both transports use. HTTP middleware is *not* applied
        to a WebSocket handshake, so a guard that lived only in the middleware
        would leave the socket wide open to the very request it exists to
        refuse — which is why the handshake asks this method rather than
        relying on having been through the stack.
        """
        return self.host_is_allowed(host) and self.origin_is_allowed(origin)

    def problem(self, *, host: str | None, origin: str | None = None) -> dict[str, object]:
        """The refusal body, naming which of the two checks failed."""
        return {
            "code": "NS-TRANSPORT-4030",
            "title": "Origin not allowed",
            "status": status.HTTP_403_FORBIDDEN,
            "detail": (
                "this request names a host or origin that is not this session's loopback address"
            ),
            "domain": ErrorDomain.TRANSPORT.value,
            "severity": "error",
            "retryable": False,
            "extensions": {"host": host, "origin": origin},
        }

    def as_middleware(
        self,
    ) -> Callable[[StarletteRequest, RequestResponseEndpoint], Awaitable[Response]]:
        """Build the ASGI middleware that applies this guard to HTTP requests.

        Built as a factory rather than installed directly so the guard — which
        is a plain, testable object with no framework in it — can be unit-tested
        without a running application.
        """

        async def guard(request: StarletteRequest, call_next: RequestResponseEndpoint) -> Response:
            host = request.headers.get("host")
            origin = request.headers.get("origin")
            if not self.allows(host, origin):
                return JSONResponse(
                    status_code=status.HTTP_403_FORBIDDEN,
                    content=self.problem(host=host, origin=origin),
                    media_type=PROBLEM_MEDIA_TYPE,
                )
            return await call_next(request)

        return guard


def _host_of(netloc: str) -> str:
    """The hostname part of a `Host` or `Origin` authority, canonicalised.

    A port is stripped, so `[::1]:8000` and `127.0.0.1:8765` compare equal to
    their bare forms — the port is not part of the identity being checked, and
    pinning it would break the dev server and every ephemeral port.

    An IPv6 literal is returned **with** its brackets whether it arrived with
    them or not. That is the part worth being careful about: a bare `::1` is
    ambiguous with `host:port` under any naive split, and splitting it on the
    last colon yields `::` — a host nobody is, and a refusal nobody expects.
    """
    host = netloc.rsplit("@", 1)[-1]
    if host.startswith("["):
        return host.split("]", 1)[0].lower() + "]"
    if host.count(":") > 1:
        # More than one colon and no brackets: an IPv6 address, not a port.
        return f"[{host.lower()}]"
    return host.rsplit(":", 1)[0].lower() if ":" in host else host.lower()
