"""Tests for the architectural layering checker.

A gate that is not itself tested silently rots: the day it starts passing
everything, nobody notices.  These tests build a synthetic package tree containing
known violations and assert each rule fires, then assert the real package is clean.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any

import pytest

_SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "check_layering.py"


def _load_checker() -> Any:
    """Import ``scripts/check_layering.py`` as a module.

    ``scripts`` is not a package, so it is loaded by path.  Cached after the first
    call so the suite does not re-parse the script per test.
    """
    cached = sys.modules.get("nova_check_layering")
    if cached is not None:
        return cached
    spec = importlib.util.spec_from_file_location("nova_check_layering", _SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["nova_check_layering"] = module
    spec.loader.exec_module(module)
    return module


checker = _load_checker()

pytestmark = pytest.mark.unit


def _build_tree(root: Path, files: dict[str, str]) -> Path:
    """Materialise a synthetic ``nova_studio`` package and return its path."""
    package = root / "nova_studio"
    for relative, source in files.items():
        target = package / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(source, encoding="utf-8")
    (package / "__init__.py").write_text("", encoding="utf-8")
    return package


def _rules(violations: list[Any]) -> set[str]:
    return {violation.rule for violation in violations}


class TestRingDirection:
    def test_core_may_not_import_domain(self, tmp_path: Path) -> None:
        package = _build_tree(
            tmp_path,
            {"core/bad.py": "from nova_studio.domain import timeline\n"},
        )
        violations = checker.scan(package)
        assert "ring-direction" in _rules(violations)
        assert "dependencies point inward" in violations[0].message

    def test_core_may_not_import_infra(self, tmp_path: Path) -> None:
        package = _build_tree(tmp_path, {"core/bad.py": "import nova_studio.infra.media\n"})
        assert "ring-direction" in _rules(checker.scan(package))

    def test_domain_may_not_import_services(self, tmp_path: Path) -> None:
        package = _build_tree(
            tmp_path, {"domain/bad.py": "from nova_studio.services.render import engine\n"}
        )
        assert "ring-direction" in _rules(checker.scan(package))

    def test_services_may_not_import_api(self, tmp_path: Path) -> None:
        package = _build_tree(
            tmp_path, {"services/render/bad.py": "import nova_studio.api.routers\n"}
        )
        assert "ring-direction" in _rules(checker.scan(package))

    def test_inward_imports_are_allowed(self, tmp_path: Path) -> None:
        """The legal direction: L4 → L3 → L2 → L1."""
        package = _build_tree(
            tmp_path,
            {
                "core/base.py": "import dataclasses\n",
                "domain/entity.py": "from nova_studio.core.temporal import Timebase\n",
                "ports/media.py": "from nova_studio.domain.entity import Asset\n",
                "services/render/engine.py": "from nova_studio.ports.media import Decoder\n",
                "infra/media/pyav.py": "from nova_studio.services.render.engine import Planner\n",
                "api/routers/timeline.py": "from nova_studio.services.render.engine import Engine\n",
            },
        )
        assert checker.scan(package) == []

    def test_same_ring_import_is_allowed(self, tmp_path: Path) -> None:
        """``domain`` and ``ports`` are both L2 and may reference each other."""
        package = _build_tree(
            tmp_path,
            {
                "domain/entity.py": "from nova_studio.ports.media import Decoder\n",
                "ports/media.py": "from nova_studio.domain.entity import Asset\n",
            },
        )
        assert "ring-direction" not in _rules(checker.scan(package))


class TestBannedIo:
    @pytest.mark.parametrize(
        ("module_path", "library"),
        [
            ("services/render/engine.py", "av"),
            ("services/captions/pipeline.py", "faster_whisper"),
            ("domain/media.py", "cv2"),
            ("services/media/thumbs.py", "PIL"),
            ("core/cache.py", "sqlite3"),
            ("services/export/manager.py", "imageio_ffmpeg"),
        ],
    )
    def test_io_libraries_outside_infra_are_rejected(
        self, tmp_path: Path, module_path: str, library: str
    ) -> None:
        package = _build_tree(tmp_path, {module_path: f"import {library}\n"})
        violations = [item for item in checker.scan(package) if item.rule == "banned-io"]
        assert violations, f"{library} in {module_path} should be rejected"
        assert library in violations[0].message

    def test_infra_may_use_io_libraries(self, tmp_path: Path) -> None:
        package = _build_tree(
            tmp_path,
            {
                "infra/media/decoder.py": "import av\nimport cv2\nimport imageio_ffmpeg\n",
                "infra/persistence/db.py": "import sqlite3\n",
                "infra/asr/whisper.py": "import faster_whisper\nfrom PIL import Image\n",
            },
        )
        assert checker.scan(package) == []

    def test_api_may_use_fastapi(self, tmp_path: Path) -> None:
        package = _build_tree(tmp_path, {"api/routers/projects.py": "import fastapi\n"})
        assert checker.scan(package) == []

    def test_services_may_not_use_fastapi(self, tmp_path: Path) -> None:
        """A service that knows about the web framework cannot be reused headless."""
        package = _build_tree(tmp_path, {"services/projects/service.py": "import fastapi\n"})
        assert "banned-io" in _rules(checker.scan(package))

    def test_pydantic_is_confined_to_the_wire_boundary(self, tmp_path: Path) -> None:
        """Pydantic in the kernel costs every worker ~150 modules at import.

        It is not an I/O library, but importing it transitively loads ``socket``,
        ``ssl`` and ``subprocess``, so it is confined to L4 where the DTOs live.
        """
        package = _build_tree(
            tmp_path,
            {
                "core/events.py": "from pydantic import BaseModel\n",
                "domain/entity.py": "from pydantic import BaseModel\n",
                "services/render/engine.py": "import pydantic\n",
            },
        )
        violations = [item for item in checker.scan(package) if item.rule == "banned-io"]
        offenders = {violation.file.rsplit("/", maxsplit=2)[-2] for violation in violations}
        assert offenders == {"core", "domain", "render"}
        # core additionally breaches its own purity rule.  The reported name is the
        # deepest one (`pydantic.BaseModel`) because `_deduplicate` keeps the most
        # specific diagnosis for a `from X import Y` statement.
        purity = [item for item in checker.scan(package) if item.rule == "core-purity"]
        assert len(purity) == 1
        assert purity[0].importer == "nova_studio.core.events"
        assert purity[0].imported.startswith("pydantic")

    def test_pydantic_is_allowed_in_api_and_infra(self, tmp_path: Path) -> None:
        package = _build_tree(
            tmp_path,
            {
                "api/dto/project.py": "from pydantic import BaseModel\n",
                "infra/persistence/models.py": "from pydantic import BaseModel, ConfigDict\n",
            },
        )
        assert checker.scan(package) == []

    def test_numpy_is_allowed_everywhere(self, tmp_path: Path) -> None:
        """NumPy is the frame-buffer representation, not an I/O library."""
        package = _build_tree(
            tmp_path,
            {
                "domain/media.py": "import numpy\n",
                "services/render/engine.py": "import numpy\n",
                "core/buffer.py": "import numpy\n",
            },
        )
        assert checker.scan(package) == []


class TestPurity:
    @pytest.mark.parametrize(
        "library",
        ["sqlite3", "socket", "subprocess", "urllib", "http", "asyncio", "threading"],
    )
    def test_domain_rejects_io_and_concurrency(self, tmp_path: Path, library: str) -> None:
        package = _build_tree(tmp_path, {"domain/bad.py": f"import {library}\n"})
        violations = [item for item in checker.scan(package) if item.rule == "domain-purity"]
        assert violations, f"{library} must be rejected in domain"
        assert "inject a port" in violations[0].message

    def test_core_rejects_io_but_allows_threading(self, tmp_path: Path) -> None:
        """The event bus is threaded by design; sockets and SQL are not."""
        package = _build_tree(
            tmp_path,
            {
                "core/bus.py": "import threading\n",
                "core/bad.py": "import socket\nimport sqlite3\n",
            },
        )
        rules = {
            (violation.file.rsplit("/", maxsplit=1)[-1], violation.imported)
            for violation in checker.scan(package)
            if violation.rule == "core-purity"
        }
        assert ("bad.py", "socket") in rules
        assert ("bad.py", "sqlite3") in rules
        assert not any(name == "bus.py" for name, _ in rules)


class TestFeatureIsolation:
    def test_sibling_service_features_may_not_import_each_other(self, tmp_path: Path) -> None:
        package = _build_tree(
            tmp_path,
            {
                "services/render/engine.py": "x = 1\n",
                "services/captions/pipeline.py": "from nova_studio.services.render import engine\n",
            },
        )
        violations = [item for item in checker.scan(package) if item.rule == "feature-isolation"]
        assert violations
        assert "independently replaceable" in violations[0].message

    def test_a_feature_may_import_itself(self, tmp_path: Path) -> None:
        package = _build_tree(
            tmp_path,
            {
                "services/render/engine.py": "x = 1\n",
                "services/render/planner.py": "from nova_studio.services.render import engine\n",
            },
        )
        assert "feature-isolation" not in _rules(checker.scan(package))

    def test_shared_kernel_is_importable(self, tmp_path: Path) -> None:
        package = _build_tree(
            tmp_path,
            {
                "services/shared/units.py": "x = 1\n",
                "services/render/engine.py": "from nova_studio.services.shared import units\n",
            },
        )
        assert "feature-isolation" not in _rules(checker.scan(package))

    def test_features_collaborate_through_ports(self, tmp_path: Path) -> None:
        """The sanctioned alternative to a cross-feature import."""
        package = _build_tree(
            tmp_path,
            {
                "ports/render.py": "class FrameSink:\n    pass\n",
                "services/render/engine.py": "from nova_studio.ports.render import FrameSink\n",
                "services/captions/overlay.py": "from nova_studio.ports.render import FrameSink\n",
            },
        )
        assert checker.scan(package) == []


class TestRelativeImports:
    def test_escaping_relative_import_is_rejected(self, tmp_path: Path) -> None:
        """``level`` counts the containing package as level 1.

        ``nova_studio.core.deep.nested.bad`` has 5 dotted parts, so its containing
        package is ``nova_studio.core.deep.nested``.  Level 4 therefore resolves to
        ``nova_studio`` — the deepest legal climb.  Level 5 lands on a *top-level*
        ``domain`` outside the package, which would hide the dependency from the
        graph, so it is rejected.
        """
        package = _build_tree(
            tmp_path, {"core/deep/nested/bad.py": "from .....domain import timeline\n"}
        )
        violations = [item for item in checker.scan(package) if item.rule == "relative-escape"]
        assert len(violations) == 1
        assert violations[0].importer == "nova_studio.core.deep.nested.bad"

    def test_deeper_escape_is_also_rejected(self, tmp_path: Path) -> None:
        package = _build_tree(
            tmp_path, {"core/deep/nested/bad.py": "from .......domain import timeline\n"}
        )
        assert "relative-escape" in _rules(checker.scan(package))

    def test_relative_import_up_to_the_package_root_is_allowed(self, tmp_path: Path) -> None:
        package = _build_tree(
            tmp_path, {"core/deep/nested/ok.py": "from ....domain import timeline\n"}
        )
        assert "relative-escape" not in _rules(checker.scan(package))

    def test_local_relative_import_is_allowed(self, tmp_path: Path) -> None:
        package = _build_tree(
            tmp_path,
            {
                "core/a.py": "x = 1\n",
                "core/deep/b.py": "from . import a\nfrom ..temporal import Timebase\n",
            },
        )
        assert "relative-escape" not in _rules(checker.scan(package))


class TestDeduplication:
    def test_a_from_import_reports_once(self, tmp_path: Path) -> None:
        """``from X import Y`` yields two names but must produce one finding."""
        package = _build_tree(
            tmp_path, {"core/bad.py": "from nova_studio.domain.timeline import Clip\n"}
        )
        violations = [item for item in checker.scan(package) if item.rule == "ring-direction"]
        assert len(violations) == 1
        assert violations[0].imported == "nova_studio.domain.timeline.Clip", (
            "the most specific name must be the one reported"
        )

    def test_distinct_rules_on_one_line_are_all_reported(self, tmp_path: Path) -> None:
        package = _build_tree(tmp_path, {"domain/bad.py": "import sqlite3\n"})
        assert _rules(checker.scan(package)) >= {"banned-io", "domain-purity"}


class TestCompositionRoot:
    """The CLI wires the rings together, so it sits outside them.

    The exemption must stay narrow: if it covered subpackages, moving an I/O import
    up one directory would be enough to hide it from the gate.
    """

    def test_the_cli_may_import_any_ring(self, tmp_path: Path) -> None:
        package = _build_tree(
            tmp_path,
            {
                "cli.py": (
                    "from nova_studio.core import EventBus\n"
                    "from nova_studio.domain import timeline\n"
                    "from nova_studio.services.render import engine\n"
                    "from nova_studio.infra.media import decoder\n"
                    "from nova_studio.api import app\n"
                ),
            },
        )
        violations = [item for item in checker.scan(package) if item.rule == "ring-direction"]
        assert not violations

    def test_the_cli_may_use_subprocess(self, tmp_path: Path) -> None:
        """It shells out to the gate scripts, which no ring module may do."""
        package = _build_tree(
            tmp_path, {"cli.py": "import subprocess\nimport sqlite3\nimport av\n"}
        )
        assert checker.scan(package) == []

    def test_the_module_entry_point_is_exempt_too(self, tmp_path: Path) -> None:
        package = _build_tree(tmp_path, {"__main__.py": "import subprocess\nimport av\n"})
        assert checker.scan(package) == []

    def test_the_exemption_does_not_extend_to_subpackages(self, tmp_path: Path) -> None:
        """Moving a banned import one directory down must not launder it."""
        package = _build_tree(tmp_path, {"core/cli.py": "import subprocess\nimport av\n"})
        rules = {item.rule for item in checker.scan(package)}
        assert "core-purity" in rules
        assert "banned-io" in rules

    def test_exemption_covers_only_the_declared_modules(self, tmp_path: Path) -> None:
        package = _build_tree(tmp_path, {"launcher.py": "import av\n"})
        assert any(item.rule == "banned-io" for item in checker.scan(package))

    def test_composition_root_is_an_explicit_allowlist(self) -> None:
        """Not a pattern match — a named set that must be edited deliberately."""
        assert frozenset({"nova_studio.cli", "nova_studio.__main__"}) == checker.COMPOSITION_ROOT
        assert checker._is_composition_root("nova_studio.cli")
        assert not checker._is_composition_root("nova_studio.core.cli")
        assert not checker._is_composition_root("nova_studio.cli.helper")


class TestReporting:
    def test_summary_counts_per_rule(self, tmp_path: Path) -> None:
        package = _build_tree(
            tmp_path,
            {
                "core/bad.py": "from nova_studio.domain import timeline\n",
                "domain/worse.py": "import av\n",
            },
        )
        summary = checker.summarise(checker.scan(package))
        assert summary["ring-direction"] == 1
        assert summary["banned-io"] == 1

    def test_violation_format_is_actionable(self, tmp_path: Path) -> None:
        """The rendered form must let a reader find and fix the breach."""
        package = _build_tree(tmp_path, {"core/bad.py": "import sqlite3\n"})
        violations = checker.scan(package)
        # One statement breaches two rules; both are legitimate findings and the
        # report must not silently drop either.
        assert {item.rule for item in violations} == {"banned-io", "core-purity"}
        rendered = violations[0].format()
        assert rendered.startswith(str(package))
        assert ":1: [" in rendered
        assert "nova_studio.core.bad" in rendered
        assert "ADR-" in rendered

    def test_json_mode_is_machine_readable(self, tmp_path: Path, capsys: Any) -> None:
        package = _build_tree(tmp_path, {"core/bad.py": "import sqlite3\n"})
        exit_code = checker.main(["--root", str(package), "--json"])
        assert exit_code == 1
        import json

        payload = json.loads(capsys.readouterr().out)
        assert payload["count"] == 2
        assert payload["summary"] == {"banned-io": 1, "core-purity": 1}
        assert {item["rule"] for item in payload["violations"]} == {
            "banned-io",
            "core-purity",
        }
        first = payload["violations"][0]
        assert set(first) == {
            "rule",
            "file",
            "line",
            "importer",
            "imported",
            "message",
        }

    def test_clean_tree_exits_zero(self, tmp_path: Path, capsys: Any) -> None:
        package = _build_tree(tmp_path, {"core/good.py": "import dataclasses\n"})
        assert checker.main(["--root", str(package)]) == 0
        assert "layering: OK" in capsys.readouterr().out

    def test_explain_mode_prints_the_rules(self, capsys: Any) -> None:
        assert checker.main(["--explain"]) == 0
        output = capsys.readouterr().out
        assert "ADR-0002" in output or "Ring direction" in output

    def test_syntax_error_is_reported_not_crashing(self, tmp_path: Path) -> None:
        package = _build_tree(tmp_path, {"core/broken.py": "def (:\n"})
        violations = checker.scan(package)
        assert any(item.rule == "syntax" for item in violations)


class TestRealPackage:
    def test_the_repository_passes_its_own_gate(self) -> None:
        """The gate must be green on the code it governs."""
        assert checker.scan() == []

    def test_the_package_exists(self) -> None:
        assert checker.PACKAGE_ROOT.is_dir()
        assert (checker.PACKAGE_ROOT / "core" / "temporal.py").is_file()
