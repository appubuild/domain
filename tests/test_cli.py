"""Tests for the command-line entry point.

The CLI is a public contract: packaging invokes ``doctor`` to decide whether a
build is shippable, and a contributor invokes ``layering`` after a refactor.  Its
exit codes and its JSON are therefore load-bearing, not cosmetic — a script that
has to parse a human-readable message to know whether it succeeded is a script
that breaks silently.
"""

from __future__ import annotations

import dataclasses
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest

import nova_studio
from nova_studio.cli import (
    DATA_DIR_ENV,
    OPTIONAL_COMPONENTS,
    REQUIRED_COMPONENTS,
    DiagnosticReport,
    build_parser,
    collect_report,
    main,
)

pytestmark = pytest.mark.unit


class TestVersion:
    def test_plain_output_is_just_the_version(self, capsys: Any) -> None:
        """Parsable by ``$(nova-studio version)`` with no post-processing."""
        assert main(["version"]) == 0
        assert capsys.readouterr().out.strip() == nova_studio.__version__

    def test_json_output_is_valid_and_complete(self, capsys: Any) -> None:
        assert main(["version", "--json"]) == 0
        payload = json.loads(capsys.readouterr().out)
        assert payload == {
            "version": nova_studio.__version__,
            "project_format_version": nova_studio.PROJECT_FORMAT_VERSION,
            "database_schema_version": nova_studio.DATABASE_SCHEMA_VERSION,
            "ws_protocol_version": nova_studio.WS_PROTOCOL_VERSION,
            "python": payload["python"],
        }

    def test_format_versions_are_positive_integers(self) -> None:
        """A format version of 0 would make every migration check ambiguous."""
        assert nova_studio.PROJECT_FORMAT_VERSION >= 1
        assert nova_studio.DATABASE_SCHEMA_VERSION >= 1
        assert nova_studio.WS_PROTOCOL_VERSION >= 1

    def test_flag_form_matches_the_subcommand(self, capsys: Any) -> None:
        with pytest.raises(SystemExit) as caught:
            main(["--version"])
        assert caught.value.code == 0
        assert nova_studio.__version__ in capsys.readouterr().out


class TestUsageErrors:
    def test_no_subcommand_prints_help_and_exits_two(self, capsys: Any) -> None:
        """Silently doing nothing would leave a launcher hanging on a guess."""
        assert main([]) == 2
        captured = capsys.readouterr()
        assert "usage:" in captured.out
        assert "doctor" in captured.out

    def test_unknown_subcommand_exits_two(self, capsys: Any) -> None:
        with pytest.raises(SystemExit) as caught:
            main(["frobnicate"])
        assert caught.value.code == 2
        assert "invalid choice" in capsys.readouterr().err

    def test_parser_help_names_every_subcommand(self, capsys: Any) -> None:
        with pytest.raises(SystemExit):
            build_parser().parse_args(["--help"])
        output = capsys.readouterr().out
        for command in ("version", "doctor", "layering"):
            assert command in output


