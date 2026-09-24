#!/usr/bin/env python3
"""Enforce the architectural layering rules of ADR-0002.

Architecture that is only documented is architecture that decays.  This script
parses the import graph with :mod:`ast` and fails the build on any violation, so
the four-ring dependency rule is a mechanical guarantee rather than a convention
remembered at review time.

Rules enforced
--------------
1. **Ring direction.**  ``core`` (L1) may not import ``domain``/``ports`` (L2),
   ``services`` (L3) or ``infra``/``api`` (L4).  ``domain``/``ports`` may not
   import ``services``/``infra``/``api``.  ``services`` may not import
   ``infra``/``api``.
2. **Banned modules outside their ring.**  Third-party I/O libraries
   (``av``, ``cv2``, ``sqlite3``, ``faster_whisper``, ``PIL``, ``webview``, ...)
   are permitted only in ``infra``; ``fastapi`` and ``uvicorn`` only in ``api``.
   ``services`` depends on ports, so ``import av`` inside a service means the
   service can no longer be tested without FFmpeg.  ``pydantic`` is confined to
   ``api``/``infra`` — see rule 5.  ``numpy`` is deliberately *not* banned: it is
   the frame-buffer representation, not an I/O library.
3. **Ring purity.**  ``domain`` may not import ``sqlite3``, ``socket``,
   ``subprocess``, ``urllib``, ``http``, ``asyncio`` or ``threading``: it contains
   no I/O, no clock and no randomness, all of which are injected through ports.
   ``core`` may use ``threading`` (the event bus needs it) but not ``sqlite3``,
   ``socket``, ``subprocess``, ``ssl``, ``pydantic``, ``fastapi`` or ``uvicorn``.
4. **Feature isolation inside ``services``.**  A feature module may import
   ``core``, ``domain``, ``ports``, ``services.shared`` and its own package, but
   not a sibling feature.  Cross-feature collaboration goes through a port or an
   event, which is what keeps modules independently replaceable (a stated product
   requirement).
5. **Framework-free inner rings.**  ``pydantic`` in ``core`` or ``domain`` is a
   measurable cost, not a stylistic one: one module-scope import in the kernel
   raised the L1 footprint from 51 modules (~50 ms) to 203 (~150 ms) and pulled
   ``socket``, ``ssl``, ``subprocess`` and ``urllib`` into every render worker and
   plugin host.  Domain models are plain frozen dataclasses; wire DTOs live in
   ``api`` (ADR-0002 rule 6).
6. **No relative imports that escape a package**, which would hide a dependency
   from the graph.

What this scan cannot see
-------------------------
A textual scan reads source, so it misses *transitive* dependencies: pydantic
reached ``socket`` and ``ssl`` without any core module naming them.
``tests/core/test_public_api.py`` covers that by inspecting the loaded module
graph in a fresh subprocess.  Both gates are worth keeping.

The composition root (``nova_studio.cli``, ``nova_studio.__main__``) sits outside
the rings and wires them together, so it is exempt from rules 2 and 3.  That
exemption covers only modules directly inside ``nova_studio`` — never anything in
a subpackage — so it cannot launder an I/O import by moving it up a directory.

Usage::

    python scripts/check_layering.py            # check, exit non-zero on violation
    python scripts/check_layering.py --json     # machine-readable report
    python scripts/check_layering.py --explain  # print the rules and exit
"""

from __future__ import annotations

import argparse
import ast
import json
import sys
from collections import defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Final

PACKAGE_ROOT: Final[Path] = Path(__file__).resolve().parent.parent / "nova_studio"

#: Ring index per top-level subpackage.  Lower may not import higher.
RINGS: Final[dict[str, int]] = {
    "core": 1,
    "domain": 2,
    "ports": 2,
    "services": 3,
    "infra": 4,
    "api": 4,
}

#: Modules that sit *outside* the rings and wire them together: the CLI and the
#: ``python -m`` entry point.  A composition root may legitimately import any ring
#: — that is its job — so it is exempt from the banned-import and purity rules.
#: The exemption is deliberately narrow: it covers only modules directly inside
#: ``nova_studio``, never anything in a subpackage, so it cannot be used to launder
#: an I/O import by moving it up a directory.
COMPOSITION_ROOT: Final[frozenset[str]] = frozenset({"nova_studio.cli", "nova_studio.__main__"})


