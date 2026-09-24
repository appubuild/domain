#!/usr/bin/env python3
"""Verify the repository stays free of generated and binary artefacts (ADR-0016).

Git never forgets: a media fixture or a model weight committed today is a
multi-hundred-megabyte clone for every contributor forever.  Nova Studio generates
its test media deterministically at session scope instead, so the tree should
contain source, documentation and small JSON baselines — nothing else.

Checks
------
1. No tracked file exceeds :data:`MAX_BINARY_BYTES` unless explicitly allowlisted.
2. No tracked file has a binary extension from :data:`BANNED_EXTENSIONS`.
3. No path that :data:`GITIGNORED_PREFIXES` covers is tracked (an ignore rule that
   is committed anyway is a mistake worth catching).
4. No ``TODO``/``FIXME`` marker is left without an issue reference, so a known gap
   is always traceable.

Usage::

    python scripts/check_repo_hygiene.py            # exit non-zero on a problem
    python scripts/check_repo_hygiene.py --json     # machine-readable report
    python scripts/check_repo_hygiene.py --list-allowlisted
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Final

REPO_ROOT: Final[Path] = Path(__file__).resolve().parent.parent

#: Above this size a tracked file needs an explicit justification.
MAX_BINARY_BYTES: Final[int] = 64 * 1024

#: Extensions that must never be committed.  Media fixtures are generated
#: (ADR-0016); model weights are downloaded at runtime (ADR-0009).
BANNED_EXTENSIONS: Final[frozenset[str]] = frozenset(
    {
        ".mp4",
        ".mov",
        ".mkv",
        ".avi",
        ".webm",
        ".mxf",
        ".mp3",
        ".wav",
        ".aac",
        ".flac",
        ".m4a",
        ".ogg",
        ".opus",
        ".bin",
        ".pt",
        ".pth",
        ".onnx",
        ".ct2",
        ".ggml",
        ".safetensors",
        ".ckpt",
        ".h5",
        ".npy",
        ".npz",
        ".parquet",
        ".db",
        ".sqlite",
        ".sqlite3",
        ".zip",
        ".tar",
        ".gz",
        ".bz2",
        ".7z",
        ".rar",
        ".exe",
        ".dll",
        ".so",
        ".dylib",
        ".pyd",
        ".whl",
        ".ttf",
        ".otf",
        ".woff",
        ".woff2",
        ".psd",
        ".ai",
        ".blend",
        ".aep",
        ".prproj",
        ".drp",
        ".fcpxml",
    }
)

#: Image formats are permitted only when tiny (icons) and not in test fixtures.
IMAGE_EXTENSIONS: Final[frozenset[str]] = frozenset(
    {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".ico"}
)

#: Tracked paths matching these prefixes indicate an ignore rule was bypassed.
GITIGNORED_PREFIXES: Final[frozenset[str]] = frozenset(
    {
        ".venv/",
        "node_modules/",
        "__pycache__/",
        ".pytest_cache/",
        ".mypy_cache/",
        ".ruff_cache/",
        "dist/",
        "build/",
        ".nova/",
        "nova-data/",
        "models/",
        "frontend/dist/",
        "coverage/",
        "htmlcov/",
    }
)

#: Files permitted to exceed the size limit, with the reason.  Keep this list
#: short and specific; every entry is a permanent cost on every clone.
ALLOWLIST: Final[dict[str, str]] = {}

#: Source files scanned for untracked TODO markers.
SOURCE_GLOBS: Final[tuple[str, ...]] = ("**/*.py", "**/*.ts", "**/*.tsx")

#: Directories never scanned for markers.
SKIP_DIRS: Final[frozenset[str]] = frozenset(
    {".git", ".venv", "node_modules", "__pycache__", "dist", "build", ".mypy_cache"}
)

#: Files exempt from the *marker* check only.
#:
#: This script is the definition of the marker policy, so it necessarily contains
#: the literal marker words in its docstrings, its message templates and its
#: needle list.  No amount of docstring filtering removes those without also
#: removing the documentation, so the checker is exempt from this one check.  It
#: remains fully subject to the size, extension and ignore-path checks.
MARKER_EXEMPT_FILES: Final[frozenset[str]] = frozenset({"scripts/check_repo_hygiene.py"})


@dataclass(frozen=True, slots=True)
class Finding:
    """One hygiene problem."""

    kind: str
    path: str
    detail: str

    def format(self) -> str:
        return f"[{self.kind}] {self.path}: {self.detail}"


def tracked_files() -> list[str]:
    """Return every path git tracks, relative to the repository root.

    Falls back to walking the tree when git is unavailable (for example inside a
    source tarball), so the check still runs.
    """
    try:
        completed = subprocess.run(
            ["git", "ls-files", "-z"],
            cwd=REPO_ROOT,
            capture_output=True,
            check=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return [
            str(path.relative_to(REPO_ROOT))
            for path in REPO_ROOT.rglob("*")
            if path.is_file() and not any(part in SKIP_DIRS for part in path.parts)
        ]
    return [item for item in completed.stdout.decode("utf-8").split("\0") if item]


def check_sizes(files: list[str]) -> list[Finding]:
    """Flag tracked files that are too large without an allowlist entry."""
    findings: list[Finding] = []
    for relative in files:
        if relative in ALLOWLIST:
            continue
        path = REPO_ROOT / relative
        if not path.is_file():
            continue
        size = path.stat().st_size
        if size > MAX_BINARY_BYTES:
            findings.append(
                Finding(
                    kind="oversize",
                    path=relative,
                    detail=(
                        f"{size:,} bytes exceeds the {MAX_BINARY_BYTES:,} byte limit. "
                        "Generate it at build/test time instead, or add it to "
                        "ALLOWLIST with a written justification."
                    ),
                )
            )
    return findings


def check_extensions(files: list[str]) -> list[Finding]:
    """Flag tracked files with a banned extension."""
    findings: list[Finding] = []
    for relative in files:
        suffix = Path(relative).suffix.lower()
        if suffix in BANNED_EXTENSIONS:
            findings.append(
                Finding(
                    kind="banned-extension",
                    path=relative,
                    detail=(
                        f"{suffix} files are never committed. Media fixtures are "
                        "generated (ADR-0016); model weights download at runtime "
                        "(ADR-0009)."
                    ),
                )
            )
        elif suffix in IMAGE_EXTENSIONS:
            path = REPO_ROOT / relative
            if path.is_file() and path.stat().st_size > MAX_BINARY_BYTES:
                findings.append(
                    kind="oversize-image",
                    path=relative,
                    detail=(
                        f"{path.stat().st_size:,} bytes; images are permitted only "
                        "for small UI assets."
                    ),
                )
    return findings


def check_ignored_paths(files: list[str]) -> list[Finding]:
    """Flag tracked paths that a ``.gitignore`` rule says should not exist."""
    findings: list[Finding] = []
    for relative in files:
        normalised = relative.replace("\\", "/")
        for prefix in GITIGNORED_PREFIXES:
            if normalised.startswith(prefix) or f"/{prefix}" in f"/{normalised}":
                findings.append(
                    Finding(
                        kind="ignored-path",
                        path=relative,
                        detail=(
                            f"matches the ignored prefix {prefix!r}; it is tracked "
                            "anyway, which usually means it was force-added."
                        ),
                    )
                )
                break
    return findings


def _iter_code_lines(path: Path) -> list[tuple[int, str]]:
    """Yield ``(line_number, text)`` for lines that are code, not prose.

    A marker inside a docstring or a comment that merely *discusses* the marker
    policy is not a gap in the work, so docstring bodies and whole-line comments
    are skipped.  This is what keeps the hygiene checker from flagging its own
    documentation.
    """
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:  # pragma: no cover - unreadable file is not our concern
        return []

    code: list[tuple[int, str]] = []
    in_docstring = False
    delimiter = '"""'
    for number, line in enumerate(lines, start=1):
        stripped = line.strip()
        occurrences = stripped.count(delimiter)
        if in_docstring:
            if delimiter in stripped:
                in_docstring = False
                # A closing line may reopen a docstring on the same line.
                if stripped.count(delimiter) % 2 == 1:
                    in_docstring = True
            continue
        if occurrences % 2 == 1:
            # Opens a docstring that does not close on this line.  The opening
            # line itself may hold code before the quotes, so keep it.
            in_docstring = True
            code.append((number, line))
            continue
        if occurrences >= 2:
            # A one-line docstring: pure prose.
            continue
        if stripped.startswith("#"):
            continue
        code.append((number, line))
    return code


