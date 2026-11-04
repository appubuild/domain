"""`api/server.py` — the service, actually running.

Everything else in `tests/api/` drives the application in-process, which is the
right way to test logic and the wrong way to discover that the server cannot
bind, that the port it reports is not the port it is on, or that the token it
announces is not the token it accepts. Those are precisely the failures that
leave a desktop app staring at a black window, so they are tested here against a
real socket, on a real port, with a real HTTP client.

Marked `integration` because a server start costs a few hundred milliseconds —
not because any of this needs machinery the rest of the suite does not have.
"""

from __future__ import annotations

import json
import stat
import subprocess
import sys
import time
from typing import TYPE_CHECKING

import httpx
import pytest

from nova_studio.api.server import (
    SessionEndpoint,
    read_endpoint_file,
    serve,
    write_endpoint_file,
)
from nova_studio.core.events import EventBus

if TYPE_CHECKING:
    from pathlib import Path

    from fastapi import FastAPI

pytestmark = pytest.mark.integration

ENDPOINT = SessionEndpoint(host="127.0.0.1", port=8765, token="t" * 43)


async def test_the_server_chooses_a_port_and_reports_it(app: FastAPI) -> None:
    """The port is read from the listening socket, not from a guess."""
    async with serve(app) as running:
        assert running.port > 0
        assert running.endpoint.url == f"http://127.0.0.1:{running.port}"


async def test_two_instances_get_two_ports(app: FastAPI) -> None:
    """A second window is a normal thing to want, and a fixed port forbids it."""
    from nova_studio.api.app import create_app

    async with serve(app) as first, serve(create_app(EventBus(autostart=False))) as second:
        assert first.port != second.port


async def test_health_answers_over_a_real_socket(app: FastAPI) -> None:
    async with (
        serve(app) as running,
        httpx.AsyncClient(base_url=running.endpoint.url) as client,
    ):
        response = await client.get("/healthz")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


async def test_the_announced_token_is_the_token_accepted(app: FastAPI) -> None:
    """The endpoint is derived from the application's own session, so it cannot
    name a credential the service will refuse."""
    async with serve(app) as running:
        endpoint = running.endpoint
        async with httpx.AsyncClient(base_url=endpoint.url) as client:
            refused = await client.get("/api/v1/system/info")
            accepted = await client.get(
                "/api/v1/system/info", headers={"Authorization": f"Bearer {endpoint.token}"}
            )
    assert refused.status_code == 401
    assert accepted.status_code == 200


async def test_a_foreign_host_is_refused_over_a_real_socket(app: FastAPI) -> None:
    """The guard is middleware, and middleware is only proven by a real request."""
    async with (
        serve(app) as running,
        httpx.AsyncClient(base_url=running.endpoint.url) as client,
    ):
        response = await client.get("/healthz", headers={"Host": "evil.example"})
    assert response.status_code == 403


async def test_stopping_the_server_closes_the_port(app: FastAPI) -> None:
    async with serve(app) as running:
        port = running.port
    async with httpx.AsyncClient() as client:
        with pytest.raises(httpx.ConnectError):
            await client.get(f"http://127.0.0.1:{port}/healthz")


async def test_the_bus_is_shut_down_with_the_server(app: FastAPI, bus: EventBus) -> None:
    """A bus left running holds a thread and a queue; one leaked per window is a
    leak the user pays for."""
    async with serve(app):
        assert bus.is_running
    assert not bus.is_running


class TestTheEndpointFile:
    def test_it_round_trips(self, tmp_path: Path) -> None:
        path = tmp_path / "session.json"
        write_endpoint_file(path, ENDPOINT)
        assert read_endpoint_file(path) == ENDPOINT

    def test_it_is_private(self, tmp_path: Path) -> None:
        path = tmp_path / "session.json"
        write_endpoint_file(path, ENDPOINT)
        mode = stat.S_IMODE(path.stat().st_mode)
        assert mode == 0o600, "a token in a world-readable file is no token at all"

    def test_a_repr_does_not_leak_the_token(self) -> None:
        assert "ttt" not in repr(ENDPOINT)
        assert "ttt" not in str(ENDPOINT)

    def test_the_websocket_url_carries_the_token(self) -> None:
        endpoint = SessionEndpoint(host="127.0.0.1", port=8765, token="tok")
        assert endpoint.websocket_url == "ws://127.0.0.1:8765/api/v1/ws?token=tok"

    def test_the_json_carries_what_a_client_needs(self) -> None:
        body = json.loads(ENDPOINT.as_json())
        assert set(body) == {"url", "ws", "token"}
        assert body["url"] == "http://127.0.0.1:8765"


class TestTheConsoleCommand:
    """`nova-studio serve`, as a parent process would see it."""

    @staticmethod
    def _wait_for_endpoint(path: Path, timeout: float = 60.0) -> SessionEndpoint:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if path.is_file() and path.stat().st_size:
                return read_endpoint_file(path)
            time.sleep(0.05)
        raise AssertionError(f"the service never wrote {path}")

    def test_it_serves_and_stops(self, tmp_path: Path) -> None:
        path = tmp_path / "session.json"
        process = subprocess.Popen(
            [sys.executable, "-m", "nova_studio", "serve", "--endpoint-file", str(path)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        try:
            endpoint = self._wait_for_endpoint(path)
            assert httpx.get(f"{endpoint.url}/healthz", timeout=10.0).status_code == 200
            authenticated = httpx.get(
                f"{endpoint.url}/api/v1/system/info",
                headers={"Authorization": f"Bearer {endpoint.token}"},
                timeout=10.0,
            )
            assert authenticated.status_code == 200
        finally:
            process.terminate()
            process.wait(timeout=60)

    def test_it_documents_itself(self) -> None:
        from nova_studio.cli import main

        with pytest.raises(SystemExit) as raised:
            main(["serve", "--help"])
        assert raised.value.code == 0
