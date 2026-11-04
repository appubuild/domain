"""L4 — the system DTOs: health, identity and what this machine can do.

The first three things a desktop shell asks when it starts, and they are worth
separating because they are read at different times and fail differently:

* **Health** is asked *before* the window exists, in a loop, until the answer is
  yes. It must therefore be cheap, unauthenticated and incapable of failing for
  an interesting reason — a health check that can report "unhealthy because the
  project store is broken" is a readiness probe that has turned into a
  diagnostic.
* **Identity** (`SystemInfoResponse`) is what the shell puts in the window title
  and the About box, and what a bug report attaches. It includes the session's
  own parameters — where the data directory is, which port and host this session
  bound — because "which of my three running instances is this" is a question
  the answer has to contain.
* **Capabilities** answers "can this machine do the thing the user just clicked",
  and is probed with `find_spec` rather than by importing: a diagnostic that has
  to load OpenCV to say whether OpenCV is installed takes seconds and fails on a
  broken install, which is the one moment you need it to work.
"""

from __future__ import annotations

import importlib.util
import platform
import sys
from typing import Final

from pydantic import BaseModel, ConfigDict, Field

__all__ = [
    "OPTIONAL_COMPONENTS",
    "REQUIRED_COMPONENTS",
    "CapabilitiesResponse",
    "ComponentStatus",
    "HealthResponse",
    "SystemInfoResponse",
]

#: Optional components, with the extra that installs each and why it matters.
OPTIONAL_COMPONENTS: Final[tuple[tuple[str, str, str], ...]] = (
    ("av", "base", "PyAV — media decode and encode"),
    ("cv2", "base", "OpenCV — frame operations and colour conversion"),
    ("numpy", "base", "NumPy — frame buffer representation"),
    ("PIL", "base", "Pillow — image I/O and text rasterisation"),
    ("imageio_ffmpeg", "base", "Bundled FFmpeg locator"),
    ("webview", "desktop", "pywebview — desktop window shell"),
    ("faster_whisper", "asr", "faster-whisper — speech recognition"),
    ("ctranslate2", "asr", "CTranslate2 — inference runtime for whisper models"),
    ("onnxruntime", "asr", "ONNX Runtime — VAD and alignment models"),
)

#: Components without which the application cannot run at all.
REQUIRED_COMPONENTS: Final[frozenset[str]] = frozenset({"numpy", "av"})


class _Strict(BaseModel):
    """The base every DTO gets: strict, frozen, and self-documenting.

    ``extra="forbid"`` is the strictness rule from the package docstring, made
    mechanical: a client sending a field we do not know is either newer than we
    are or broken, and silently dropping it is how two versions of an editor
    disagree about what was saved.
    """

    model_config = ConfigDict(extra="forbid", frozen=True, populate_by_name=True)


class HealthResponse(_Strict):
    """Whether the service is up, and nothing else.

    Deliberately tiny: it is polled in a loop while the process starts, and it
    is the one endpoint that answers without a session token, so it must not be
    able to disclose anything — or fail for any reason but "not listening yet".
    """

    status: str = Field(default="ok", description="Always `ok` when this responds at all.")
    version: str = Field(description="Nova Studio version, as a semver string.")
    pid: int = Field(description="Process id of the service, for the shell's own diagnostics.")


class SystemInfoResponse(_Strict):
    """Who this session is, for the window title, the About box and bug reports."""

    version: str = Field(description="Nova Studio version.")
    project_format_version: int = Field(
        description="The newest `.nova` format version this build reads and writes."
    )
    python: str = Field(description="Python version string of the running interpreter.")
    implementation: str = Field(description="Python implementation: CPython, PyPy, ...")
    platform: str = Field(description="Operating system, as `platform.platform()` reports it.")
    frozen: bool = Field(description="Whether this is a packaged build rather than a source run.")
    pid: int = Field(description="Process id of the service.")
    data_dir: str = Field(description="Where this session writes its data (ADR-0014).")
    host: str = Field(description="The host the service is bound to; `127.0.0.1` for a session.")
    port: int = Field(description="The port this session chose at startup; `0` when unbound.")


class ComponentStatus(_Strict):
    """Whether one optional component is installed here."""

    name: str = Field(description="Importable module name.")
    extra: str = Field(description="The optional dependency group that provides it.")
    purpose: str = Field(description="What it is for, in one line.")
    installed: bool = Field(description="Whether it can be imported on this machine.")


class CapabilitiesResponse(_Strict):
    """What this machine can do, and what it is missing."""

    usable: bool = Field(description="Whether every required component is present.")
    missing_required: list[str] = Field(
        default_factory=list,
        description="Required components that are absent; empty when `usable`.",
    )
    components: list[ComponentStatus] = Field(
        default_factory=list, description="Every probed component, present or not."
    )


def probe_components() -> CapabilitiesResponse:
    """Ask this machine what it has, without importing any of it.

    ``find_spec`` rather than ``import_module``: importing OpenCV to report that
    OpenCV is installed costs seconds, and raises on a broken install — exactly
    the machine you need the answer from.
    """
    components = [
        ComponentStatus(
            name=name,
            extra=extra,
            purpose=purpose,
            installed=importlib.util.find_spec(name) is not None,
        )
        for name, extra, purpose in OPTIONAL_COMPONENTS
    ]
    installed = {item.name for item in components if item.installed}
    missing = sorted(REQUIRED_COMPONENTS - installed)
    return CapabilitiesResponse(usable=not missing, missing_required=missing, components=components)


def python_version() -> str:
    """The interpreter version, in the form a bug report wants."""
    return sys.version.split()[0]


def platform_name() -> str:
    """The operating system, as one line."""
    return platform.platform()
