"""ADR-0005 §4, as tests: loopback is not a trust boundary.

Everything here is a refusal. That is the point — the transport is the one place
where the failure mode is "somebody else drives the editor", and a refusal that
is merely *usually* right is not worth having. Two defences, and the tests treat
them as independent on purpose:

* The **session token** stops a local process that knows the port.
* The **Host/Origin guard** stops a web page that does not have the token but can
  make the user's browser send a request anyway.

A test that only checked the token would leave the DNS-rebinding case standing,
and a test that only checked the Host header would leave the token decorative,
so both are pinned, and the one endpoint that is deliberately open is pinned too.
"""

from __future__ import annotations

import re
from dataclasses import FrozenInstanceError
from typing import TYPE_CHECKING

import pytest
from starlette.websockets import WebSocketDisconnect

from nova_studio.api.app import create_app
from nova_studio.api.auth import LOOPBACK_HOSTS, LoopbackGuard, SessionToken
from nova_studio.api.errors import PROBLEM_MEDIA_TYPE
from tests.api.conftest import BASE_URL, WS_HEADERS, build_app, client_for, socket_for, socket_url

if TYPE_CHECKING:
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from nova_studio.api.state import SessionState
    from nova_studio.core.events import EventBus

pytestmark = pytest.mark.unit

#: Every authenticated endpoint, so a new one cannot quietly join the app
#: without a test asking whether it needs a token.
PROTECTED_PATHS: tuple[str, ...] = (
    "/api/v1/system/info",
    "/api/v1/system/capabilities",
    "/api/v1/events",
)

WS_POLICY_VIOLATION: int = 1008


class TestTheTokenIsRequiredEverywhere:
    def test_every_api_path_refuses_a_request_with_no_token(self, client: TestClient) -> None:
        for path in PROTECTED_PATHS:
            response = client.get(path)
            assert response.status_code == 401, f"{path} answered without a token"
            assert response.json()["code"] == "NS-TRANSPORT-401"

    def test_a_refusal_is_a_problem_document(self, client: TestClient) -> None:
        response = client.get("/api/v1/system/info")
        assert response.headers["content-type"].startswith(PROBLEM_MEDIA_TYPE)
        body = response.json()
        assert body["title"] == "Not authenticated"
        assert body["domain"] == "TRANSPORT"
        assert body["retryable"] is False
        assert body["instance"] == "/api/v1/system/info"

    def test_a_refusal_says_how_to_authenticate(self, client: TestClient) -> None:
        """RFC 7235: a 401 that does not name the scheme is only half an answer."""
        response = client.get("/api/v1/system/info")
        assert response.headers["www-authenticate"].lower().startswith("bearer")

    @pytest.mark.parametrize(
        "header",
        [
            {"Authorization": "Bearer not-the-token"},
            {"Authorization": "Bearer "},
            {"Authorization": "not-the-token"},
            {"Authorization": "Basic bm92YTpub3Zh"},
        ],
    )
    def test_a_wrong_token_is_refused(self, client: TestClient, header: dict[str, str]) -> None:
        assert client.get("/api/v1/system/info", headers=header).status_code == 401

    def test_a_token_from_another_session_is_refused(
        self, bus: EventBus, client: TestClient
    ) -> None:
        """The second window's token must not open the first window's session."""
        other = SessionToken()
        assert (
            client.get(
                "/api/v1/system/info", headers={"Authorization": f"Bearer {other.value}"}
            ).status_code
            == 401
        )

    def test_one_character_of_difference_is_enough_to_refuse(
        self, client: TestClient, token: str
    ) -> None:
        for near_miss in (token[:-1], token + "a", token.upper(), token[1:]):
            response = client.get(
                "/api/v1/system/info", headers={"Authorization": f"Bearer {near_miss}"}
            )
            assert response.status_code == 401, "a near-miss token was accepted"

    def test_the_right_token_is_accepted(self, client: TestClient, auth: dict[str, str]) -> None:
        assert client.get("/api/v1/system/info", headers=auth).status_code == 200


class TestTheTokenIsNotLeaked:
    def test_its_repr_is_a_length(self, session: SessionState) -> None:
        assert session.token.value not in repr(session.token)
        assert repr(session.token) == f"SessionToken(len={len(session.token.value)})"

    def test_health_does_not_carry_it(self, client: TestClient, token: str) -> None:
        assert token not in client.get("/healthz").text

    def test_the_openapi_schema_does_not_carry_it(self, client: TestClient, token: str) -> None:
        """A schema is published; a credential in a published schema is a leak."""
        assert token not in client.get("/openapi.json").text

    def test_it_is_long_enough_to_be_unguessable(self, token: str) -> None:
        """256 bits of entropy, base64url: not fewer than 43 characters."""
        assert len(token) >= 43


