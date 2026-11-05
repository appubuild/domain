"""L4 — dependencies: how a handler gets hold of the session's own objects.

These exist so that "where does a handler get the workspace" has exactly one
answer, and so that the answer is *the application's* object rather than a
captured closure or a module global. Reading from `app.state` at request time
rather than capturing at import time is what lets a test build a second
application and have its handlers see the second one's workspace.

`Request` is imported at runtime, for the reason written out in `state.py`:
FastAPI resolves a dependency's annotations to decide what each parameter *is*,
and one that exists only for mypy under `from __future__ import annotations` is
not a request — it is a query parameter, and the endpoint then 422s with
"request: field required", which reads like nonsense until you know this.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import Request  # noqa: TC002 — runtime import, see the module docstring

if TYPE_CHECKING:
    from nova_studio.api.state import SessionState
    from nova_studio.api.workspace import ProjectWorkspace

__all__ = ["session_state", "workspace"]


def session_state(request: Request) -> SessionState:
    """The session this application was created with."""
    state: SessionState = request.app.state.session
    return state


def workspace(request: Request) -> ProjectWorkspace:
    """The projects this session has open."""
    projects: ProjectWorkspace = request.app.state.workspace
    return projects