def _is_composition_root(module: str) -> bool:
    """Whether ``module`` is the composition root rather than a ring member."""
    return module in COMPOSITION_ROOT


RING_NAMES: Final[dict[int, str]] = {
    1: "L1 core",
    2: "L2 domain/ports",
    3: "L3 services",
    4: "L4 infra/api",
}

#: Third-party modules that perform I/O and therefore belong only in ``infra``.
#: ``numpy`` is deliberately absent: it is the frame-buffer representation defined
#: in ``domain/media.py`` and is legitimately used by services.
IO_LIBRARIES: Final[dict[str, str]] = {
    "av": "PyAV (FFmpeg libraries)",
    "cv2": "OpenCV",
    "sqlite3": "stdlib sqlite3 (use infra.persistence.sqlite)",
    "faster_whisper": "faster-whisper ASR",
    "ctranslate2": "CTranslate2 inference",
    "imageio_ffmpeg": "bundled FFmpeg binary locator",
    "PIL": "Pillow imaging",
    "webview": "pywebview desktop shell",
    "onnxruntime": "ONNX runtime",
    "psutil": "process/system metrics",
    "watchfiles": "filesystem watching",
    "uvicorn": "ASGI server",
    "fastapi": "web framework",
    "httpx": "HTTP client",
    # Pydantic is not I/O, but importing it costs ~150 modules and transitively
    # loads socket/ssl/subprocess.  In the kernel that cost is paid by every render
    # worker, plugin host and CLI invocation, so it is confined to the wire boundary.
    "pydantic": "pydantic validation/serialisation",
}

#: Packages allowed to import each banned library.
ALLOWED_HOME: Final[dict[str, frozenset[str]]] = {
    "av": frozenset({"infra"}),
    "cv2": frozenset({"infra"}),
    "sqlite3": frozenset({"infra"}),
    "faster_whisper": frozenset({"infra"}),
    "ctranslate2": frozenset({"infra"}),
    "imageio_ffmpeg": frozenset({"infra"}),
    "PIL": frozenset({"infra"}),
    "webview": frozenset({"api", "infra"}),
    "onnxruntime": frozenset({"infra"}),
    "psutil": frozenset({"infra", "services"}),
    "watchfiles": frozenset({"infra"}),
    "uvicorn": frozenset({"api", "__main__"}),
    "fastapi": frozenset({"api"}),
    "httpx": frozenset({"api", "infra"}),
    # Request/response DTOs and adapter configuration only.  ``domain`` stays on
    # plain dataclasses so the model has no serialisation-framework dependency.
    "pydantic": frozenset({"api", "infra"}),
}

#: ``domain`` must stay pure: no I/O, no clock, no randomness (ADR-0002 §1).
DOMAIN_BANNED: Final[frozenset[str]] = frozenset(
    {"sqlite3", "socket", "subprocess", "urllib", "http", "asyncio", "threading"}
)

#: ``core`` may use threading (the event bus needs it) but nothing else impure.
#: ``asyncio`` is permitted in source because the bus offers an async bridge, but it
#: must be imported lazily inside that bridge — ``tests/core/test_public_api.py``
#: asserts the loaded module graph stays free of it.
CORE_BANNED: Final[frozenset[str]] = frozenset(
    {"sqlite3", "socket", "subprocess", "ssl", "pydantic", "fastapi", "uvicorn"}
)


@dataclass(frozen=True, slots=True)
class Violation:
    """One rule breach, with enough context to fix it without re-running."""

    rule: str
    file: str
    line: int
    importer: str
    imported: str
    message: str

    def format(self) -> str:
        return f"{self.file}:{self.line}: [{self.rule}] {self.message}"


def _module_of(path: Path, base: Path) -> str:
    """Return the dotted module path of ``path``.

    ``base`` is the package directory (``.../nova_studio``); its parent is the
    import root.  Taking ``base`` as a parameter rather than reading the module
    constant is what makes ``--root`` usable, and with it the checker itself
    testable against a synthetic package tree.
    """
    relative = path.relative_to(base.parent)
    parts = list(relative.with_suffix("").parts)
    if parts and parts[-1] == "__init__":
        parts = parts[:-1]
    return ".".join(parts)


def _subpackage(module: str) -> str:
    """Return the top-level subpackage of ``nova_studio.<sub>...``."""
    parts = module.split(".")
    if len(parts) < 2:
        return ""
    return parts[1]