class TestHealthIsDeliberatelyOpen:
    """The one exception, and the reason it is safe."""

    def test_it_answers_without_a_token(self, client: TestClient) -> None:
        assert client.get("/healthz").status_code == 200

    def test_it_discloses_nothing_but_aliveness(self, client: TestClient) -> None:
        assert set(client.get("/healthz").json()) == {"status", "version", "pid"}

    def test_it_is_still_behind_the_guard(self, client: TestClient) -> None:
        response = client.get("/healthz", headers={"Host": "evil.example"})
        assert response.status_code == 403
        assert response.json()["code"] == "NS-TRANSPORT-4030"


class TestTheGuardItself:
    """`LoopbackGuard` is a plain object with no framework in it, so it can be
    tested without a running application — which is why it is one."""

    @pytest.mark.parametrize(
        "host", ["127.0.0.1", "127.0.0.1:8765", "localhost:5173", "[::1]:8000", "::1"]
    )
    def test_loopback_hosts_are_allowed(self, host: str) -> None:
        assert LoopbackGuard().host_is_allowed(host)

    @pytest.mark.parametrize(
        "host",
        ["evil.example", "127.0.0.1.evil.example", "evil.example:8765", "", None],
    )
    def test_anything_else_is_not(self, host: str | None) -> None:
        assert not LoopbackGuard().host_is_allowed(host)

    def test_a_missing_host_is_refused(self) -> None:
        """HTTP/1.0 and a hand-written request both arrive without one."""
        assert not LoopbackGuard().host_is_allowed(None)

    @pytest.mark.parametrize(
        "origin", ["http://localhost:5173", "http://127.0.0.1:8765", "https://[::1]"]
    )
    def test_loopback_origins_are_allowed(self, origin: str) -> None:
        assert LoopbackGuard().origin_is_allowed(origin)

    @pytest.mark.parametrize(
        "origin", ["https://evil.example", "http://evil.example:5173", "not-a-url"]
    )
    def test_a_foreign_origin_is_not(self, origin: str) -> None:
        assert not LoopbackGuard().origin_is_allowed(origin)

    def test_an_absent_origin_is_allowed(self) -> None:
        """A native client and a same-origin `file://` fetch send none."""
        assert LoopbackGuard().origin_is_allowed(None)

    def test_allows_requires_both(self) -> None:
        guard = LoopbackGuard()
        assert guard.allows("127.0.0.1:8765", "http://localhost:5173")
        assert not guard.allows("evil.example", "http://localhost:5173")
        assert not guard.allows("127.0.0.1:8765", "https://evil.example")

    def test_the_refusal_names_which_check_failed(self) -> None:
        problem = LoopbackGuard().problem(host="evil.example", origin="https://evil.example")
        assert problem["code"] == "NS-TRANSPORT-4030"
        assert problem["status"] == 403
        assert problem["extensions"] == {"host": "evil.example", "origin": "https://evil.example"}

    def test_the_loopback_set_is_closed(self) -> None:
        assert frozenset({"127.0.0.1", "localhost", "[::1]"}) == LOOPBACK_HOSTS

    def test_a_dev_server_can_name_its_own_hosts(self) -> None:
        guard = LoopbackGuard(allowed_hosts=("127.0.0.1", "dev.local"))
        assert guard.host_is_allowed("dev.local:5173")
        assert not guard.host_is_allowed("localhost")


class TestTheGuardOnTheWire:
    """The same rules, exercised through a real request rather than a method call."""

    def test_a_foreign_host_is_refused(self, client: TestClient, auth: dict[str, str]) -> None:
        response = client.get("/api/v1/system/info", headers={**auth, "Host": "evil.example"})
        assert response.status_code == 403
        assert response.json()["code"] == "NS-TRANSPORT-4030"

    def test_a_foreign_origin_is_refused(self, client: TestClient, auth: dict[str, str]) -> None:
        headers = {**auth, "Host": "127.0.0.1:8765", "Origin": "https://evil.example"}
        assert client.get("/api/v1/system/info", headers=headers).status_code == 403

    def test_the_dev_server_origin_is_allowed(
        self, client: TestClient, auth: dict[str, str]
    ) -> None:
        """`make dev` is a supported configuration, not a hole."""
        headers = {**auth, "Origin": "http://localhost:5173"}
        assert client.get("/api/v1/system/info", headers=headers).status_code == 200

    def test_a_request_with_no_origin_is_allowed(
        self, client: TestClient, auth: dict[str, str]
    ) -> None:
        assert client.get("/api/v1/system/info", headers=auth).status_code == 200

    def test_the_refusal_arrives_before_the_token_is_considered(self, client: TestClient) -> None:
        """An unauthenticated foreign request is refused as foreign, not as unauthenticated:
        it tells an operator what is actually wrong."""
        response = client.get("/api/v1/system/info", headers={"Host": "evil.example"})
        assert response.status_code == 403


