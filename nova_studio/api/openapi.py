"""L4 — the contract, generated from the routes that actually run.

ADR-0005 names `docs/architecture/api-contract` as the one documented, versioned
contract between the frontend and the backend. A contract written by hand next to
the code that implements it is a second copy, and the second copy is the one that
is wrong — so this module generates it from the application instead, and the
frontend's client is generated from the result.

The application is built with a bus that is never started, because generating a
schema needs a constructed app and nothing else: no port, no server, no data
directory touched.
"""

from __future__ import annotations

import json
from typing import Any

from nova_studio.api.app import create_app
from nova_studio.api.errors import PROBLEM_MEDIA_TYPE
from nova_studio.api.schemas.problem import ProblemResponse
from nova_studio.core.events import EventBus

__all__ = ["contract", "contract_json"]

#: The `$ref` the generated schema uses for the problem body.
_PROBLEM_REF: str = f"#/components/schemas/{ProblemResponse.__name__}"


def contract() -> dict[str, object]:
    """The OpenAPI document for the service, as a dictionary.

    Returns:
        The schema FastAPI derives from the routes, which is the same object
        `/openapi.json` serves at runtime — so what the frontend generates
        against is what the server answers.
    """
    app = create_app(EventBus(autostart=False))
    document: dict[str, Any] = app.openapi()
    _correct_problem_media_types(document)
    return document


def _correct_problem_media_types(document: dict[str, Any]) -> None:
    """Say `application/problem+json` where the service actually sends it.

    FastAPI documents an extra response as `application/json` no matter what the
    handler returns. Left alone, the frontend's generated client would type every
    failure as JSON and parse `code` out of a body it had been told not to expect
    — the exact two-shapes drift `api/errors.py` exists to prevent. Corrected
    here rather than per route so there is one place to look when it is wrong.
    """
    for path in document.get("paths", {}).values():
        for operation in path.values():
            if not isinstance(operation, dict):
                continue
            for response in operation.get("responses", {}).values():
                content = response.get("content", {})
                body = content.get("application/json")
                if isinstance(body, dict) and body.get("schema", {}).get("$ref") == _PROBLEM_REF:
                    content.pop("application/json")
                    content[PROBLEM_MEDIA_TYPE] = body


def contract_json() -> str:
    """The contract as indented, stable JSON with a trailing newline.

    Stable — sorted keys, two-space indent, no trailing whitespace — so that a
    diff between two commits is a diff between two contracts rather than a
    diff between two dict orderings.
    """
    return json.dumps(contract(), indent=2, sort_keys=True, ensure_ascii=False) + "\n"