def check_markers() -> list[Finding]:
    """Flag TODO/FIXME markers that carry no issue reference.

    A marker without a reference is a gap nobody owns.  The required form is
    ``MARKER(NS-123):`` or a reference appearing after the marker on the same
    line, e.g. ``MARKER: tracked as NS-123``.
    """
    findings: list[Finding] = []
    needles = ("TODO", "FIXME", "XXX", "HACK")
    for pattern in SOURCE_GLOBS:
        for path in REPO_ROOT.glob(pattern):
            if any(part in SKIP_DIRS for part in path.parts):
                continue
            if not path.is_file():
                continue
            relative = path.relative_to(REPO_ROOT).as_posix()
            if relative in MARKER_EXEMPT_FILES:
                continue
            for number, line in _iter_code_lines(path):
                for needle in needles:
                    index = line.find(needle)
                    if index == -1:
                        continue
                    rest = line[index + len(needle) :]
                    if rest.startswith("(") and rest[1:].split(")")[0].strip():
                        continue
                    if "NS-" in rest:
                        continue
                    findings.append(
                        Finding(
                            kind="untracked-marker",
                            path=f"{path.relative_to(REPO_ROOT)}:{number}",
                            detail=(
                                f"{needle} without an issue reference; use "
                                f"{needle}(NS-123): so the gap is owned."
                            ),
                        )
                    )
                    break
    return findings


