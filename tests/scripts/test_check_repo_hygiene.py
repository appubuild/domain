"""`scripts/check_repo_hygiene.py` — the gate that keeps git small forever.

Git never forgets, so this is the one check whose failures get more expensive
with time rather than less. What is worth pinning:

* **The allowlist is a justification, not a silencer.** Every entry names a file
  that exists and says why; an entry for a file that has since been deleted is a
  rule nobody is enforcing, and an entry with no reason is a shrug.
* **The thresholds are real.** A file over the limit is flagged, and an
  allowlisted one is not — including the two prose documents that are exempt
  today, so the exemption is a decision on the record rather than a side effect.
* **A known gap is traceable.** A `TODO` without an issue reference is a gap
  nobody can find again, which is why the marker check exists at all.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from scripts import check_repo_hygiene

REPO_ROOT: Path = Path(__file__).resolve().parent.parent.parent

pytestmark = pytest.mark.unit


class TestAllowlist:
    def test_every_entry_names_a_file_that_exists(self) -> None:
        """An entry for a path that is gone is a rule nothing is enforcing."""
        missing = [
            path for path in check_repo_hygiene.ALLOWLIST if not (REPO_ROOT / path).is_file()
        ]
        assert missing == []

    def test_every_entry_carries_a_written_reason(self) -> None:
        """The check's own message asks for a justification; the code must keep it."""
        for path, reason in check_repo_hygiene.ALLOWLIST.items():
            assert reason.strip(), path
            assert len(reason) > 40, f"{path}: '{reason}' is a shrug, not a justification"

    def test_the_limit_is_a_whole_number_of_kibibytes(self) -> None:
        """64 KiB reads as a deliberate threshold; 65,000 bytes reads as an accident."""
        assert check_repo_hygiene.MAX_BINARY_BYTES == 64 * 1024

    def test_listing_the_allowlist_exits_zero(self, capsys: Any) -> None:
        """`--list-allowlisted` is how a reviewer asks why a file is here."""
        assert check_repo_hygiene.main(["--list-allowlisted"]) == 0
        out = capsys.readouterr().out
        for path in check_repo_hygiene.ALLOWLIST:
            assert path in out


class TestSizeCheck:
    def test_a_file_over_the_limit_is_flagged(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        big = tmp_path / "big.md"
        big.write_text("x" * (check_repo_hygiene.MAX_BINARY_BYTES + 1), encoding="utf-8")
        monkeypatch.setattr(check_repo_hygiene, "REPO_ROOT", tmp_path)
        findings = check_repo_hygiene.check_sizes(["big.md"])
        assert [item.kind for item in findings] == ["oversize"]
        assert findings[0].path == "big.md"
        assert "exceeds" in findings[0].detail

    def test_an_allowlisted_file_is_not_flagged(self) -> None:
        """Today's two exemptions: prose, and only prose."""
        for path in (
            "docs/architecture/media-and-rendering.md",
            "docs/architecture/services.md",
            "docs/architecture/api-contract.json",
        ):
            assert path in check_repo_hygiene.ALLOWLIST
            assert check_repo_hygiene.check_sizes([path]) == []

    def test_a_small_file_is_not_flagged(self) -> None:
        assert check_repo_hygiene.check_sizes(["README.md"]) == []

    def test_a_vanished_path_is_not_a_finding(self) -> None:
        """`check_sizes` reads the index; a deleted file is git's business, not this."""
        assert check_repo_hygiene.check_sizes(["docs/does-not-exist.md"]) == []

    def test_the_frontend_build_output_is_never_tracked(self) -> None:
        """`frontend/dist` is in .gitignore; a committed bundle is the exact drift
        this check exists to catch."""
        tracked = check_repo_hygiene.tracked_files()
        assert not [path for path in tracked if path.startswith("frontend/dist/")]
        assert not [path for path in tracked if "node_modules" in path]


class TestExtensionCheck:
    def test_a_banned_extension_is_flagged(self) -> None:
        findings = check_repo_hygiene.check_extensions(["media/fixture.mp4"])
        assert [item.kind for item in findings] == ["banned-extension"]

    def test_a_source_file_is_not_flagged(self) -> None:
        assert check_repo_hygiene.check_extensions(["nova_studio/core/result.py"]) == []


class TestMarkerCheck:
    def test_a_marker_without_an_issue_reference_is_flagged(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        (tmp_path / "nova_studio").mkdir()
        (tmp_path / "nova_studio" / "thing.py").write_text("def f() -> None:  # TODO: fix\n")
        monkeypatch.setattr(check_repo_hygiene, "REPO_ROOT", tmp_path)
        findings = check_repo_hygiene.check_markers()
        assert [item.kind for item in findings] == ["untracked-marker"]
        assert "TODO" in findings[0].detail

    def test_a_marker_with_an_issue_reference_is_allowed(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        (tmp_path / "nova_studio").mkdir()
        (tmp_path / "nova_studio" / "thing.py").write_text("def f() -> None:  # TODO(#1234): fix\n")
        monkeypatch.setattr(check_repo_hygiene, "REPO_ROOT", tmp_path)
        assert check_repo_hygiene.check_markers() == []


class TestScanAndSummarise:
    def test_the_tree_is_clean(self) -> None:
        """The gate this repository promises: `make hygiene` passes."""
        assert check_repo_hygiene.scan() == []

    def test_findings_are_counted_by_kind(self) -> None:
        findings = [
            check_repo_hygiene.Finding(kind="oversize", path="a", detail=""),
            check_repo_hygiene.Finding(kind="marker", path="b", detail=""),
            check_repo_hygiene.Finding(kind="oversize", path="c", detail=""),
        ]
        assert check_repo_hygiene.summarise(findings) == {"marker": 1, "oversize": 2}

    def test_a_formatted_finding_leads_with_its_kind(self) -> None:
        finding = check_repo_hygiene.Finding(kind="oversize", path="a/b.md", detail="too big")
        assert finding.format() == "[oversize] a/b.md: too big"
