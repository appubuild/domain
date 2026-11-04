"""`api/routers/system.py` — health, identity, capabilities.

What these tests pin is not the values but the *boundaries* each endpoint exists
to hold:

* Health answers without a token and discloses three fields — no more. It is
  polled in a loop before the shell has a session, and it is the one endpoint a
  stranger on the loopback can reach, so growth here is a security question.
* Identity reports the session's own parameters, because "which of my three
  running instances is this" is a question the answer has to contain.
* Capabilities is probed with `find_spec`, never by importing: a diagnostic that
  has to load OpenCV to say whether OpenCV is installed takes seconds and fails
  on the one machine that needs the answer.
"""

from __future__ import annotations

import importlib.util
import os
import re
from typing import TYPE_CHECKING

import pytest
from pydantic import ValidationError

from nova_studio import __version__
from nova_studio.api.schemas.system import (
    OPTIONAL_COMPONENTS,
    REQUIRED_COMPONENTS,
    HealthResponse,
    probe_components,
)
from nova_studio.infra.persistence.archive import SUPPORTED_FORMAT_VERSION

if TYPE_CHECKING:
    from fastapi.testclient import TestClient

    from nova_studio.api.state import SessionState

pytestmark = pytest.mark.unit

HEALTH_FIELDS: frozenset[str] = frozenset({"status", "version", "pid"})
INFO_FIELDS: frozenset[str] = frozenset(
    {
        "version",
        "project_format_version",
        "python",
        "implementation",
        "platform",
        "frozen",
        "pid",
        "data_dir",
        "host",
        "port",
    }
)


class TestHealth:
    def test_it_reports_ok(self, client: TestClient) -> None:
        assert client.get("/healthz").json()["status"] == "ok"

    def test_it_names_the_version(self, client: TestClient) -> None:
        assert client.get("/healthz").json()["version"] == __version__

    def test_it_names_its_own_process(self, client: TestClient) -> None:
        assert client.get("/healthz").json()["pid"] == os.getpid()

    def test_it_discloses_three_fields_and_no_more(self, client: TestClient) -> None:
        assert set(client.get("/healthz").json()) == HEALTH_FIELDS


class TestSystemInfo:
    def test_it_reports_the_documented_fields(
        self, client: TestClient, auth: dict[str, str]
    ) -> None:
        assert set(client.get("/api/v1/system/info", headers=auth).json()) == INFO_FIELDS

    def test_it_names_the_format_version_this_build_writes(
        self, client: TestClient, auth: dict[str, str]
    ) -> None:
        body = client.get("/api/v1/system/info", headers=auth).json()
        assert body["project_format_version"] == SUPPORTED_FORMAT_VERSION

    def test_it_names_the_python_it_is_running(
        self, client: TestClient, auth: dict[str, str]
    ) -> None:
        body = client.get("/api/v1/system/info", headers=auth).json()
        assert re.match(r"^\d+\.\d+\.\d+", body["python"])
        assert body["implementation"]

    def test_it_names_the_platform(self, client: TestClient, auth: dict[str, str]) -> None:
        assert client.get("/api/v1/system/info", headers=auth).json()["platform"]

    def test_a_source_run_is_not_frozen(self, client: TestClient, auth: dict[str, str]) -> None:
        """A packaged build sets `sys.frozen`; a test running from source does not."""
        assert client.get("/api/v1/system/info", headers=auth).json()["frozen"] is False

    def test_it_names_the_data_directory_it_writes(
        self, client: TestClient, auth: dict[str, str], isolated_data_dir: object
    ) -> None:
        body = client.get("/api/v1/system/info", headers=auth).json()
        assert body["data_dir"] == str(isolated_data_dir)

    def test_it_names_the_address_this_session_bound(
        self, client: TestClient, auth: dict[str, str]
    ) -> None:
        """Two instances differ in exactly this, which is why it is reported."""
        body = client.get("/api/v1/system/info", headers=auth).json()
        assert body["host"] == "127.0.0.1"
        assert body["port"] == 8765

    def test_the_address_agrees_with_the_session_value(
        self, client: TestClient, auth: dict[str, str], session: SessionState
    ) -> None:
        body = client.get("/api/v1/system/info", headers=auth).json()
        assert (body["host"], body["port"]) == (session.host, session.port)


class TestCapabilities:
    def test_every_optional_component_is_reported(
        self, client: TestClient, auth: dict[str, str]
    ) -> None:
        body = client.get("/api/v1/system/capabilities", headers=auth).json()
        assert {item["name"] for item in body["components"]} == {
            name for name, _extra, _purpose in OPTIONAL_COMPONENTS
        }

    def test_a_component_carries_the_extra_that_installs_it(
        self, client: TestClient, auth: dict[str, str]
    ) -> None:
        body = client.get("/api/v1/system/capabilities", headers=auth).json()
        for item in body["components"]:
            assert item["extra"], f"{item['name']} names no dependency group"
            assert item["purpose"], f"{item['name']} says nothing about what it is for"

    def test_usable_agrees_with_missing(self, client: TestClient, auth: dict[str, str]) -> None:
        body = client.get("/api/v1/system/capabilities", headers=auth).json()
        assert body["usable"] is (body["missing_required"] == [])

    def test_the_required_components_are_probed(
        self, client: TestClient, auth: dict[str, str]
    ) -> None:
        body = client.get("/api/v1/system/capabilities", headers=auth).json()
        assert {item["name"] for item in body["components"]} >= REQUIRED_COMPONENTS

    def test_a_machine_missing_a_requirement_says_so(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """The answer has to be right on the broken machine, not just this one."""
        real_find_spec = importlib.util.find_spec

        def find_spec(name: str, *args: object, **kwargs: object) -> object:
            return None if name in REQUIRED_COMPONENTS else real_find_spec(name, *args, **kwargs)

        monkeypatch.setattr(importlib.util, "find_spec", find_spec)
        caps = probe_components()
        assert caps.usable is False
        assert set(caps.missing_required) == REQUIRED_COMPONENTS

    def test_probing_never_imports_the_probed_module(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Importing OpenCV to report whether OpenCV is installed is the one
        thing a capability probe must not do."""
        imported: list[str] = []
        real_import = __import__

        def spy(name: str, *args: object, **kwargs: object) -> object:
            imported.append(name)
            return real_import(name, *args, **kwargs)

        monkeypatch.setattr("builtins.__import__", spy)
        probe_components()
        assert not [name for name in imported if name in {n for n, _e, _p in OPTIONAL_COMPONENTS}]


class TestTheDtoContract:
    """`schemas/__init__.py` states four rules; these are the mechanical ones."""

    def test_an_unknown_field_is_refused(self) -> None:
        with pytest.raises(ValidationError):
            HealthResponse(status="ok", version="1.0.0", pid=1, extra="nope")  # type: ignore[call-arg]

    def test_a_dto_is_frozen(self) -> None:
        health = HealthResponse(status="ok", version="1.0.0", pid=1)
        with pytest.raises(ValidationError):
            health.pid = 2  # type: ignore[misc]

    def test_every_field_is_documented(self) -> None:
        for name, field in HealthResponse.model_fields.items():
            assert field.description, f"{name} has no description"