def _feature(module: str) -> str:
    """Return the feature package for a ``nova_studio.services.<feature>...`` module."""
    parts = module.split(".")
    if len(parts) < 3:
        return ""
    return parts[2]


def _imported_names(node: ast.AST) -> list[tuple[int, str]]:
    """Extract (line, dotted-name) pairs from an import statement."""
    found: list[tuple[int, str]] = []
    if isinstance(node, ast.Import):
        found.extend((node.lineno, alias.name) for alias in node.names)
    elif isinstance(node, ast.ImportFrom):
        if node.level and node.level > 0:
            # Relative import; the module attribute may be None for `from . import x`
            found.append((node.lineno, "." * node.level + (node.module or "")))
        elif node.module:
            found.append((node.lineno, node.module))
            found.extend((node.lineno, f"{node.module}.{alias.name}") for alias in node.names)
    return found


def _check_ring(module: str, imported: str, line: int, path: Path) -> Violation | None:
    """Rule 1: dependencies point inward, never outward."""
    if not imported.startswith("nova_studio."):
        return None
    source_ring = RINGS.get(_subpackage(module))
    target_sub = _subpackage(imported)
    target_ring = RINGS.get(target_sub)
    if source_ring is None or target_ring is None:
        return None
    if target_ring > source_ring:
        return Violation(
            rule="ring-direction",
            file=str(path),
            line=line,
            importer=module,
            imported=imported,
            message=(
                f"{RING_NAMES[source_ring]} ({module}) must not import "
                f"{RING_NAMES[target_ring]} ({imported}); dependencies point inward "
                "only (ADR-0002)"
            ),
        )
    return None


def _check_banned_io(module: str, imported: str, line: int, path: Path) -> Violation | None:
    """Rule 2: I/O libraries live in ``infra`` (and a few named exceptions)."""
    root = imported.split(".")[0]
    if root not in IO_LIBRARIES:
        return None
    if _is_composition_root(module):
        return None
    sub = _subpackage(module)
    if sub in ALLOWED_HOME.get(root, frozenset()):
        return None
    if module.endswith("__main__") and root in ALLOWED_HOME.get("__main__", frozenset()):
        return None
    return Violation(
        rule="banned-io",
        file=str(path),
        line=line,
        importer=module,
        imported=imported,
        message=(
            f"{module} imports {root} ({IO_LIBRARIES[root]}), which is allowed only "
            f"in {sorted(ALLOWED_HOME.get(root, []))}. Depend on a port in "
            "nova_studio.ports instead (ADR-0002)."
        ),
    )


def _check_purity(module: str, imported: str, line: int, path: Path) -> Violation | None:
    """Rule 1b: ``domain`` and ``core`` stay free of I/O and concurrency imports."""
    if _is_composition_root(module):
        return None
    sub = _subpackage(module)
    root = imported.split(".")[0]
    if sub == "domain" and root in DOMAIN_BANNED:
        return Violation(
            rule="domain-purity",
            file=str(path),
            line=line,
            importer=module,
            imported=imported,
            message=(
                f"domain module {module} imports {root}. The domain performs no I/O, "
                "reads no clock and creates no threads; inject a port instead "
                "(ADR-0002 §1)."
            ),
        )
    if sub == "core" and root in CORE_BANNED:
        return Violation(
            rule="core-purity",
            file=str(path),
            line=line,
            importer=module,
            imported=imported,
            message=(
                f"core module {module} imports {root}. The L1 kernel must be "
                "liftable into another product; keep I/O in infra."
            ),
        )
    return None


def _check_feature_isolation(module: str, imported: str, line: int, path: Path) -> Violation | None:
    """Rule 3: service features do not import sibling features."""
    if _subpackage(module) != "services" or not imported.startswith("nova_studio.services."):
        return None
    source_feature = _feature(module)
    target_feature = _feature(imported)
    if not source_feature or not target_feature:
        return None
    if source_feature == target_feature:
        return None
    # A shared kernel inside services is permitted; a sibling feature is not.
    if target_feature in {"shared", "container", "registry"}:
        return None
    return Violation(
        rule="feature-isolation",
        file=str(path),
        line=line,
        importer=module,
        imported=imported,
        message=(
            f"services.{source_feature} imports services.{target_feature}. Features "
            "collaborate through a port or an event so each stays independently "
            "replaceable (ADR-0002 rule 3)."
        ),
    )


