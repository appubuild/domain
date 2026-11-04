"""L4 — the HTTP/WebSocket boundary to the frontend.

The React UI and the Python core run in the same desktop process but communicate
over loopback HTTP and a WebSocket (ADR-0005).  That indirection is deliberate: it
keeps the frontend replaceable, makes the backend testable through its real public
contract, and means a future multi-user or remote-render mode is a transport change
rather than a rewrite.

This ring is a *boundary*, so it is the one place pydantic belongs: request and
response DTOs are validated on the way in and serialised on the way out.  It is
also the only ring that may import ``fastapi`` and ``uvicorn``.

Hard rules, enforced by ``scripts/check_layering.py`` and by review:

1. **No business logic.**  A router validates input, calls exactly one service
   method, and maps the result to a DTO.  A handler longer than about 25 lines is a
   sign that a use case has leaked out of ``services`` and into the transport.
2. **``Result`` becomes HTTP semantics here, and only here.**  ``Ok`` maps to
   ``200``/``201``; ``Err`` maps to an RFC 9457 ``application/problem+json`` body
   via ``NovaError.to_problem()``, with ``ErrorSeverity`` choosing the status code.
   Inner rings never see a status code.
3. **The WebSocket is authoritative-state, not a data firehose.**  Events are
   forwarded with a monotonic ``seq``; a client that detects a gap requests a full
   resync rather than trying to reconstruct what it missed (ADR-0013).
4. **Every request is authenticated with a per-session bearer token** generated at
   launch.  Loopback is not a trust boundary: any local process could otherwise
   drive the editor.

Layout (populated in Stages 4 and 12)::

    app.py         application factory, middleware, lifespan, CORS
    auth.py        session token issue and verification
    routers/       one module per resource: projects, timeline, media, render,
                   captions, export, plugins, system
    schemas/       pydantic DTOs
    mappers/       DTO <-> entity translation, the only place both are named
    ws.py          the WebSocket bridge, event forwarding, seq and resync
    errors.py      NovaError -> ProblemDetail -> HTTP response

The OpenAPI document generated from these routers is the contract the typed
frontend client is generated from, so a schema change here is a change to the
frontend's compile-time guarantees.  That is the point of generating the client
rather than hand-writing it.
"""

from __future__ import annotations
