"""`infra/persistence/journal.py` — the log that makes a crash a restart.

Everything else in persistence protects the saved project; this protects the work
done *since* the save. So the tests here are mostly about dying: a partial last
line, a file that was never closed, a recovery that stops and starts again.

The rule every test orbits: **a torn tail is data, not an error**. Being killed
mid-write is the normal state of a journal, and an implementation that declared
the file corrupt would throw away exactly the work it exists to protect.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

import pytest

from nova_studio.core.errors import NovaInvariantError
from nova_studio.domain.persistence import JournalEntry
from nova_studio.infra.persistence import open_journal
from nova_studio.infra.persistence.paths import is_journal_name

if TYPE_CHECKING:
    from pathlib import Path

    from nova_studio.infra.persistence.journal import NdjsonJournal

pytestmark = pytest.mark.unit

PROJECT = "01J8ZZ9K3M4N5P6Q7R8S9T0V1W"
T0 = 1_700_000_000_000


def _journal(tmp_path: Path, *, started_ms: int = 1_000) -> NdjsonJournal:
    return open_journal(tmp_path, PROJECT, started_ms=started_ms)


def _entry(sequence: int, name: str = "MoveClip") -> JournalEntry:
    return JournalEntry(sequence=sequence, recorded_at_ms=T0 + sequence, name=name)


def _journal_file(tmp_path: Path) -> Path:
    files = sorted((tmp_path / "autosave" / PROJECT).glob("*.ndjson"))
    return files[0]


# -- appending ---------------------------------------------------------------


class TestAppending:
    def test_an_entry_is_written(self, tmp_path: Path) -> None:
        journal = _journal(tmp_path)
        journal.append(_entry(1))
        journal.close()
        assert journal.path is not None and journal.path.exists()

    def test_the_entry_reaches_the_disk(self, tmp_path: Path) -> None:
        """An entry in a buffer when the power goes is an edit we lost."""
        journal = _journal(tmp_path)
        journal.append(_entry(1))
        assert _journal_file(tmp_path).read_text().strip()

    def test_one_entry_is_one_line(self, tmp_path: Path) -> None:
        journal = _journal(tmp_path)
        journal.append(_entry(1))
        journal.append(_entry(2))
        journal.close()
        assert len(_journal_file(tmp_path).read_text().strip().splitlines()) == 2

    def test_the_line_is_json(self, tmp_path: Path) -> None:
        journal = _journal(tmp_path)
        journal.append(_entry(1))
        journal.close()
        assert json.loads(_journal_file(tmp_path).read_text().strip())["seq"] == 1

    def test_the_payload_survives(self, tmp_path: Path) -> None:
        journal = _journal(tmp_path)
        journal.append(JournalEntry(sequence=1, recorded_at_ms=T0, name="Move", payload={"x": 4}))
        journal.close()
        window = _journal(tmp_path).read_since(0).unwrap()
        assert window.entries[0].payload == {"x": 4}

    def test_the_directory_is_created(self, tmp_path: Path) -> None:
        _journal(tmp_path).append(_entry(1))
        assert (tmp_path / "autosave" / PROJECT).is_dir()

    def test_the_file_is_named_like_a_journal(self, tmp_path: Path) -> None:
        journal = _journal(tmp_path)
        journal.append(_entry(1))
        journal.close()
        assert is_journal_name(journal.path.name)  # type: ignore[union-attr]

    def test_a_second_session_continues_the_same_file(self, tmp_path: Path) -> None:
        first = _journal(tmp_path, started_ms=1_000)
        first.append(_entry(1))
        first.close()
        second = _journal(tmp_path, started_ms=9_000)
        second.append(_entry(2))
        second.close()
        assert second.path == first.path

    def test_a_reused_sequence_is_refused(self, tmp_path: Path) -> None:
        journal = _journal(tmp_path)
        journal.append(_entry(5))
        with pytest.raises(NovaInvariantError, match="must move forward"):
            journal.append(_entry(5))

    def test_a_sequence_that_goes_backwards_is_refused(self, tmp_path: Path) -> None:
        journal = _journal(tmp_path)
        journal.append(_entry(5))
        with pytest.raises(NovaInvariantError):
            journal.append(_entry(4))

    def test_a_second_session_cannot_reuse_a_sequence(self, tmp_path: Path) -> None:
        first = _journal(tmp_path, started_ms=1_000)
        first.append(_entry(1))
        first.close()
        second = _journal(tmp_path, started_ms=9_000)
        with pytest.raises(NovaInvariantError):
            second.append(_entry(1))

    def test_appending_to_a_closed_journal_is_reported(self, tmp_path: Path) -> None:
        journal = _journal(tmp_path)
        journal.close()
        assert journal.append(_entry(1)).is_err()


# -- reading -----------------------------------------------------------------


class TestReading:
    def test_entries_are_read_back(self, tmp_path: Path) -> None:
        journal = _journal(tmp_path)
        for sequence in (1, 2, 3):
            journal.append(_entry(sequence))
        assert [item.sequence for item in journal.read_since(0).unwrap().entries] == [1, 2, 3]

    def test_reading_from_a_sequence_skips_what_was_already_seen(self, tmp_path: Path) -> None:
        journal = _journal(tmp_path)
        for sequence in (1, 2, 3):
            journal.append(_entry(sequence))
        assert [item.sequence for item in journal.read_since(1).unwrap().entries] == [2, 3]

    def test_the_window_says_where_to_continue(self, tmp_path: Path) -> None:
        journal = _journal(tmp_path)
        for sequence in (1, 2, 3):
            journal.append(_entry(sequence))
        assert journal.read_since(0).unwrap().next_sequence == 3

    def test_recovery_resumes_from_where_it_stopped(self, tmp_path: Path) -> None:
        journal = _journal(tmp_path)
        for sequence in (1, 2, 3, 4):
            journal.append(_entry(sequence))
        first = journal.read_since(0).unwrap()
        second = journal.read_since(first.next_sequence).unwrap()
        assert second.entries == ()

    def test_an_empty_journal_reads_cleanly(self, tmp_path: Path) -> None:
        window = _journal(tmp_path).read_since(0).unwrap()
        assert window.entries == () and window.next_sequence == 0

    def test_a_journal_reads_before_anything_is_appended(self, tmp_path: Path) -> None:
        """Recovery reads a journal a previous run wrote, before this one writes."""
        first = _journal(tmp_path, started_ms=1_000)
        first.append(_entry(1))
        first.close()
        second = _journal(tmp_path, started_ms=9_000)
        assert [item.sequence for item in second.read_since(0).unwrap().entries] == [1]

    def test_the_command_name_survives(self, tmp_path: Path) -> None:
        journal = _journal(tmp_path)
        journal.append(JournalEntry(sequence=1, recorded_at_ms=T0, name="TrimClip"))
        assert journal.read_since(0).unwrap().entries[0].name == "TrimClip"

    def test_the_time_survives(self, tmp_path: Path) -> None:
        journal = _journal(tmp_path)
        journal.append(JournalEntry(sequence=1, recorded_at_ms=T0, name="MoveClip"))
        assert journal.read_since(0).unwrap().entries[0].recorded_at_ms == T0


# -- a torn tail --------------------------------------------------------------


class TestATornTail:
    def test_a_partial_line_is_not_an_error(self, tmp_path: Path) -> None:
        journal = _journal(tmp_path)
        journal.append(_entry(1))
        journal.close()
        with _journal_file(tmp_path).open("a") as handle:
            handle.write('{"seq":2,"at_ms":100,"name":"Trim')
        assert _journal(tmp_path).read_since(0).unwrap().entries[0].sequence == 1

    def test_it_is_reported(self, tmp_path: Path) -> None:
        journal = _journal(tmp_path)
        journal.append(_entry(1))
        journal.close()
        with _journal_file(tmp_path).open("a") as handle:
            handle.write('{"seq":2,"at_ms":100,"name":"Trim')
        assert _journal(tmp_path).read_since(0).unwrap().torn_tail

    def test_the_entries_before_it_are_kept(self, tmp_path: Path) -> None:
        journal = _journal(tmp_path)
        for sequence in (1, 2, 3):
            journal.append(_entry(sequence))
        journal.close()
        with _journal_file(tmp_path).open("a") as handle:
            handle.write('{"seq":4,"at_ms":10')
        window = _journal(tmp_path).read_since(0).unwrap()
        assert [item.sequence for item in window.entries] == [1, 2, 3]

    def test_a_whole_file_that_is_not_json_is_reported_not_raised(self, tmp_path: Path) -> None:
        directory = tmp_path / "autosave" / PROJECT
        directory.mkdir(parents=True)
        (directory / "cmds-1000-abc.ndjson").write_text("not json at all\n")
        window = _journal(tmp_path).read_since(0).unwrap()
        assert window.entries == () and window.torn_tail

    def test_a_clean_file_is_not_torn(self, tmp_path: Path) -> None:
        journal = _journal(tmp_path)
        journal.append(_entry(1))
        assert journal.read_since(0).unwrap().torn_tail is False


# -- truncating ---------------------------------------------------------------


class TestTruncating:
    def test_entries_up_to_a_sequence_are_dropped(self, tmp_path: Path) -> None:
        journal = _journal(tmp_path)
        for sequence in (1, 2, 3):
            journal.append(_entry(sequence))
        journal.truncate_through(2)
        assert [item.sequence for item in journal.read_since(0).unwrap().entries] == [3]

    def test_truncating_everything_empties_the_journal(self, tmp_path: Path) -> None:
        journal = _journal(tmp_path)
        for sequence in (1, 2, 3):
            journal.append(_entry(sequence))
        journal.truncate_through(3)
        assert journal.read_since(0).unwrap().entries == ()

    def test_truncating_an_empty_journal_is_fine(self, tmp_path: Path) -> None:
        assert _journal(tmp_path).truncate_through(0).is_ok()

    def test_truncating_rewrites_the_file(self, tmp_path: Path) -> None:
        journal = _journal(tmp_path)
        for sequence in (1, 2, 3):
            journal.append(_entry(sequence))
        journal.truncate_through(2)
        assert _journal_file(tmp_path).read_text().strip().count("\n") == 0

    def test_truncating_leaves_no_temporary_file(self, tmp_path: Path) -> None:
        journal = _journal(tmp_path)
        journal.append(_entry(1))
        journal.truncate_through(0)
        assert not list((tmp_path / "autosave" / PROJECT).glob("*.tmp-*"))

    def test_a_new_sequence_still_cannot_be_reused_after_a_truncate(self, tmp_path: Path) -> None:
        journal = _journal(tmp_path)
        for sequence in (1, 2, 3):
            journal.append(_entry(sequence))
        journal.truncate_through(2)
        with pytest.raises(NovaInvariantError):
            journal.append(_entry(3))

    def test_a_truncate_before_any_append_works_on_the_saved_file(self, tmp_path: Path) -> None:
        first = _journal(tmp_path, started_ms=1_000)
        for sequence in (1, 2, 3):
            first.append(_entry(sequence))
        first.close()
        second = _journal(tmp_path, started_ms=9_000)
        assert second.truncate_through(2).is_ok()
        assert [item.sequence for item in second.read_since(0).unwrap().entries] == [3]

    def test_a_torn_tail_is_dropped_by_a_truncate(self, tmp_path: Path) -> None:
        journal = _journal(tmp_path)
        journal.append(_entry(1))
        journal.close()
        with _journal_file(tmp_path).open("a") as handle:
            handle.write('{"seq":2,"at_ms":10')
        second = _journal(tmp_path, started_ms=9_000)
        second.truncate_through(0)
        assert second.read_since(0).unwrap().torn_tail is False

    def test_a_closed_journal_refuses_to_truncate(self, tmp_path: Path) -> None:
        journal = _journal(tmp_path)
        journal.close()
        assert journal.truncate_through(1).is_err()


# -- lifecycle ---------------------------------------------------------------


class TestLifecycle:
    def test_closing_twice_is_safe(self, tmp_path: Path) -> None:
        journal = _journal(tmp_path)
        journal.append(_entry(1))
        journal.close()
        journal.close()

    def test_the_directory_is_reported(self, tmp_path: Path) -> None:
        assert _journal(tmp_path).directory == tmp_path / "autosave" / PROJECT

    def test_two_journals_for_two_projects_are_separate(self, tmp_path: Path) -> None:
        one = open_journal(tmp_path, "01J8ZZ9K3M4N5P6Q7R8S9T0V1W", started_ms=1_000)
        two = open_journal(tmp_path, "01J8ZZ9K3M4N5P6Q7R8S9T0V1X", started_ms=1_000)
        one.append(_entry(1))
        one.close()
        two.append(_entry(1))
        two.close()
        assert one.path != two.path
