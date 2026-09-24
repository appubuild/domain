"""The L1 public-API contract.

``nova_studio.core`` is the kernel every other ring builds on, so its surface is a
contract, not an implementation detail.  These tests pin three properties that are
easy to break by accident and expensive to discover late:

1. **Completeness** — everything a submodule declares public is reachable from the
   package façade.  A caller should never need to know which file a type lives in.
2. **Honesty** — ``__all__`` matches what is actually importable, so ``from
   nova_studio.core import *`` and IDE completion tell the truth.
3. **Stability** — the names the rest of the system already depends on keep
   existing.  Renaming one is a breaking change to 4 rings and must be deliberate.

A test that only checks "does this import" would pass while the façade silently
dropped half the API; checking in both directions is what makes it useful.
"""

from __future__ import annotations

import importlib
import pathlib
from enum import Enum
from typing import TYPE_CHECKING, Any, Protocol

import pytest

import nova_studio.core as core

if TYPE_CHECKING:
    from nova_studio.core.ident import EntityId

pytestmark = pytest.mark.unit

#: The submodules that make up L1.
CORE_MODULES: tuple[str, ...] = (
    "clock",
    "commands",
    "di",
    "errors",
    "events",
    "ident",
    "result",
    "temporal",
)

#: The submodules that make up the L2 port layer, so far.
PORT_MODULES: tuple[str, ...] = ("clock", "ident", "media")


def _module(name: str) -> Any:
    return importlib.import_module(f"nova_studio.core.{name}")


def _isort_style_sort(names: list[str]) -> list[str]:
    """Reproduce RUF022's ordering: SCREAMING_CASE, then CamelCase, then lowercase.

    Within each group the comparison is case-insensitive, which is what keeps
    ``EventBus`` before ``EventHandler`` but ``AUDIO_SAMPLE_RATES`` before both.
    """

    def group(name: str) -> int:
        if name.isupper() or name.startswith("_"):
            return 0
        if name[0].isupper():
            return 1
        return 2

    return sorted(names, key=lambda item: (group(item), item.lower()))


class TestEveryModuleIsPublic:
    @pytest.mark.parametrize("name", CORE_MODULES)
    def test_module_declares_an_explicit_api(self, name: str) -> None:
        """An implicit API means every helper is load-bearing by accident."""
        declared = getattr(_module(name), "__all__", None)
        assert declared, f"nova_studio.core.{name} must define __all__"
        assert len(declared) == len(set(declared)), f"{name}.__all__ has duplicates"

    @pytest.mark.parametrize("name", CORE_MODULES)
    def test_module_is_importable_from_the_package(self, name: str) -> None:
        assert importlib.import_module(f"nova_studio.core.{name}") is not None


class TestFacadeCompleteness:
    @pytest.mark.parametrize("name", CORE_MODULES)
    def test_every_declared_name_is_reachable_from_the_facade(self, name: str) -> None:
        """The whole point of the façade: no caller needs the submodule path."""
        module = _module(name)
        missing = [item for item in module.__all__ if not hasattr(core, item)]
        assert not missing, f"nova_studio.core does not re-export from {name}: {missing}"

    @pytest.mark.parametrize("name", CORE_MODULES)
    def test_every_declared_name_is_listed_in_the_facade_all(self, name: str) -> None:
        """``import *`` and static analysis both rely on ``__all__`` being complete."""
        module = _module(name)
        absent = [item for item in module.__all__ if item not in core.__all__]
        assert not absent, f"nova_studio.core.__all__ omits from {name}: {absent}"

    def test_facade_reexports_the_identical_object(self) -> None:
        """Re-export must bind the same object, not a look-alike copy."""
        assert core.Timebase is _module("temporal").Timebase
        assert core.EventBus is _module("events").EventBus
        assert core.ServiceContainer is _module("di").ServiceContainer
        assert core.NovaError is _module("errors").NovaError
        assert core.Command is _module("commands").Command
        assert core.ResultUnwrapError is _module("result").ResultUnwrapError


