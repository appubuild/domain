"""L4 — wire DTOs: the shape of everything that crosses the HTTP boundary.

These models are the **contract**. The OpenAPI document generated from them is
what the typed frontend client is generated from, which means a change here is a
change to the frontend's compile-time guarantees: rename a field and the UI
fails to build rather than rendering `undefined` on a Tuesday.

Rules for anything added here:

1. **A DTO is not an entity.** A `Clip` in the domain has invariants, behaviour
   and a life of its own; a clip on the wire is the fields the UI needs, at this
   moment. Translating between them is `mappers/`, and the translation is
   explicit so that adding a domain field does not silently widen the contract.
2. **Every field is documented**, because these docstrings *are* the generated
   client's documentation and the OpenAPI description. An undocumented wire field
   is a field a frontend developer will guess about.
3. **No domain imports.** A DTO that imported a domain type would drag the
   domain into the transport and make the contract unversionable.
4. **Strict by default.** Extra keys are rejected: a client sending a field we
   do not know is either newer than we are or broken, and silently dropping it
   is how two versions of an editor disagree about what was saved.
"""

from __future__ import annotations

from nova_studio.api.schemas.system import (
    CapabilitiesResponse,
    ComponentStatus,
    HealthResponse,
    SystemInfoResponse,
)

__all__ = [
    "CapabilitiesResponse",
    "ComponentStatus",
    "HealthResponse",
    "SystemInfoResponse",
]