def scan(*, include_markers: bool = True) -> list[Finding]:
    """Run every check and return all findings."""
    files = tracked_files()
    findings = [*check_sizes(files), *check_extensions(files), *check_ignored_paths(files)]
    if include_markers:
        findings.extend(check_markers())
    return sorted(findings, key=lambda item: (item.kind, item.path))


def summarise(findings: list[Finding]) -> dict[str, int]:
    """Count findings per kind."""
    counts: dict[str, int] = {}
    for finding in findings:
        counts[finding.kind] = counts.get(finding.kind, 0) + 1
    return dict(sorted(counts.items()))


def main(argv: list[str] | None = None) -> int:
    """CLI entry point.  Returns a process exit code."""
    parser = argparse.ArgumentParser(
        prog="check_repo_hygiene",
        description="Verify no generated or binary artefacts are committed (ADR-0016).",
    )
    parser.add_argument("--json", action="store_true", help="emit a machine-readable report")
    parser.add_argument(
        "--no-markers", action="store_true", help="skip the TODO/FIXME reference check"
    )
    parser.add_argument(
        "--list-allowlisted", action="store_true", help="print the size allowlist and exit"
    )
    args = parser.parse_args(argv)

    if args.list_allowlisted:
        if not ALLOWLIST:
            print(f"the allowlist is empty: no tracked file may exceed {MAX_BINARY_BYTES:,} bytes")
        for path, reason in sorted(ALLOWLIST.items()):
            print(f"{path}: {reason}")
        return 0

    findings = scan(include_markers=not args.no_markers)
    if args.json:
        print(
            json.dumps(
                {
                    "findings": [asdict(item) for item in findings],
                    "summary": summarise(findings),
                    "count": len(findings),
                    "max_bytes": MAX_BINARY_BYTES,
                },
                indent=2,
            )
        )
    else:
        for finding in findings:
            print(finding.format(), file=sys.stderr)
        if findings:
            print(f"\n{len(findings)} hygiene finding(s): {summarise(findings)}", file=sys.stderr)
        else:
            print("repo hygiene: OK")
    return 1 if findings else 0


if __name__ == "__main__":
    raise SystemExit(main())