class TestFacadeHonesty:
    def test_all_is_sorted_and_unique(self) -> None:
        """Sorted so a diff shows one added line, not a reshuffled block.

        The expected order is isort-style (constants, then classes, then functions)
        because that is what ``ruff check --fix`` enforces via RUF022; comparing
        against a plain ``sorted()`` would disagree with the formatter.
        """
        assert len(core.__all__) == len(set(core.__all__)), "duplicate entries"
        assert core.__all__ == _isort_style_sort(core.__all__)

    def test_every_name_in_all_is_actually_importable(self) -> None:
        """``__all__`` must not advertise names that do not exist."""
        missing = [name for name in core.__all__ if not hasattr(core, name)]
        assert not missing, f"core.__all__ advertises absent names: {missing}"

    def test_star_import_binds_every_advertised_name(self) -> None:
        """Execute a real ``import *`` and verify the result."""
        namespace: dict[str, Any] = {}
        exec("from nova_studio.core import *", namespace)
        missing = [name for name in core.__all__ if name not in namespace]
        assert not missing, f"star-import did not bind: {missing}"

    def test_private_names_are_not_exported(self) -> None:
        assert not [name for name in core.__all__ if name.startswith("_")]


class TestStability:
    """Names already used across the codebase.  Removing one is a breaking change."""

    #: The load-bearing surface: mechanisms, value types and constructors.
    REQUIRED: frozenset[str] = frozenset(
        {
            # result / errors
            "Result",
            "Ok",
            "Err",
            "ResultUnwrapError",
            "ok",
            "err",
            "failed",
            "error_result",
            "collect",
            "collect_all",
            "unwrap_all",
            "catch_errors",
            "NovaError",
            "NovaInvariantError",
            "ErrorDomain",
            "ErrorSeverity",
            "ProblemDetail",
            # ident
            "EntityId",
            "ShortId",
            "IdFactory",
            "new_entity_id",
            "new_short_id",
            "is_valid_entity_id",
            "process_token",
            "random_suffix",
            # temporal
            "Timebase",
            "Timecode",
            "Rounding",
            "FrameCount",
            "SampleCount",
            "DEFAULT_TIMEBASE",
            "STANDARD_TIMEBASES",
            "timebase_from_fps",
            "frames_to_seconds",
            "seconds_to_frames",
            "frames_to_samples",
            # events
            "EventBus",
            "EventEnvelope",
            "EventPayload",
            "EventStatistics",
            "EventHandler",
            "Subscription",
            "DeliveryMode",
            "AsyncEventStream",
            # di
            "ServiceContainer",
            "ServiceScope",
            "Lifetime",
            "Registration",
            "Resolver",
            "ContainerError",
            "ResolutionError",
            "DependencyGraphError",
            # commands
            # clock
            "SystemClock",
            "MonotonicClock",
            "WallClock",
            "FixedClock",
            "DEFAULT_CLOCK",
            "wall_milliseconds",
            "monotonic_seconds",
            # commands
            "Command",
            "CommandContext",
            "CommandError",
            "CommandHistory",
            "CommandOutcome",
            "CommandRegistry",
            "CompositeCommand",
            "MemoryClass",
            "UndoScope",
            "UndoStack",
        }
    )

    @pytest.mark.parametrize("name", sorted(REQUIRED))
    def test_required_name_is_present(self, name: str) -> None:
        assert hasattr(core, name), f"{name} disappeared from the L1 public API"
        assert name in core.__all__, f"{name} is present but not advertised"

    def test_required_names_are_a_subset_of_the_facade(self) -> None:
        """Guards against a typo in REQUIRED silently weakening the test."""
        unknown = sorted(self.REQUIRED - set(core.__all__))
        assert not unknown, f"REQUIRED lists names the façade does not export: {unknown}"


