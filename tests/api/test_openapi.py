"""`api/openapi.py` — the contract is generated, so it can be checked.

ADR-0005 promises one documented, versioned contract instead of an implicit JS
bridge surface. A contract written by hand drifts from the routes within a
month; a contract generated from them cannot, but only if something notices that
the generated file in the repository is stale. This module is that something:

* the committed `docs/architecture/api-contract.json` must equal what the routes
  generate *now*, so a route change that forgets `make openapi` fails the build;
* every path in it is versioned or public, so a new endpoint cannot appear
  outside `/api/v1` by accident;
* every schema field is documented, because the frontend's generated client is
  only as good as the descriptions it can show a developer.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from nova_studio.api.openapi import contract, contract_json

pytestmark = pytest.mark.unit

#: The generated contract, as committed.
CONTRACT_PATH: Path = (
    Path(__file__).resolve().parents[2] / "docs" / "architecture" / "api-contract.json"
)


class TestTheCommittedContract:
    def test_it_matches_the_routes(self) -> None:
        """Run `make openapi` after changing a route. This test is how you find out."""
        assert CONTRACT_PATH.is_file(), f"missing generated contract: {CONTRACT_PATH}"
        committed = CONTRACT_PATH.read_text(encoding="utf-8")
        assert contract_json() == committed, (
            "the committed contract does not match the routes — run `make openapi`"
        )

    def test_it_is_stable_json(self) -> None:
        """Sorted keys and a trailing newline, so a diff is a diff of contracts
        rather than a diff of dict orderings."""
        body = CONTRACT_PATH.read_text(encoding="utf-8")
        assert (
            body
            == json.dumps(json.loads(body), indent=2, sort_keys=True, ensure_ascii=False) + "\n"
        )


class TestTheSchema:
    def test_every_path_is_versioned_or_public(self) -> None:
        paths = contract()["paths"]
        for path in paths:  # type: ignore[union-attr]
            assert path.startswith("/api/v1/") or path == "/healthz", (
                f"{path} is neither versioned nor deliberately public"
            )

    def test_every_schema_field_is_documented(self) -> None:
        schemas = contract()["components"]["schemas"]  # type: ignore[index]
        undocumented = [
            f"{name}.{field}"
            for name, schema in schemas.items()  # type: ignore[union-attr]
            for field in schema.get("properties", {})
            if not schema["properties"][field].get("description")
        ]
        assert undocumented == [], f"undocumented fields: {undocumented}"

    def test_the_service_names_itself(self) -> None:
        info = contract()["info"]  # type: ignore[index]
        assert info["title"] == "Nova Studio"  # type: ignore[index]
        assert info["version"]  # type: ignore[index]

    def test_the_websocket_is_not_in_it(self) -> None:
        """OpenAPI cannot describe a socket; the WS protocol is documented in
        `docs/architecture/adr/ADR-0005-local-http-ws-transport.md` instead."""
        assert "ws" not in json.dumps(contract()["paths"])  # type: ignore[index]