class TestDataDirectory:
    def test_environment_override_wins_and_is_reported_as_such(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The portable build depends on this: data must sit beside the executable."""
        monkeypatch.setenv(DATA_DIR_ENV, "/tmp/nova-test-data")
        report = collect_report()
        assert report.data_dir == "/tmp/nova-test-data"
        assert report.data_dir_from_env is True

    def test_override_is_expanded(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv(DATA_DIR_ENV, "~/nova-test-data")
        assert not collect_report().data_dir.startswith("~")

    def test_platform_default_is_absolute(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv(DATA_DIR_ENV, raising=False)
        report = collect_report()
        assert report.data_dir_from_env is False
        assert Path(report.data_dir).is_absolute()

    def test_each_platform_gets_its_own_convention(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Writing into the wrong platform directory scatters a user's state."""
        monkeypatch.delenv(DATA_DIR_ENV, raising=False)
        monkeypatch.delenv("XDG_DATA_HOME", raising=False)
        monkeypatch.delenv("LOCALAPPDATA", raising=False)
        seen: dict[str, str] = {}
        for system in ("Windows", "Darwin", "Linux"):
            monkeypatch.setattr("platform.system", lambda _s=system: _s)
            seen[system] = collect_report().data_dir
        assert len(set(seen.values())) == 3, seen
        assert "NovaStudio" in seen["Windows"]
        assert "Library" in seen["Darwin"]

    def test_xdg_is_respected_on_linux(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv(DATA_DIR_ENV, raising=False)
        monkeypatch.setattr("platform.system", lambda: "Linux")
        monkeypatch.setenv("XDG_DATA_HOME", "/tmp/xdg-data")
        assert collect_report().data_dir == "/tmp/xdg-data/nova-studio"


class TestDoctor:
    def test_exit_code_reflects_usability(self) -> None:
        report = collect_report()
        assert main(["doctor"]) == (0 if report.usable else 1)

    def test_json_report_is_valid_and_self_consistent(self, capsys: Any) -> None:
        assert main(["doctor", "--json"]) in (0, 1)
        payload = json.loads(capsys.readouterr().out)
        assert payload["version"] == nova_studio.__version__
        assert isinstance(payload["components"], list)
        assert payload["usable"] == (not payload["missing_required"])
        assert set(payload) == {
            "version",
            "project_format_version",
            "database_schema_version",
            "python",
            "implementation",
            "platform",
            "frozen",
            "data_dir",
            "data_dir_from_env",
            "kernel_modules_added",
            "kernel_baseline_modules",
            "components",
            "ffmpeg",
            "missing_required",
            "usable",
        }

    def test_json_preserves_non_ascii(self, capsys: Any) -> None:
        main(["doctor", "--json"])
        raw = capsys.readouterr().out
        assert "\\u2014" not in raw, "em-dashes must not be escaped in the report"

    def test_every_optional_component_is_reported(self) -> None:
        report = collect_report()
        names = [item.name for item in report.components]
        assert names == [name for name, _, _ in OPTIONAL_COMPONENTS]

    def test_component_names_are_unique(self) -> None:
        names = [name for name, _, _ in OPTIONAL_COMPONENTS]
        assert len(names) == len(set(names))

    def test_required_components_are_a_subset_of_the_probed_ones(self) -> None:
        """A required component nobody probes would never be reported missing."""
        probed = {name for name, _, _ in OPTIONAL_COMPONENTS}
        assert probed >= REQUIRED_COMPONENTS

    def test_missing_required_makes_the_report_unusable(self) -> None:
        """``usable`` must be derived from ``missing_required``, not tracked separately."""
        report = collect_report()
        assert report.usable is True, "this environment should be complete"
        broken = dataclasses.replace(report, missing_required=("numpy",))
        assert broken.usable is False
        # And the exit code must follow, or packaging would ship a broken build.
        assert DiagnosticReport.to_dict(broken)["usable"] is False

    def test_kernel_footprint_is_measured_not_guessed(self) -> None:
        """The number comes from a child interpreter, so it is a real measurement."""
        report = collect_report()
        assert report.kernel_modules_added > 0, "footprint probe failed"
        assert report.kernel_baseline_modules > 0, "baseline probe failed"
        assert report.kernel_modules_added < 120, (
            f"L1 import footprint regressed to {report.kernel_modules_added} modules"
        )

    def test_text_report_leads_with_the_verdict(self, capsys: Any) -> None:
        main(["doctor"])
        output = capsys.readouterr()
        text = output.out + output.err
        assert "Nova Studio" in text
        assert ("usable" in text) or ("NOT USABLE" in text)

    def test_doctor_does_not_import_the_media_stack(self, capsys: Any) -> None:
        """A diagnostic that loads OpenCV to report on OpenCV is slow and fragile."""
        import sys

        before = set(sys.modules)
        main(["doctor", "--json"])
        capsys.readouterr()
        newly = set(sys.modules) - before
        heavy = {name for name in newly if name.split(".")[0] in {"av", "cv2", "PIL"}}
        assert not heavy, f"doctor imported {sorted(heavy)}"


class TestLayeringSubcommand:
    def test_delegates_to_the_gate_script(self) -> None:
        """Exits 0 on a clean tree; the script itself is tested in tests/scripts."""
        assert main(["layering"]) == 0

    def test_human_readable_output_confirms_a_clean_tree(self) -> None:
        completed = self._run_module("layering")
        assert completed.returncode == 0, completed.stderr
        assert "layering: OK" in completed.stdout

    def _run_module(self, *argv: str) -> subprocess.CompletedProcess[str]:
        """Run the CLI in a child process.

        ``layering`` delegates to ``scripts/check_layering.py`` via ``subprocess``,
        and a child's stdout bypasses pytest's ``capsys`` entirely — it goes to the
        real descriptor.  Capturing the child is the only way to assert on what the
        flag actually produced.
        """
        return subprocess.run(
            [sys.executable, "-m", "nova_studio", *argv],
            capture_output=True,
            text=True,
            check=False,
        )

    def test_explain_flag_is_forwarded(self) -> None:
        """``--explain`` must reach the script, and its text must cover every rule.

        The explanation is what a contributor reads at the moment of failure, so a
        rule that is enforced but not described is a rule they cannot fix without
        reading the source.
        """
        completed = self._run_module("layering", "--explain")
        assert completed.returncode == 0, completed.stderr
        output = completed.stdout
        for expected in (
            "Ring direction",
            "Banned modules",
            "Ring purity",
            "Feature isolation",
            "Framework-free",
            "relative imports",
            "ADR-0002",
        ):
            assert expected in output, f"--explain no longer documents {expected!r}"

    def test_json_flag_produces_valid_json(self) -> None:
        """Packaging and CI consume this stream, so it must be parseable verbatim."""
        completed = self._run_module("layering", "--json")
        assert completed.returncode == 0, completed.stderr
        payload = json.loads(completed.stdout)
        assert payload["count"] == 0
        assert payload["violations"] == []
        assert payload["summary"] == {}

    def test_reports_unavailable_when_the_script_is_absent(
        self, monkeypatch: pytest.MonkeyPatch, capsys: Any, tmp_path: Path
    ) -> None:
        """A frozen build ships no scripts directory; that must be said, not crashed.

        Exit code 2 (usage/unavailable) rather than 1 (gate failed): a missing gate
        is not the same claim as a breached one, and CI must be able to tell them
        apart.
        """
        fake_root = tmp_path / "install"
        (fake_root / "nova_studio").mkdir(parents=True)
        monkeypatch.setattr("nova_studio.cli.__file__", str(fake_root / "nova_studio" / "cli.py"))
        assert main(["layering"]) == 2
        message = capsys.readouterr().err
        assert "unavailable" in message
        assert "frozen build" in message


class TestModuleEntryPoint:
    def test_python_dash_m_runs_the_cli(self) -> None:
        """``python -m nova_studio`` and the console script must not diverge."""
        completed = subprocess.run(
            [sys.executable, "-m", "nova_studio", "version"],
            capture_output=True,
            text=True,
            check=True,
            env={**os.environ},
        )
        assert completed.stdout.strip() == nova_studio.__version__

    def test_console_script_entry_point_resolves(self) -> None:
        """The name declared in pyproject.toml must exist and be callable."""
        import importlib

        module = importlib.import_module("nova_studio.cli")
        assert callable(module.main)