class TestPortLayer:
    """L2 ports: declarations only, and no dependency on the outer rings."""

    @pytest.mark.parametrize("name", PORT_MODULES)
    def test_port_module_declares_an_explicit_api(self, name: str) -> None:
        module = importlib.import_module(f"nova_studio.ports.{name}")
        declared = getattr(module, "__all__", None)
        assert declared, f"nova_studio.ports.{name} must define __all__"
        assert len(declared) == len(set(declared))

    @pytest.mark.parametrize("name", PORT_MODULES)
    def test_port_module_exports_only_declarations(self, name: str) -> None:
        """A port that carries an implementation has stopped being a seam.

        Protocols and ABCs are the sanctioned contents; anything else — a concrete
        adapter, a module-level singleton, a helper that does work — belongs in
        ``infra`` or ``core``.
        """
        module = importlib.import_module(f"nova_studio.ports.{name}")
        for exported in module.__all__:
            obj = getattr(module, exported)
            assert isinstance(obj, type), f"{exported} is not a class"
            # A closed set of constants is a declaration too: `MediaErrorCode`
            # is the vocabulary an adapter must speak, and putting it beside the
            # protocol that consumes it is what stops `infra` inventing codes.
            is_declaration = (
                issubclass(obj, Protocol)
                or hasattr(obj, "__abstractmethods__")
                or (isinstance(obj, type) and issubclass(obj, Enum))
            )
            assert is_declaration, f"ports.{name}.{exported} must be a Protocol or an ABC"

    @pytest.mark.parametrize("name", PORT_MODULES)
    def test_port_module_imports_nothing_from_an_outer_ring(self, name: str) -> None:
        """Checked statically: ``ports`` may import ``core``, ``domain``, stdlib."""
        import ast

        source = pathlib.Path(
            importlib.import_module(f"nova_studio.ports.{name}").__file__
        ).read_text(encoding="utf-8")
        tree = ast.parse(source)
        forbidden = ("nova_studio.services", "nova_studio.infra", "nova_studio.api")
        third_party = ("pydantic", "av", "cv2", "fastapi", "sqlite3", "numpy")
        for node in ast.walk(tree):
            targets: list[str] = []
            if isinstance(node, ast.Import):
                targets = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                targets = [node.module]
            for target in targets:
                assert not target.startswith(forbidden), f"{name} imports {target}"
                assert target.split(".")[0] not in third_party, (
                    f"ports.{name} imports third-party {target}; a port signature "
                    "must not mention an adapter's types"
                )

    def test_the_clock_port_is_satisfied_by_the_l1_default(self) -> None:
        """The port and its default implementation must agree, structurally."""
        from nova_studio.core.clock import SystemClock
        from nova_studio.ports.clock import Clock

        assert isinstance(SystemClock(), Clock)

    def test_the_default_id_factory_satisfies_the_port(self) -> None:
        from nova_studio.core.ident import IdFactory
        from nova_studio.ports.ident import IdGenerator, IdSource

        factory = IdFactory()
        assert isinstance(factory, IdGenerator)
        assert isinstance(factory, IdSource)

    def test_the_port_is_narrower_than_the_generator(self) -> None:
        """A consumer that only mints entity ids need not provide short ids.

        Same narrow-first discipline as the clock protocols: ``runtime_checkable``
        only tests method presence, so the *hierarchy* — not behaviour — is what
        a test double is held to.
        """
        from nova_studio.ports.ident import IdGenerator, IdSource

        class _EntityIdsOnly:
            def new_entity_id(self) -> EntityId:
                raise NotImplementedError

        only = _EntityIdsOnly()
        assert isinstance(only, IdSource)
        assert not isinstance(only, IdGenerator)

    def test_l1_does_not_import_the_port(self) -> None:
        """L1 may not depend on L2, so ``core.clock`` cannot import ``ports.clock``."""
        import ast

        source = (pathlib.Path(core.__file__).parent / "clock.py").read_text(encoding="utf-8")
        for node in ast.walk(ast.parse(source)):
            modules: list[str] = []
            if isinstance(node, ast.Import):
                modules = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                modules = [node.module]
            for module in modules:
                assert not module.startswith("nova_studio.ports"), f"core/clock.py imports {module}"