class TestTheWebSocketHandshake:
    """A socket is a resource. It must not be handed to a caller who has not
    been checked, even for the moment between accept and refuse."""

    def test_a_token_in_the_query_string_is_accepted(self, client: TestClient, token: str) -> None:
        with socket_for(client, token) as socket:
            assert socket.receive_json()["type"] == "hello"

    def test_a_token_in_a_subprotocol_is_accepted(self, client: TestClient, token: str) -> None:
        """Some clients will not put a credential in a URL that a proxy may log."""
        with client.websocket_connect(
            "/api/v1/ws", headers=WS_HEADERS, subprotocols=[f"nova-token.{token}"]
        ) as socket:
            assert socket.receive_json()["type"] == "hello"

    def test_no_token_is_refused_before_accept(self, client: TestClient) -> None:
        with (
            pytest.raises(WebSocketDisconnect) as raised,
            client.websocket_connect("/api/v1/ws", headers=WS_HEADERS),
        ):
            pytest.fail("an unauthenticated caller was given a socket")
        assert raised.value.code == WS_POLICY_VIOLATION

    def test_a_wrong_token_is_refused(self, client: TestClient) -> None:
        with (
            pytest.raises(WebSocketDisconnect) as raised,
            client.websocket_connect(socket_url("not-the-token"), headers=WS_HEADERS),
        ):
            pytest.fail("a caller with the wrong token was given a socket")
        assert raised.value.code == WS_POLICY_VIOLATION

    def test_a_foreign_host_is_refused(self, client: TestClient, token: str) -> None:
        """HTTP middleware does not run for a handshake, so the socket asks the
        guard itself — this is the test that would fail if it did not."""
        with (
            pytest.raises(WebSocketDisconnect) as raised,
            client.websocket_connect(socket_url(token), headers={"Host": "evil.example"}),
        ):
            pytest.fail("a foreign handshake was accepted")
        assert raised.value.code == WS_POLICY_VIOLATION

    def test_a_foreign_origin_is_refused(self, client: TestClient, token: str) -> None:
        headers = {**WS_HEADERS, "Origin": "https://evil.example"}
        with (
            pytest.raises(WebSocketDisconnect),
            client.websocket_connect(socket_url(token), headers=headers),
        ):
            pytest.fail("a foreign handshake was accepted")


class TestTwoSessionsDoNotShareState:
    """The reason the session is a value and not a module global."""

    def test_two_apps_in_one_process_have_different_tokens(self, bus: EventBus) -> None:
        first = create_app(bus)
        second = create_app(bus)
        assert first.state.session.token.value != second.state.session.token.value

    def test_the_first_token_does_not_open_the_second(self, bus: EventBus) -> None:
        first = create_app(bus)
        second = create_app(bus)
        with client_for(second) as client:
            headers = {"Authorization": f"Bearer {first.state.session.token.value}"}
            assert client.get("/api/v1/system/info", headers=headers).status_code == 401

    def test_a_session_state_is_not_writable(self, session: SessionState) -> None:
        """A handler that could rebind it would change the next request too."""
        with pytest.raises(FrozenInstanceError):
            session.host = "0.0.0.0"  # type: ignore[misc]

    def test_the_address_it_reports_is_its_own(self, session: SessionState) -> None:
        assert session.origin == BASE_URL


class TestTheDocsAreSwitchable:
    def test_they_are_served_in_development(self, client: TestClient) -> None:
        assert client.get("/openapi.json").status_code == 200
        assert client.get("/docs").status_code == 200

    def test_they_are_not_served_in_a_packaged_build(
        self, bus: EventBus, session: SessionState
    ) -> None:
        app: FastAPI = build_app(bus, session, docs=False)
        with client_for(app) as client:
            assert client.get("/openapi.json").status_code == 404
            assert client.get("/docs").status_code == 404

    def test_the_version_is_reported(self, client: TestClient) -> None:
        from nova_studio import __version__

        assert client.get("/openapi.json").json()["info"]["version"] == __version__

    def test_paths_in_the_schema_are_versioned(self, client: TestClient) -> None:
        paths = client.get("/openapi.json").json()["paths"]
        assert all(re.match(r"^/(api/v1|healthz)", path) for path in paths)
