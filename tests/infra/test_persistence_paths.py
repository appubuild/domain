"""`infra/persistence/paths.py` — where things live.

Pure path arithmetic, so the whole layout is testable without a temp directory
and reviewable in one screen. What is being pinned is not the strings but the
two rules behind them: a journal lives **outside** the project file (a shared
project must not carry the author's unsaved work), and a temporary file is
written **beside** its target (a rename is only atomic within one filesystem).
"""

from __future__ import annotations

import pathlib

import pytest

from nova_studio.infra.persistence import paths

pytestmark = pytest.mark.unit

ROOT = pathlib.Path("/data/nova")
PROJECT = "01J8ZZ9K3M4N5P6Q7R8S9T0V1W"


class TestProjectIds:
    def test_an_ordinary_id_is_safe(self) -> None:
        assert paths.is_safe_project_id(PROJECT)

    def test_a_parent_traversal_is_not(self) -> None:
        assert not paths.is_safe_project_id("../../etc")

    def test_a_windows_path_is_not(self) -> None:
        assert not paths.is_safe_project_id("C:\\Users\\me")

    def test_an_absolute_path_is_not(self) -> None:
        assert not paths.is_safe_project_id("/etc/passwd")

    def test_an_empty_id_is_not(self) -> None:
        assert not paths.is_safe_project_id("")

    def test_an_unsafe_id_cannot_name_a_directory(self) -> None:
        with pytest.raises(ValueError, match="directory name"):
            paths.journal_dir(ROOT, "../../etc")


class TestTheJournalDirectory:
    def test_it_is_named_by_the_format_spec(self) -> None:
        assert paths.journal_dir(ROOT, PROJECT) == ROOT / "autosave" / PROJECT

    def test_one_directory_per_project(self) -> None:
        other = "01J8ZZ9K3M4N5P6Q7R8S9T0V1X"
        assert paths.journal_dir(ROOT, PROJECT) != paths.journal_dir(ROOT, other)

    def test_it_is_under_the_data_root(self) -> None:
        assert paths.journal_dir(ROOT, PROJECT).is_relative_to(ROOT)

    def test_the_autosave_subdirectory_has_the_documented_name(self) -> None:
        assert paths.AUTOSAVE_SUBDIR == "autosave"


class TestJournalNames:
    def test_a_name_carries_the_start_time(self) -> None:
        assert paths.journal_name(1700, "abc") == "cmds-1700-abc.ndjson"

    def test_a_name_is_a_journal_name(self) -> None:
        assert paths.is_journal_name(paths.journal_name(1700, "abc"))

    def test_the_start_time_can_be_read_back(self) -> None:
        assert paths.journal_started_ms(paths.journal_name(1700, "abc")) == 1700

    def test_a_negative_start_is_refused(self) -> None:
        with pytest.raises(ValueError, match="must not be negative"):
            paths.journal_name(-1, "abc")

    def test_a_token_that_is_a_path_is_refused(self) -> None:
        with pytest.raises(ValueError, match="bare name"):
            paths.journal_name(1700, "a/b")

    def test_a_name_from_another_tool_is_not_ours(self) -> None:
        assert not paths.is_journal_name("notes.txt")

    def test_a_partially_written_name_is_not_ours(self) -> None:
        assert not paths.is_journal_name("cmds-.ndjson")

    def test_a_mangled_timestamp_sorts_oldest(self) -> None:
        assert paths.journal_started_ms("cmds-whenever-abc.ndjson") == 0

    def test_two_tokens_give_two_names(self) -> None:
        assert paths.journal_name(1700, "aaa") != paths.journal_name(1700, "bbb")


class TestTheCacheDatabase:
    def test_it_sits_at_the_root_of_the_data_directory(self) -> None:
        assert paths.cache_database_path(ROOT) == ROOT / "cache.sqlite3"

    def test_there_is_one_for_the_whole_install(self) -> None:
        assert paths.cache_database_path(ROOT) == paths.cache_database_path(ROOT)


class TestBackups:
    def test_a_backup_keeps_the_whole_name(self) -> None:
        assert paths.backup_path(ROOT / "holiday.nova").name == "holiday.nova.bak"

    def test_a_backup_sits_beside_the_file_it_protects(self) -> None:
        assert paths.backup_path(ROOT / "holiday.nova").parent == ROOT

    def test_the_extension_stays_visible(self) -> None:
        assert paths.backup_path(ROOT / "holiday.nova").suffixes == [".nova", ".bak"]


class TestStaging:
    def test_a_temporary_file_sits_beside_its_target(self) -> None:
        staged = paths.temp_path(ROOT / "holiday.nova", "abc123")
        assert staged.parent == ROOT

    def test_a_temporary_file_is_marked_as_one(self) -> None:
        assert ".tmp-" in paths.temp_path(ROOT / "holiday.nova", "abc123").name

    def test_a_temporary_file_keeps_the_target_name(self) -> None:
        assert paths.temp_path(ROOT / "holiday.nova", "abc").name.startswith("holiday.nova")

    def test_two_tokens_give_two_staging_paths(self) -> None:
        one = paths.temp_path(ROOT / "holiday.nova", "aaa")
        two = paths.temp_path(ROOT / "holiday.nova", "bbb")
        assert one != two

    def test_a_token_that_is_a_path_is_refused(self) -> None:
        with pytest.raises(ValueError, match="bare name"):
            paths.temp_path(ROOT / "holiday.nova", "../elsewhere")

    def test_a_staging_path_is_never_the_backup_path(self) -> None:
        project = ROOT / "holiday.nova"
        assert paths.temp_path(project, "abc") != paths.backup_path(project)