class TestLayerPurity:
    """Belt and braces alongside ``scripts/check_layering.py``.

    The script inspects source text; these tests inspect the *loaded* module graph,
    which also catches a dependency pulled in transitively at import time — the kind
    of leak a textual scan cannot see.

    Each check runs in a fresh subprocess.  ``sys.modules`` is process-global, so
    inside a pytest session it already contains whatever earlier tests imported, and
    an in-process assertion would report a false failure the moment any other suite
    loaded an outer ring or a media library.
    """

    #: Code that prints the loaded module names after importing only L1.
    #: ``chr(10)`` is used rather than a ``"\n"`` literal so that no escaping level
    #: between this file and the child interpreter can corrupt the separator.
    _PROBE = "import sys, nova_studio.core; print(chr(10).join(sorted(sys.modules)))"

    #: The same measurement for an interpreter that imports nothing, giving the
    #: baseline every Python process starts from (``site``, ``codecs``, ...).
    _BASELINE_PROBE = "import sys; print(chr(10).join(sorted(sys.modules)))"

    def _run_probe(self, code: str) -> set[str]:
        import subprocess
        import sys

        completed = subprocess.run(
            [sys.executable, "-c", code],
            capture_output=True,
            text=True,
        )
        assert completed.returncode == 0, (
            f"probe failed ({completed.returncode}):\n{completed.stderr}"
        )
        return set(completed.stdout.splitlines())

    def _loaded_modules(self) -> set[str]:
        return self._run_probe(self._PROBE)

    def test_core_does_not_import_outer_rings(self) -> None:
        outer = (
            "nova_studio.domain",
            "nova_studio.ports",
            "nova_studio.services",
            "nova_studio.infra",
            "nova_studio.api",
        )
        loaded = self._loaded_modules()
        offenders = sorted(name for name in loaded if name.startswith(outer))
        assert not offenders, f"importing nova_studio.core pulled in outer rings: {offenders}"

    def test_core_imports_no_io_libraries(self) -> None:
        banned = {
            "av",
            "cv2",
            "sqlite3",
            "faster_whisper",
            "ctranslate2",
            "PIL",
            "fastapi",
            "uvicorn",
            "webview",
            "imageio_ffmpeg",
        }
        loaded = self._loaded_modules()
        offenders = sorted({name.split(".")[0] for name in loaded} & banned)
        assert not offenders, f"nova_studio.core pulled in I/O libraries: {offenders}"

    def test_core_stays_off_the_event_loop_and_network(self) -> None:
        """L1 provides its own threading; it must not drag in asyncio or sockets.

        The ban is on the *I/O-capable* modules specifically.  ``urllib.parse`` is
        pure string handling and arrives transitively via the stdlib (``uuid``), so
        banning the whole ``urllib`` package would produce a permanent false
        failure; ``urllib.request`` is what actually opens a connection.
        """
        loaded = self._loaded_modules()
        banned = {
            "asyncio",
            "socket",
            "ssl",
            "selectors",
            "http.client",
            "http.server",
            "urllib.request",
            "subprocess",
            "sqlite3",
        }
        offenders = sorted(
            name for name in loaded if name in banned or name.split(".")[0] in banned
        )
        assert not offenders, f"nova_studio.core pulled in I/O or loop machinery: {offenders}"

    def test_the_module_budget_stays_small(self) -> None:
        """A regression tripwire on the L1 import footprint.

        Importing the kernel used to cost 203 modules and ~150 ms because
        ``events`` imported pydantic at module scope; after making it lazy the cost
        is ~50 modules.  Every render worker and plugin host pays this on startup,
        so the budget is worth an explicit assertion.  The ceiling has headroom for
        genuine growth — it exists to catch a heavy transitive import, not to police
        a handful of new modules.
        """
        loaded = self._loaded_modules()
        baseline = self._run_probe(self._BASELINE_PROBE)
        added = loaded - baseline
        assert len(added) < 90, (
            f"importing nova_studio.core added {len(added)} modules over the "
            f"interpreter baseline; a heavy dependency has crept into L1. "
            f"Sample: {sorted(added)[:20]}"
        )

    def test_the_pydantic_boundary_is_not_crossed(self) -> None:
        """The specific regression the budget above exists to catch.

        ``events`` used to import ``pydantic`` at module scope for a single
        ``isinstance`` check.  That one line pulled ~150 modules into every process
        that touched the kernel, including ``socket``, ``ssl`` and ``subprocess``.
        """
        loaded = self._loaded_modules()
        offenders = sorted(name for name in loaded if name.split(".")[0] == "pydantic")
        assert not offenders, f"nova_studio.core imports pydantic: {offenders[:10]}"

    def test_facade_import_is_cheap(self) -> None:
        """L1 is imported by every process, including short-lived CLI ones.

        The ceiling is deliberately generous: the intent is to catch a heavy
        transitive import (numpy is acceptable, OpenCV or PyAV would not be), not to
        police milliseconds on a busy CI machine.
        """
        import subprocess
        import sys
        import time

        start = time.perf_counter()
        completed = subprocess.run(
            [sys.executable, "-c", "import nova_studio.core"],
            capture_output=True,
            check=True,
        )
        elapsed = time.perf_counter() - start
        assert completed.returncode == 0
        assert elapsed < 5.0, f"importing nova_studio.core took {elapsed:.2f}s"

    def test_the_distribution_carries_a_type_marker(self) -> None:
        """PEP 561: without ``py.typed`` consumers lose every annotation.

        The marker belongs at the *distribution* root (``nova_studio/py.typed``),
        which marks the whole package tree as typed — one per subpackage is not
        required and would not be picked up by the packaging configuration.
        """
        marker = pathlib.Path(core.__file__).parent.parent / "py.typed"
        assert marker.is_file(), "nova_studio/py.typed is missing"
        assert marker.stat().st_size == 0, "py.typed must be an empty marker file"
