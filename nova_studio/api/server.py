"""L4 — running the service: an ephemeral port, and a token nobody guesses.

ADR-0005 §1 decides the port is chosen at startup and never fixed, because a
fixed port collides with other software and forbids a second instance — and
"open this project in a new window" is a normal thing to want. That decision has
a consequence this module exists to absorb: **somebody has to learn the port
after it has been chosen**, and learn it from the process that chose it rather
than from a file two instances would race over.

So the server is started in-process, on the shell's own event loop, and the
moment it is listening it can say which port it got:

    async with serve(app) as running:
        print(running.endpoint.url)   # http://127.0.0.1:51317
        print(running.endpoint.token) # handed to the window, once

Two details earn their place:

* **The port is read from the bound socket, not from a guess.** Binding to port
  zero and then binding again to "the port that was free a moment ago" is a race
  with every other process on the machine; asking the socket that is already
  listening is not.
* **The endpoint is derived from the application's own session.** The token in
  `endpoint` is the one `app.state.session` holds, so a shell cannot announce a
  token the service will not accept, and the day the session gains a second
  credential this file has one place to change.

Nothing here is needed by the ASGI application itself, which is why it is a
separate module: `create_app` stays importable and testable without uvicorn.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

import uvicorn

if TYPE_CHECKING:
    from collections.abc import AsyncIterator
    from pathlib import Path

    from fastapi import FastAPI

__all__ = ["RunningServer", "SessionEndpoint", "read_endpoint_file", "serve", "write_endpoint_file"]

#: The host a desktop session binds to. Not negotiable: the guard rejects
#: anything else, and binding wider would put the service on the network.
LOOPBACK_HOST: str = "127.0.0.1"


@dataclass(frozen=True, slots=True)
class SessionEndpoint:
    """Where one running session can be reached, and the credential it wants.

    Attributes:
        host: The host the server is bound to.
        port: The port the operating system chose.
        token: This session's bearer token.
    """

    host: str
    port: int
    token: str

    @property
    def url(self) -> str:
        """The base URL, for the REST client."""
        return f"http://{self.host}:{self.port}"

    @property
    def websocket_url(self) -> str:
        """The WebSocket URL, with the token a browser is required to carry."""
        return f"ws://{self.host}:{self.port}/api/v1/ws?token={self.token}"

    def as_json(self) -> str:
        """The endpoint as one JSON line, for a file or a pipe."""
        return json.dumps({"url": self.url, "ws": self.websocket_url, "token": self.token})

    def __repr__(self) -> str:
        """Never the token: a repr that leaks a credential ends up in a log."""
        return f"SessionEndpoint(url={self.url!r}, token=<{len(self.token)} chars>)"


class RunningServer:
    """A server that is already listening, and how to stop it.

    Args:
        server: The uvicorn server, started.
        task: The task running it; awaited on shutdown.
        app: The application being served, which owns the session.
    """

    __slots__ = ("_app", "_server", "_task")

    def __init__(self, server: uvicorn.Server, task: asyncio.Task[None], app: FastAPI) -> None:
        self._server = server
        self._task = task
        self._app = app

    @property
    def port(self) -> int:
        """The port the operating system chose, read from the listening socket."""
        socket = self._server.servers[0].sockets[0]
        return int(socket.getsockname()[1])

    @property
    def endpoint(self) -> SessionEndpoint:
        """Where this session is, and the token it will accept.

        Read from the application's own session rather than carried alongside
        it, so the two cannot disagree.
        """
        session = self._app.state.session
        token: str = session.token.value
        host: str = session.host
        return SessionEndpoint(host=host, port=self.port, token=token)

    async def shutdown(self) -> None:
        """Stop serving and wait for the server to finish."""
        self._server.should_exit = True
        with contextlib.suppress(asyncio.CancelledError):
            await self._task


@asynccontextmanager
async def serve(
    app: FastAPI, *, host: str = LOOPBACK_HOST, port: int = 0
) -> AsyncIterator[RunningServer]:
    """Run an application on loopback until the context exits.

    Args:
        app: The application to serve.
        host: The host to bind to; loopback by default, and the guard accepts
            nothing else.
        port: The port to bind. `0` — the default, and what a desktop session
            wants — asks the operating system to choose a free one.

    Yields:
        A :class:`RunningServer` that is already listening, whose `port` and
        `endpoint` are therefore known.

    Raises:
        RuntimeError: If the server did not come up.
    """
    config = uvicorn.Config(
        app,
        host=host,
        port=port,
        # A desktop application's console belongs to nobody: an access log line
        # per scrub request would be the loudest thing in the process.
        access_log=False,
        log_level="warning",
    )
    server = uvicorn.Server(config)
    task = asyncio.create_task(server.serve(), name="nova-studio-server")
    try:
        while not server.started:
            if task.done():
                # `serve()` swallowed the failure and returned; surface it.
                task.result()
                raise RuntimeError("the server stopped before it started listening")
            await asyncio.sleep(0)
        yield RunningServer(server, task, app)
    finally:
        server.should_exit = True
        with contextlib.suppress(asyncio.CancelledError):
            await task


def write_endpoint_file(path: Path, endpoint: SessionEndpoint) -> None:
    """Write an endpoint to a file only this user can read.

    A second instance writing the same path is a race, so a shell that expects
    two windows gives each its own file; the point of the file is to hand the
    endpoint to a process that cannot receive a Python object.
    """
    # 0600, opened with the mode rather than set afterwards: for the moment the
    # file exists with a wider mode, another user on this machine can read the
    # token out of it.
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        handle.write(endpoint.as_json())


def read_endpoint_file(path: Path) -> SessionEndpoint:
    """Read an endpoint written by :func:`write_endpoint_file`."""
    body: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    token: str = body["token"]
    url: str = body["url"]
    _, _, authority = url.partition("://")
    host, _, port = authority.partition(":")
    return SessionEndpoint(host=host, port=int(port), token=token)