def _check_relative_escape(module: str, imported: str, line: int, path: Path) -> Violation | None:
    """Rule 4: a relative import may not climb above its own top-level package."""
    if not imported.startswith("."):
        return None
    depth = len(imported) - len(imported.lstrip("."))
    if depth <= 1:
        return None
    parts = module.split(".")
    if depth > len(parts) - 1:
        return Violation(
            rule="relative-escape",
            file=str(path),
            line=line,
            importer=module,
            imported=imported,
            message=(
                f"{module} uses a relative import that escapes its package. Use an "
                "absolute import so the dependency is visible in the graph."
            ),
        )
    return None


CHECKS: Final[tuple[object, ...]] = (
    _check_ring,
    _check_banned_io,
    _check_purity,
    _check_feature_isolation,
    _check_relative_escape,
)


def _deduplicate(violations: list[Violation]) -> list[Violation]:
    """Collapse the redundant report a ``from X import Y`` statement produces.

    Such a statement yields two candidate names (``X`` and ``X.Y``), and both can
    breach the same rule on the same line.  Reporting both is noise; reporting only
    the parent would hide a violation that exists *because* of the submodule.  So we
    keep, per (rule, file, line, importer), the violation naming the deepest module
    — the most specific and therefore most actionable diagnosis.
    """
    best: dict[tuple[str, str, int, str], Violation] = {}
    for violation in violations:
        key = (violation.rule, violation.file, violation.line, violation.importer)
        current = best.get(key)
        if current is None or violation.imported.count(".") > current.imported.count("."):
            best[key] = violation
    return sorted(best.values(), key=lambda item: (item.file, item.line, item.rule))


def scan(root: Path | None = None) -> list[Violation]:
    """Walk the package and return every violation found."""
    base = root or PACKAGE_ROOT
    violations: list[Violation] = []
    for path in sorted(base.rglob("*.py")):
        module = _module_of(path, base)
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        except SyntaxError as exc:  # pragma: no cover - caught by ruff first
            violations.append(
                Violation(
                    rule="syntax",
                    file=str(path),
                    line=exc.lineno or 0,
                    importer=module,
                    imported="",
                    message=f"could not parse: {exc.msg}",
                )
            )
            continue
        for node in ast.walk(tree):
            if not isinstance(node, ast.Import | ast.ImportFrom):
                continue
            for line, imported in _imported_names(node):
                for check in CHECKS:
                    found = check(module, imported, line, path)  # type: ignore[operator]
                    if found is not None:
                        violations.append(found)
    return _deduplicate(violations)


def summarise(violations: list[Violation]) -> dict[str, int]:
    """Count violations per rule, for the CI summary line."""
    counts: dict[str, int] = defaultdict(int)
    for violation in violations:
        counts[violation.rule] += 1
    return dict(sorted(counts.items()))


EXPLANATION: Final[str] = __doc__ or ""


def main(argv: list[str] | None = None) -> int:
    """CLI entry point.  Returns a process exit code."""
    parser = argparse.ArgumentParser(
        prog="check_layering",
        description="Enforce Nova Studio's architectural layering rules (ADR-0002).",
    )
    parser.add_argument("--json", action="store_true", help="emit a machine-readable report")
    parser.add_argument("--explain", action="store_true", help="print the rules and exit")
    parser.add_argument(
        "--root",
        type=Path,
        default=None,
        help="package root to scan (default: the nova_studio package)",
    )
    args = parser.parse_args(argv)

    if args.explain:
        print(EXPLANATION)
        return 0

    violations = scan(args.root)
    if args.json:
        print(
            json.dumps(
                {
                    "violations": [asdict(item) for item in violations],
                    "summary": summarise(violations),
                    "count": len(violations),
                },
                indent=2,
            )
        )
    else:
        for violation in violations:
            print(violation.format(), file=sys.stderr)
        if violations:
            print(
                f"\n{len(violations)} layering violation(s): {summarise(violations)}",
                file=sys.stderr,
            )
            print(
                "Run `python scripts/check_layering.py --explain` for the rules.",
                file=sys.stderr,
            )
        else:
            print("layering: OK")
    return 1 if violations else 0


if __name__ == "__main__":
    raise SystemExit(main())
