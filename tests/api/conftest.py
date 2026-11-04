"""Shared fixtures for the API tests.

Two facts about Starlette's `TestClient` shape everything here, and both are
worth knowing before a test that mysteriously 403s costs somebody an hour:

* The client's `base_url` becomes the `Host` header of an HTTP request, so a
  client built without one sends `Host: testserver` — a name the loopback guard
  refuses, correctly, because it is not a loopback address.
* The client does **not** derive a WebSocket handshake's `Host` from its
  `base_url`; every handshake arrives as `testserver` unless the test passes the
  header itself. `WS_HEADERS` exists for that, and is passed by
  :func:`socket_for`.

The data directory is redirected to `tmp_path` for every test, because a session
state resolves one at construction and a test that wrote into the user's real
data directory would be the kind of test nobody can run twice.
"""

from __future__ import annotations

from contextlib import contextmanager
from typing import TYPE_CHECKING, Any

import pytest
from fastapi.testclient import TestClient

from nova_studio import __version__
from nova_studio.api.app import ApiSettings, create_app
from nova_studio.api.state import new_session_state
from nova_studio.core.events import EventBus

if TYPE_CHECKING:
    from collections.abc import Iterator
    from pathlib import Path

    from fastapi import FastAPI

    from nova_studio.api.state import SessionState

pytestmark = pytest.mark.unit

#: The address this session pretends to be bound to.
HOST: str = "127.0.0.1"
PORT: int = 8765
BASE_URL: str = f"http://{HOST}:{PORT}"

#: What every WebSocket handshake needs, because `TestClient` cannot infer it.
WS_HEADERS: dict[str, str] = {"Host": f"{HOST}:{PORT}"}


@pytest.fixture(autouse=True)
def isolated_data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Point the data directory at a temporary one for the length of a test."""
    monkeypatch.setenv("NOVA_DATA_DIR", str(tmp_path))
    return tmp_path


@pytest.fixture
def bus() -> Iterator[EventBus]:
    """A bus with a short history and no worker thread, shut down afterwards."""
    event_bus: EventBus = EventBus(history_size=32, autostart=False)
    yield event_bus
    if event_bus.is_running:
        event_bus.shutdown()


@pytest.fixture
def session(bus: EventBus) -> SessionState:
    """A session state for the bus, bound to the address the client uses."""
    return new_session_state(bus, host=HOST, port=PORT, app_version=__version__)


def build_app(bus: EventBus, session: SessionState, **overrides: Any) -> FastAPI:
    """Create an application, with any `ApiSettings` field overridden."""
    return create_app(bus, session=session, settings=ApiSettings(**overrides))


@pytest.fixture
def app(bus: EventBus, session: SessionState) -> FastAPI:
    """The application under test, with default desktop settings."""
    return build_app(bus, session)


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    """A client whose `Host` header the guard will accept."""
    with TestClient(app, base_url=BASE_URL) as test_client:
        yield test_client


@pytest.fixture
def token(session: SessionState) -> str:
    """This session's token, as the window would have been given it."""
    return session.token.value


@pytest.fixture
def auth(token: str) -> dict[str, str]:
    """The `Authorization` header a correctly authenticated request carries."""
    return {"Authorization": f"Bearer {token}"}


@contextmanager
def client_for(app: FastAPI) -> Iterator[TestClient]:
    """A client for an application built by the test, with the right `Host`."""
    with TestClient(app, base_url=BASE_URL) as test_client:
        yield test_client


def socket_url(token: str) -> str:
    """The WebSocket URL carrying a token, as a browser client must use."""
    return f"/api/v1/ws?token={token}"


def socket_for(client: TestClient, token: str, **kwargs: Any) -> Any:
    """Open a WebSocket, supplying the `Host` header `TestClient` cannot infer."""
    headers = {**WS_HEADERS, **kwargs.pop("headers", {})}
    return client.websocket_connect(socket_url(token), headers=headers, **kwargs)
