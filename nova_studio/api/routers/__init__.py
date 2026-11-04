"""L4 — routers: one module per resource, no logic in any of them.

A router is a translation layer and nothing else. It validates input into a DTO,
calls exactly one service method, and maps the `Result` it gets back onto a
response through :func:`nova_studio.api.errors.respond`. A handler that grew
past roughly twenty-five lines is a use case that has leaked out of `services`
and into the transport — and the reason that matters is not tidiness: logic in a
router is logic no other client can reach, and this application has two clients
(the desktop window and the browser dev server) plus every test that drives the
HTTP contract.

Routers are grouped under `/api/v1` because the contract is versioned. The
frontend generates its client from the OpenAPI document, so a version in the
path is the difference between "the UI fails to compile against a breaking
change" and "the UI silently renders yesterday's shape".
"""

from __future__ import annotations

from nova_studio.api.routers import events, system

__all__ = ["events", "system"]
