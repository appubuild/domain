"""`api/errors.py` — the one place a `Result` becomes an HTTP response.

What is being pinned is the claim in that module's docstring: **every error the
frontend can see has one shape**. A 404 raised by the framework, a 422 from a
query string, a domain refusal carried in a `Result`, and a genuine bug all have
to look like answers from the same application, because a client with two error
shapes will eventually parse one of them wrong — and the wrong one is always the
rare one.

The status comes from `ErrorSeverity`, not from a router's mood. That mapping is
also pinned, because it is what decides whether the user sees a toast or a
blocking banner.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from nova_studio.api.errors import (
    PROBLEM_MEDIA_TYPE,
    install_error_handlers,
    problem_body,
    problem_response,
    respond,
)
from nova_studio.core.errors import ErrorDomain, ErrorSeverity, NovaError
from nova_studio.core.result import err, ok
from tests.api.conftest import client_for

pytestmark = pytest.mark.unit


def app_raising(exception: Exception) -> FastAPI:
    """The smallest application that can fail in the way under test."""
    app = FastAPI()
    install_error_handlers(app)

    @app.get("/boom")
    async def boom() -> None:
        raise exception

    return app


def client_that_shows_failures(app: FastAPI) -> TestClient:
    """A client that lets the application's own 500 through instead of raising.

    `TestClient` re-raises a server exception after the response has been sent,
    which is what a test usually wants — but here the response *is* the thing
    under test.
    """
    return TestClient(app, base_url="http://127.0.0.1:8765", raise_server_exceptions=False)


class TestTheProblemShape:
    def test_a_problem_keeps_the_rfc_fields_at_the_top_level(self) -> None:
        error = NovaError("NS-TEST-4001", "it did not work", domain=ErrorDomain.PROJECT)
        body = problem_body(error.to_problem(instance="/api/v1/x"))
        assert body["type"] == "https://nova.studio/errors/NS-TEST-4001"
        assert body["title"] == "Project error"
        assert body["detail"] == "it did not work"
        assert body["instance"] == "/api/v1/x"
        assert body["code"] == "NS-TEST-4001"
        assert body["domain"] == "PROJECT"
        assert body["retryable"] is False

    def test_extensions_are_spread_rather_than_nested(self) -> None:
        """A client reads `body["clip_id"]`, not `body["extensions"]["clip_id"]`,
        and the extra hop is where a code usually gets lost."""
        error = NovaError("NS-TEST-4002", "no", details={"clip_id": "c1"})
        assert problem_body(error.to_problem())["clip_id"] == "c1"

    def test_an_absent_optional_field_is_omitted(self) -> None:
        """A field that is sometimes null is a field the client has to handle twice."""
        body = problem_body(NovaError("NS-TEST-4003", "no").to_problem())
        assert "remedy" not in body
        assert "cause" not in body
        assert "instance" not in body

    def test_a_remedy_is_carried(self) -> None:
        error = NovaError("NS-TEST-4004", "no", remedy="try again later", retryable=True)
        body = problem_body(error.to_problem())
        assert body["remedy"] == "try again later"
        assert body["retryable"] is True

    def test_a_response_speaks_problem_json(self) -> None:
        response = problem_response(NovaError("NS-TEST-4005", "no"))
        assert response.media_type == PROBLEM_MEDIA_TYPE


class TestSeverityBecomesStatus:
    @pytest.mark.parametrize(
        ("severity", "status"),
        [
            (ErrorSeverity.DEBUG, 200),
            (ErrorSeverity.INFO, 200),
            (ErrorSeverity.WARNING, 409),
            (ErrorSeverity.ERROR, 422),
            (ErrorSeverity.CRITICAL, 500),
        ],
    )
    def test_the_mapping_is_the_documented_one(self, severity: ErrorSeverity, status: int) -> None:
        """A warning is a toast the UI carries on from; a critical is a banner.

        The mapping itself lives in L1 (`core/errors.py`) so that a failure
        broadcast over the socket — where no HTTP request is involved at all —
        still carries a status the frontend can treat the same way.
        """
        error = NovaError("NS-TEST-4006", "no", severity=severity)
        assert problem_response(error).status_code == status


class TestRespond:
    def test_a_success_is_serialised_by_the_caller(self) -> None:
        response = respond(ok({"a": 1}), to_body=lambda value: value)
        assert response.status_code == 200
        assert response.body == b'{"a":1}'

    def test_a_failure_becomes_a_problem(self) -> None:
        response = respond(err(NovaError("NS-TEST-4007", "no", severity=ErrorSeverity.WARNING)))
        assert response.status_code == 409
        assert response.media_type == PROBLEM_MEDIA_TYPE
        assert b"NS-TEST-4007" in response.body

    def test_a_create_can_say_so(self) -> None:
        response = respond(ok({"id": "1"}), to_body=lambda value: value, status_code=201)
        assert response.status_code == 201

    def test_the_instance_is_echoed(self) -> None:
        response = respond(err(NovaError("NS-TEST-4008", "no")), instance="/api/v1/projects")
        assert b"/api/v1/projects" in response.body


class TestEveryFailureLooksTheSame:
    """Three ways a request can fail here, one body shape."""

    def test_a_404_is_a_problem(self, client: TestClient, auth: dict[str, str]) -> None:
        response = client.get("/api/v1/nothing-here", headers=auth)
        assert response.status_code == 404
        assert response.headers["content-type"].startswith(PROBLEM_MEDIA_TYPE)
        body = response.json()
        assert body["code"] == "NS-TRANSPORT-404"
        assert body["title"] == "Not found"
        assert body["retryable"] is False

    def test_a_validation_failure_names_the_fields(
        self, client: TestClient, auth: dict[str, str]
    ) -> None:
        response = client.get("/api/v1/events?limit=0", headers=auth)
        assert response.status_code == 422
        body = response.json()
        assert body["code"] == "NS-VALIDATION-4220"
        assert body["domain"] == "VALIDATION"
        assert body["severity"] == "warning"
        for field in body["fields"]:
            assert {"field", "message", "kind"} <= set(field)

    def test_a_bug_names_itself(self) -> None:
        """A desktop app fails in front of one user, whose only route to a bug
        report is the message on the screen."""
        with client_that_shows_failures(app_raising(RuntimeError("the disk is on fire"))) as client:
            response = client.get("/boom")
        assert response.status_code == 500
        body = response.json()
        assert body["code"] == "NS-TRANSPORT-5000"
        assert body["severity"] == "critical"
        assert "RuntimeError" in body["detail"]

    def test_a_bug_does_not_leak_a_traceback(self) -> None:
        with client_that_shows_failures(app_raising(RuntimeError("secret internals"))) as client:
            body = client.get("/boom").json()
        assert "Traceback" not in body["detail"]
        assert "test_errors.py" not in body["detail"]

    def test_a_refusal_from_a_service_speaks_the_same_shape(
        self, client: TestClient, auth: dict[str, str]
    ) -> None:
        """The route a service's `Result` takes is the same route a 404 takes,
        and that is the whole point of having one translator."""
        app = FastAPI()
        install_error_handlers(app)

        @app.get("/api/v1/refused")
        async def refused() -> Any:
            return respond(
                err(
                    NovaError(
                        "NS-PROJECT-4001",
                        "written by a newer Nova Studio",
                        domain=ErrorDomain.PROJECT,
                        severity=ErrorSeverity.WARNING,
                        remedy="Update Nova Studio.",
                    )
                ),
                instance="/api/v1/refused",
            )

        with client_for(app) as refused_client:
            from_the_service = refused_client.get("/api/v1/refused").json()
        from_the_framework = client.get("/api/v1/nothing-here", headers=auth).json()
        # The same keys, plus whatever this particular error has to add.
        assert set(from_the_framework) <= set(from_the_service)
        assert {"type", "title", "status", "detail", "code", "domain", "severity"} <= set(
            from_the_service
        )
        assert from_the_service["code"] == "NS-PROJECT-4001"
        assert from_the_service["status"] == 409


class TestTheBodyIsJson:
    """A client that cannot parse the error cannot show the error."""

    def test_every_failure_body_parses(self, client: TestClient, auth: dict[str, str]) -> None:
        for path in ("/api/v1/nothing-here", "/api/v1/events?limit=0"):
            body: Any = client.get(path, headers=auth).json()
            assert isinstance(body, dict)
            assert {"type", "title", "status", "detail", "code"} <= set(body)
