"""Command-line entry point for Nova Studio.

Three kinds of process need to talk to this package: the desktop launcher, a
render or AI worker, and a contributor running diagnostics.  All three start
here.  The subcommands that exist today are the ones that are meaningful before
the service layer does — ``serve`` and ``desktop`` arrive with Stages 4 and 14
rather than as stubs that print "not implemented".

Design constraints:

* **Importing this module must stay cheap.**  It resolves submodules lazily inside
  each command, so ``nova-studio version`` does not pay for the media stack.
* **Diagnostics must be machine-readable.**  ``--json`` on every command that
  reports state, so packaging and CI can consume it without scraping text.
* **Exit codes carry meaning.**  ``0`` usable, ``1`` a check failed, ``2`` a
  usage error (argparse's own convention).  A script must never have to parse a
  message to know whether it succeeded.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Final

import nova_studio

__all__ = ["build_parser", "main"]

#: The environment variable that relocates all writable state (ADR-0014).  A
#: portable build sets it so the application carries its data next to the
#: executable instead of writing into the user's profile.
DATA_DIR_ENV: Final[str] = "NOVA_DATA_DIR"

#: Optional components, with the extra that provides each.  Probed with
#: ``importlib.util.find_spec`` rather than imported: a diagnostic that has to
#: load OpenCV to report whether OpenCV is installed would take seconds and would
#: itself fail on a broken install.
OPTIONAL_COMPONENTS: Final[tuple[tuple[str, str, str], ...]] = (
    ("av", "base", "PyAV — primary media decode/encode backend"),
    ("cv2", "base", "OpenCV — frame operations and colour conversion"),
    ("numpy", "base", "NumPy — frame buffer representation"),
    ("PIL", "base", "Pillow — image I/O and text rasterisation"),
    ("imageio_ffmpeg", "base", "Bundled FFmpeg binary locator"),
    ("pydantic", "base", "Pydantic — wire DTO validation"),
    ("fastapi", "base", "FastAPI — HTTP/WS boundary"),
    ("uvicorn", "base", "Uvicorn — ASGI server"),
    ("psutil", "base", "psutil — process and resource metrics"),
    ("watchfiles", "base", "watchfiles — media folder watching"),
    ("webview", "desktop", "pywebview — desktop window shell"),
    ("faster_whisper", "asr", "faster-whisper — speech recognition"),
    ("ctranslate2", "asr", "CTranslate2 — inference runtime for whisper models"),
    ("onnxruntime", "asr", "ONNX Runtime — VAD and alignment models"),
)

#: Components without which the application cannot run at all.
REQUIRED_COMPONENTS: Final[frozenset[str]] = frozenset({"numpy", "av", "pydantic"})

#: Code run in a child interpreter to measure the L1 import footprint.  Measured
#: out of process because ``sys.modules`` here already contains whatever this
#: command loaded, which would make the number meaningless.
_FOOTPRINT_PROBE: Final[str] = (
    "import sys;before=set(sys.modules);import nova_studio.core;print(len(set(sys.modules)-before))"
)
_FOOTPRINT_BASELINE: Final[str] = "import sys;print(len(set(sys.modules)))"


@dataclass(frozen=True, slots=True)
class ComponentStatus:
    """Availability of one optional dependency."""

    name: str
    extra: str
    purpose: str
    installed: bool


@dataclass(frozen=True, slots=True)
class DiagnosticReport:
    """Everything ``doctor`` determines about this environment."""

    version: str
    project_format_version: int
    database_schema_version: int
    python: str
    implementation: str
    platform: str
    frozen: bool
    data_dir: str
    data_dir_from_env: bool
    kernel_modules_added: int
    kernel_baseline_modules: int
    components: tuple[ComponentStatus, ...]
    ffmpeg: str | None
    missing_required: tuple[str, ...]

    @property
    def usable(self) -> bool:
        """Whether the application can start in this environment."""
        return not self.missing_required

    def to_dict(self) -> dict[str, Any]:
        """Serialise for ``--json``."""
        payload = asdict(self)
        payload["components"] = [asdict(item) for item in self.components]
        payload["usable"] = self.usable
        return payload


def _child_module_count(code: str) -> int | None:
    """Run ``code`` in a fresh interpreter and read back an integer.

    Returns ``None`` if the child failed — a diagnostic must not raise because the
    thing it is diagnosing is broken.
    """
    import subprocess

    try:
        completed = subprocess.run(
            [sys.executable, "-c", code],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if completed.returncode != 0:
        return None
    try:
        return int(completed.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        return None


def _resolve_data_dir() -> tuple[str, bool]:
    """Return the writable state directory and whether it came from the environment.

    The default is platform-appropriate rather than hardcoded, because a portable
    Windows build, a macOS bundle and a Linux install each have a different
    convention, and writing into the wrong one is how an application ends up
    scattering state across a user's home directory.
    """
    override = os.environ.get(DATA_DIR_ENV)
    if override:
        return str(Path(override).expanduser()), True
    system = platform.system()
    home = Path.home()
    if system == "Windows":
        base = os.environ.get("LOCALAPPDATA") or str(home / "AppData" / "Local")
        candidate = Path(base) / "NovaStudio"
    elif system == "Darwin":
        candidate = home / "Library" / "Application Support" / "NovaStudio"
    else:
        base = os.environ.get("XDG_DATA_HOME") or str(home / ".local" / "share")
        candidate = Path(base) / "nova-studio"
    return str(candidate), False


def _probe_components() -> tuple[ComponentStatus, ...]:
    """Report which optional dependencies are importable, without importing them."""
    import importlib.util

    statuses: list[ComponentStatus] = []
    for name, extra, purpose in OPTIONAL_COMPONENTS:
        try:
            installed = importlib.util.find_spec(name) is not None
        except (ImportError, ValueError, ModuleNotFoundError):
            # A partially installed package can raise from find_spec; that is
            # exactly the condition doctor exists to report.
            installed = False
        statuses.append(
            ComponentStatus(name=name, extra=extra, purpose=purpose, installed=installed)
        )
    return tuple(statuses)


def _probe_ffmpeg() -> str | None:
    """Locate the FFmpeg binary the media backend will shell out to.

    Returns ``None`` when unavailable.  Importing ``imageio_ffmpeg`` costs ~20 ms,
    which is acceptable for a diagnostic and is the reason this is not part of
    ``version``.
    """
    import importlib.util

    if importlib.util.find_spec("imageio_ffmpeg") is None:
        return None
    try:
        import imageio_ffmpeg

        return str(imageio_ffmpeg.get_ffmpeg_exe())
    except Exception:
        # Deliberately broad: this is a diagnostic. A broken FFmpeg locator is a
        # finding to report, not a reason for `doctor` itself to fail with a
        # traceback the user has to interpret.
        return None


def collect_report() -> DiagnosticReport:
    """Gather the full environment report."""
    components = _probe_components()
    installed = {item.name for item in components if item.installed}
    missing = tuple(sorted(REQUIRED_COMPONENTS - installed))
    data_dir, from_env = _resolve_data_dir()
    added = _child_module_count(_FOOTPRINT_PROBE)
    baseline = _child_module_count(_FOOTPRINT_BASELINE)
    return DiagnosticReport(
        version=nova_studio.__version__,
        project_format_version=nova_studio.PROJECT_FORMAT_VERSION,
        database_schema_version=nova_studio.DATABASE_SCHEMA_VERSION,
        python=platform.python_version(),
        implementation=platform.python_implementation(),
        platform=platform.platform(),
        frozen=bool(getattr(sys, "frozen", False)),
        data_dir=data_dir,
        data_dir_from_env=from_env,
        kernel_modules_added=added if added is not None else -1,
        kernel_baseline_modules=baseline if baseline is not None else -1,
        components=components,
        ffmpeg=_probe_ffmpeg(),
        missing_required=missing,
    )


def _print_report(report: DiagnosticReport, stream: Any) -> None:
    """Render the report for a human, with the problems first."""
    print(f"Nova Studio {report.version}", file=stream)
    print(
        f"  python      {report.python} ({report.implementation}) on {report.platform}",
        file=stream,
    )
    print(f"  packaged    {'frozen build' if report.frozen else 'source checkout'}", file=stream)
    origin = f"${DATA_DIR_ENV}" if report.data_dir_from_env else "platform default"
    print(f"  data dir    {report.data_dir}  ({origin})", file=stream)
    print(
        f"  formats     project v{report.project_format_version}, "
        f"database v{report.database_schema_version}",
        file=stream,
    )
    if report.kernel_modules_added >= 0:
        print(
            f"  L1 kernel   {report.kernel_modules_added} modules over a "
            f"{report.kernel_baseline_modules} module baseline",
            file=stream,
        )
    print(f"  ffmpeg      {report.ffmpeg or 'not available'}", file=stream)
    print("  components", file=stream)
    for item in report.components:
        mark = "ok" if item.installed else "missing"
        print(f"    [{mark:7s}] {item.name:16s} ({item.extra}) {item.purpose}", file=stream)
    if report.missing_required:
        print("", file=stream)
        print(
            f"NOT USABLE: required components absent: {', '.join(report.missing_required)}",
            file=stream,
        )
        print("  install them with:  pip install -r requirements/base.txt", file=stream)
    else:
        print("", file=stream)
        print("usable: all required components are present", file=stream)


def cmd_version(args: argparse.Namespace) -> int:
    """Print the version, and the format versions that travel with it."""
    if args.json:
        print(
            json.dumps(
                {
                    "version": nova_studio.__version__,
                    "project_format_version": nova_studio.PROJECT_FORMAT_VERSION,
                    "database_schema_version": nova_studio.DATABASE_SCHEMA_VERSION,
                    "ws_protocol_version": nova_studio.WS_PROTOCOL_VERSION,
                    "python": platform.python_version(),
                },
                indent=2,
                ensure_ascii=False,
            )
        )
    else:
        print(nova_studio.__version__)
    return 0


def cmd_doctor(args: argparse.Namespace) -> int:
    """Report whether this environment can actually run Nova Studio."""
    report = collect_report()
    if args.json:
        print(json.dumps(report.to_dict(), indent=2, ensure_ascii=False))
    else:
        _print_report(report, sys.stdout if report.usable else sys.stderr)
    return 0 if report.usable else 1


def cmd_layering(args: argparse.Namespace) -> int:
    """Run the architectural layering gate (ADR-0002).

    Delegates to ``scripts/check_layering.py`` rather than importing it: the
    scripts directory is not part of the installed distribution, so a frozen build
    would not be able to resolve it as a module.
    """
    import subprocess

    script = Path(__file__).resolve().parent.parent / "scripts" / "check_layering.py"
    if not script.is_file():
        print(
            f"layering gate unavailable: {script} not found "
            "(it ships with the source checkout, not the frozen build)",
            file=sys.stderr,
        )
        return 2
    command = [sys.executable, str(script)]
    if args.json:
        command.append("--json")
    if args.explain:
        command.append("--explain")
    return subprocess.run(command, check=False).returncode


def build_parser() -> argparse.ArgumentParser:
    """Construct the CLI parser.

    Subcommands resolve their dependencies lazily, so the parser can be built — and
    ``--help`` rendered — without importing anything heavy.
    """
    parser = argparse.ArgumentParser(
        prog="nova-studio",
        description="Nova Studio — desktop video editor with an AI caption studio.",
        epilog=(
            "Environment: NOVA_DATA_DIR relocates all writable state, which is how "
            "a portable build keeps its data next to the executable."
        ),
    )
    parser.add_argument(
        "--version", action="version", version=f"nova-studio {nova_studio.__version__}"
    )
    subparsers = parser.add_subparsers(dest="command", metavar="COMMAND")

    version_parser = subparsers.add_parser("version", help="print version and format compatibility")
    version_parser.add_argument("--json", action="store_true", help="emit JSON")
    version_parser.set_defaults(func=cmd_version)

    doctor_parser = subparsers.add_parser(
        "doctor",
        help="report whether this environment can run Nova Studio",
        description=(
            "Probe the interpreter, the writable data directory, the L1 import "
            "footprint and every optional component, then say plainly whether the "
            "application is usable here. Exits 1 when a required component is "
            "missing, so packaging and CI can gate on it."
        ),
    )
    doctor_parser.add_argument("--json", action="store_true", help="emit JSON")
    doctor_parser.set_defaults(func=cmd_doctor)

    layering_parser = subparsers.add_parser(
        "layering", help="run the architectural layering gate (ADR-0002)"
    )
    layering_parser.add_argument("--json", action="store_true", help="emit JSON")
    layering_parser.add_argument("--explain", action="store_true", help="print the rules and exit")
    layering_parser.set_defaults(func=cmd_layering)

    return parser


def main(argv: list[str] | None = None) -> int:
    """CLI entry point.  Returns a process exit code."""
    parser = build_parser()
    args = parser.parse_args(argv)
    func = getattr(args, "func", None)
    if func is None:
        # No subcommand: print help rather than doing nothing silently.
        parser.print_help()
        return 2
    result: int = func(args)
    return result


if __name__ == "__main__":
    raise SystemExit(main())
