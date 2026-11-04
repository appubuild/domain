"""`infra/persistence/archive.py` — the `.nova` container.

These tests run against a real filesystem, because the properties that make a
project file trustworthy are exactly the properties an in-memory fake cannot
witness: that a save is atomic, that a crash leaves the previous version, that a
byte flipped by a bad disk is *found*.

What is pinned, in the order the format spec makes promises:

* **staging** — a write is invisible until `commit`, a `discard` costs nothing,
  and a failed commit leaves both the old file and the staged work;
* **atomicity** — a save writes a temporary file and replaces, never truncates;
* **versions** — a newer format is refused whole, not parsed hopefully;
* **checkpoints** — they are numbered, bounded, restorable and pruned oldest
  first;
* **entry names** — the zip-slip family is refused before it reaches the disk;
* **checksums** — damage in one entry is reported as that entry, and does not
  stop the project from being read.
"""

from __future__ import annotations

import zipfile
from typing import TYPE_CHECKING, Any

import pytest

from nova_studio.domain.persistence import (
    MANIFEST_DOCUMENT,
    PROJECT_DOCUMENT,
    TIMELINE_DOCUMENT,
    ProjectManifest,
    caption_document,
    revision_document,
)
from nova_studio.infra.persistence import ZipProjectArchive
from nova_studio.infra.persistence.archive import REVISION_INDEX_DOCUMENT

if TYPE_CHECKING:
    from pathlib import Path

pytestmark = pytest.mark.unit

PROJECT_ID = "01J8ZZ9K3M4N5P6Q7R8S9T0V1W"


def _manifest(**over: Any) -> ProjectManifest:
    defaults: dict[str, Any] = {
        "project_id": PROJECT_ID,
        "format_version": 2,
        "app_version": "0.1.0",
        "created_ms": 1_000,
        "modified_ms": 1_000,
    }
    return ProjectManifest(**{**defaults, **over})


def _timeline(*markers: int) -> dict[str, object]:
    return {"timebase": [30, 1], "tracks": [], "markers": list(markers)}


def _archive(path: Path, **over: Any) -> ZipProjectArchive:
    return ZipProjectArchive(path, **over)


def _saved(path: Path) -> ZipProjectArchive:
    """An openable project file on disk."""
    archive = _archive(path)
    archive.write_manifest(_manifest())
    archive.write_document(PROJECT_DOCUMENT, {"name": "holiday"})
    archive.write_document(TIMELINE_DOCUMENT, _timeline())
    archive.commit()
    return archive


# -- opening -----------------------------------------------------------------


class TestOpening:
    def test_a_project_that_is_not_there_yet_is_empty(self, tmp_path: Path) -> None:
        assert _archive(tmp_path / "new.nova").read_document(PROJECT_DOCUMENT).is_err()

    def test_a_saved_project_opens(self, tmp_path: Path) -> None:
        path = tmp_path / "holiday.nova"
        archive = _saved(path)
        assert archive.read_manifest().unwrap().project_id == PROJECT_ID

    def test_the_manifest_round_trips(self, tmp_path: Path) -> None:
        _saved(tmp_path / "holiday.nova")
        fresh = _archive(tmp_path / "holiday.nova")
        assert fresh.read_manifest().unwrap() == _manifest()

    def test_a_document_round_trips(self, tmp_path: Path) -> None:
        archive = _saved(tmp_path / "holiday.nova")
        assert archive.read_document(PROJECT_DOCUMENT).unwrap() == {"name": "holiday"}

    def test_a_second_archive_sees_the_committed_state(self, tmp_path: Path) -> None:
        path = tmp_path / "holiday.nova"
        _saved(path)
        assert _archive(path).read_document(PROJECT_DOCUMENT).unwrap() == {"name": "holiday"}

    def test_a_file_that_is_not_a_project_is_refused(self, tmp_path: Path) -> None:
        path = tmp_path / "not-a-project.nova"
        path.write_bytes(b"this is a text file, honest")
        problem = _archive(path).read_manifest().unwrap_err()
        assert problem.code == "NS-STORAGE-4002"

    def test_the_refusal_says_it_is_not_a_project(self, tmp_path: Path) -> None:
        path = tmp_path / "not-a-project.nova"
        path.write_bytes(b"nope")
        assert "not a project" in _archive(path).read_manifest().unwrap_err().message

    def test_a_zip_without_a_manifest_is_refused(self, tmp_path: Path) -> None:
        path = tmp_path / "empty.nova"
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr("readme.txt", "hello")
        problem = _archive(path).read_manifest().unwrap_err()
        assert problem.code == "NS-STORAGE-4002"

    def test_a_newer_format_is_refused_whole(self, tmp_path: Path) -> None:
        path = tmp_path / "future.nova"
        archive = _archive(path)
        archive.write_manifest(_manifest(format_version=9))
        archive.commit()
        problem = _archive(path, supported_format_version=2).read_manifest().unwrap_err()
        assert problem.code == "NS-STORAGE-4003"

    def test_the_refusal_names_both_versions(self, tmp_path: Path) -> None:
        path = tmp_path / "future.nova"
        archive = _archive(path)
        archive.write_manifest(_manifest(format_version=9))
        archive.commit()
        message = _archive(path, supported_format_version=2).read_manifest().unwrap_err().message
        assert "9" in message and "2" in message

    def test_a_newer_format_is_never_partially_parsed(self, tmp_path: Path) -> None:
        path = tmp_path / "future.nova"
        archive = _archive(path)
        archive.write_manifest(_manifest(format_version=9))
        archive.write_document(PROJECT_DOCUMENT, {"name": "holiday"})
        archive.commit()
        future = _archive(path, supported_format_version=2)
        assert future.read_manifest().is_err()
        assert future.read_document(PROJECT_DOCUMENT).is_err()


# -- staging -----------------------------------------------------------------


class TestStaging:
    def test_a_staged_write_is_readable_by_the_writer(self, tmp_path: Path) -> None:
        archive = _archive(tmp_path / "holiday.nova")
        archive.write_document(PROJECT_DOCUMENT, {"name": "holiday"})
        assert archive.read_document(PROJECT_DOCUMENT).unwrap() == {"name": "holiday"}

    def test_a_staged_write_is_not_in_the_file(self, tmp_path: Path) -> None:
        path = tmp_path / "holiday.nova"
        archive = _archive(path)
        archive.write_document(PROJECT_DOCUMENT, {"name": "holiday"})
        assert not path.exists()

    def test_a_staged_write_is_invisible_to_another_reader(self, tmp_path: Path) -> None:
        path = tmp_path / "holiday.nova"
        archive = _saved(path)
        archive.write_document(PROJECT_DOCUMENT, {"name": "renamed"})
        assert _archive(path).read_document(PROJECT_DOCUMENT).unwrap() == {"name": "holiday"}

    def test_discard_leaves_the_file_alone(self, tmp_path: Path) -> None:
        path = tmp_path / "holiday.nova"
        archive = _saved(path)
        archive.write_document(PROJECT_DOCUMENT, {"name": "renamed"})
        archive.discard()
        assert _archive(path).read_document(PROJECT_DOCUMENT).unwrap() == {"name": "holiday"}

    def test_committing_nothing_writes_nothing(self, tmp_path: Path) -> None:
        path = tmp_path / "holiday.nova"
        archive = _saved(path)
        before = path.stat().st_mtime_ns
        assert archive.commit().is_ok()
        assert path.stat().st_mtime_ns == before

    def test_committing_nothing_creates_no_file(self, tmp_path: Path) -> None:
        path = tmp_path / "holiday.nova"
        _archive(path).commit()
        assert not path.exists()


# -- atomicity ---------------------------------------------------------------


class TestAtomicity:
    def test_a_save_replaces_the_whole_file(self, tmp_path: Path) -> None:
        path = tmp_path / "holiday.nova"
        archive = _saved(path)
        archive.write_document(PROJECT_DOCUMENT, {"name": "renamed"})
        archive.commit()
        assert _archive(path).read_document(PROJECT_DOCUMENT).unwrap() == {"name": "renamed"}

    def test_the_previous_version_is_kept(self, tmp_path: Path) -> None:
        path = tmp_path / "holiday.nova"
        archive = _saved(path)
        archive.write_document(PROJECT_DOCUMENT, {"name": "renamed"})
        archive.commit()
        assert (tmp_path / "holiday.nova.bak").exists()

    def test_the_backup_holds_the_previous_version(self, tmp_path: Path) -> None:
        path = tmp_path / "holiday.nova"
        archive = _saved(path)
        archive.write_document(PROJECT_DOCUMENT, {"name": "renamed"})
        archive.commit()
        backup = _archive(tmp_path / "holiday.nova.bak")
        assert backup.read_document(PROJECT_DOCUMENT).unwrap() == {"name": "holiday"}

    def test_no_temporary_files_are_left_behind(self, tmp_path: Path) -> None:
        path = tmp_path / "holiday.nova"
        archive = _saved(path)
        archive.write_document(PROJECT_DOCUMENT, {"name": "renamed"})
        archive.commit()
        assert not list(tmp_path.glob("*.tmp-*"))

    def test_the_container_is_a_zip(self, tmp_path: Path) -> None:
        path = tmp_path / "holiday.nova"
        _saved(path)
        assert zipfile.is_zipfile(path)

    def test_the_documents_inside_are_readable_by_any_zip_tool(self, tmp_path: Path) -> None:
        path = tmp_path / "holiday.nova"
        _saved(path)
        with zipfile.ZipFile(path) as archive:
            assert archive.read(PROJECT_DOCUMENT) == b'{"name":"holiday"}\n'

    def test_the_entries_are_listed_in_the_documented_order(self, tmp_path: Path) -> None:
        path = tmp_path / "holiday.nova"
        _saved(path)
        with zipfile.ZipFile(path) as archive:
            names = archive.namelist()
        assert names[0] == MANIFEST_DOCUMENT
        assert names.index(PROJECT_DOCUMENT) < names.index(TIMELINE_DOCUMENT)

    def test_a_failed_commit_leaves_the_old_file_intact(self, tmp_path: Path) -> None:
        path = tmp_path / "holiday.nova"
        archive = _saved(path)
        archive.write_document(PROJECT_DOCUMENT, {"name": "renamed"})
        _unwritable(archive, tmp_path)
        assert archive.commit().is_err()
        assert _archive(path).read_document(PROJECT_DOCUMENT).unwrap() == {"name": "holiday"}

    def test_a_failed_commit_keeps_the_staged_work(self, tmp_path: Path) -> None:
        """A full disk is not a reason to throw away an hour of edits."""
        path = tmp_path / "holiday.nova"
        archive = _saved(path)
        archive.write_document(PROJECT_DOCUMENT, {"name": "renamed"})
        _unwritable(archive, tmp_path)
        archive.commit()
        archive._path = path  # the disk is writable again
        assert archive.commit().is_ok()
        assert _archive(path).read_document(PROJECT_DOCUMENT).unwrap() == {"name": "renamed"}

    def test_a_failed_commit_reports_a_retryable_error(self, tmp_path: Path) -> None:
        path = tmp_path / "holiday.nova"
        archive = _saved(path)
        archive.write_document(PROJECT_DOCUMENT, {"name": "renamed"})
        _unwritable(archive, tmp_path)
        problem = archive.commit().unwrap_err()
        assert problem.code == "NS-STORAGE-4005"
        assert problem.retryable


# -- entry names -------------------------------------------------------------


class TestEntryNames:
    def test_a_parent_traversal_is_refused_on_write(self, tmp_path: Path) -> None:
        problem = _archive(tmp_path / "a.nova").write_document("../../escape", {})
        assert problem.unwrap_err().code == "NS-STORAGE-4002"

    def test_an_absolute_name_is_refused_on_write(self, tmp_path: Path) -> None:
        assert _archive(tmp_path / "a.nova").write_document("/etc/passwd", {}).is_err()

    def test_a_backslash_is_refused_on_write(self, tmp_path: Path) -> None:
        assert _archive(tmp_path / "a.nova").write_document("media\\thumb.jpg", b"").is_err()

    def test_an_invalid_name_is_refused_on_read(self, tmp_path: Path) -> None:
        assert _archive(tmp_path / "a.nova").read_document("../escape").is_err()

    def test_a_file_holding_an_unsafe_entry_is_refused(self, tmp_path: Path) -> None:
        path = tmp_path / "crafted.nova"
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr("../../evil.json", "{}")
        assert _archive(path).read_manifest().is_err()

    def test_the_refusal_names_the_entry(self, tmp_path: Path) -> None:
        path = tmp_path / "crafted.nova"
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr("../../evil.json", "{}")
        assert "../../evil.json" in _archive(path).read_manifest().unwrap_err().message


# -- blobs -------------------------------------------------------------------


class TestBlobs:
    def test_a_blob_round_trips(self, tmp_path: Path) -> None:
        archive = _saved(tmp_path / "holiday.nova")
        archive.write_blob("preview.jpg", b"\xff\xd8\xff\xd9")
        archive.commit()
        assert archive.read_blob("preview.jpg").unwrap() == b"\xff\xd8\xff\xd9"

    def test_a_missing_blob_is_reported_not_raised(self, tmp_path: Path) -> None:
        assert _saved(tmp_path / "holiday.nova").read_blob("preview.jpg").is_err()

    def test_a_blob_survives_a_reopen(self, tmp_path: Path) -> None:
        path = tmp_path / "holiday.nova"
        archive = _saved(path)
        archive.write_blob("media/poster.jpg", b"poster-bytes")
        archive.commit()
        assert _archive(path).read_blob("media/poster.jpg").unwrap() == b"poster-bytes"

    def test_a_staged_blob_is_readable_before_the_commit(self, tmp_path: Path) -> None:
        archive = _saved(tmp_path / "holiday.nova")
        archive.write_blob("preview.jpg", b"soon")
        assert archive.read_blob("preview.jpg").unwrap() == b"soon"


# -- captions ----------------------------------------------------------------


class TestCaptions:
    def test_a_caption_document_is_listed(self, tmp_path: Path) -> None:
        archive = _saved(tmp_path / "holiday.nova")
        archive.write_document(caption_document("main"), {"segments": []})
        assert archive.caption_document_ids().unwrap() == ("main",)

    def test_several_are_listed_in_order(self, tmp_path: Path) -> None:
        archive = _saved(tmp_path / "holiday.nova")
        archive.write_document(caption_document("main"), {"segments": []})
        archive.write_document(caption_document("es"), {"segments": []})
        assert archive.caption_document_ids().unwrap() == ("es", "main")

    def test_a_sidecar_is_not_a_caption_document(self, tmp_path: Path) -> None:
        archive = _saved(tmp_path / "holiday.nova")
        archive.write_document(caption_document("main"), {"segments": []})
        archive.write_document("captions/sidecar/main.srt", {"text": "ignored"})
        assert archive.caption_document_ids().unwrap() == ("main",)

    def test_a_project_with_no_captions_lists_none(self, tmp_path: Path) -> None:
        assert _saved(tmp_path / "holiday.nova").caption_document_ids().unwrap() == ()

    def test_a_caption_that_is_not_a_document_is_refused(self, tmp_path: Path) -> None:
        archive = _saved(tmp_path / "holiday.nova")
        archive.write_document("captions/notes.txt", {"text": "hi"})
        assert archive.caption_document_ids().is_err()

    def test_a_caption_in_a_subdirectory_is_refused(self, tmp_path: Path) -> None:
        archive = _saved(tmp_path / "holiday.nova")
        archive.write_document("captions/nested/main.json", {"segments": []})
        assert archive.caption_document_ids().is_err()

    def test_a_caption_document_round_trips(self, tmp_path: Path) -> None:
        path = tmp_path / "holiday.nova"
        archive = _saved(path)
        archive.write_document(caption_document("main"), {"segments": [{"text": "hi"}]})
        archive.commit()
        fresh = _archive(path)
        assert fresh.read_document(caption_document("main")).unwrap() == {
            "segments": [{"text": "hi"}]
        }


# -- checkpoints -------------------------------------------------------------


class TestCheckpoints:
    def test_the_first_checkpoint_is_numbered_one(self, tmp_path: Path) -> None:
        archive = _saved(tmp_path / "holiday.nova")
        assert archive.checkpoint(recorded_at_ms=2_000).unwrap().sequence == 1

    def test_checkpoints_are_numbered_in_order(self, tmp_path: Path) -> None:
        archive = _saved(tmp_path / "holiday.nova")
        first = archive.checkpoint(recorded_at_ms=2_000).unwrap()
        archive.commit()
        second = archive.checkpoint(recorded_at_ms=3_000).unwrap()
        assert (first.sequence, second.sequence) == (1, 2)

    def test_a_checkpoint_keeps_its_label(self, tmp_path: Path) -> None:
        archive = _saved(tmp_path / "holiday.nova")
        assert archive.checkpoint(recorded_at_ms=2_000, label="before the cut").unwrap().label == (
            "before the cut"
        )

    def test_a_checkpoint_keeps_the_time_it_was_taken(self, tmp_path: Path) -> None:
        archive = _saved(tmp_path / "holiday.nova")
        assert archive.checkpoint(recorded_at_ms=2_000).unwrap().recorded_at_ms == 2_000

    def test_a_checkpoint_is_staged(self, tmp_path: Path) -> None:
        path = tmp_path / "holiday.nova"
        archive = _saved(path)
        archive.checkpoint(recorded_at_ms=2_000)
        assert _archive(path).revisions().unwrap() == ()

    def test_a_committed_checkpoint_is_listed(self, tmp_path: Path) -> None:
        path = tmp_path / "holiday.nova"
        archive = _saved(path)
        archive.checkpoint(recorded_at_ms=2_000)
        archive.commit()
        assert len(_archive(path).revisions().unwrap()) == 1

    def test_checkpoints_are_listed_oldest_first(self, tmp_path: Path) -> None:
        archive = _saved(tmp_path / "holiday.nova")
        for at in (2_000, 3_000, 4_000):
            archive.checkpoint(recorded_at_ms=at)
            archive.commit()
        assert [item.recorded_at_ms for item in archive.revisions().unwrap()] == [
            2_000,
            3_000,
            4_000,
        ]

    def test_the_order_is_the_order_they_were_taken(self, tmp_path: Path) -> None:
        """Sequence decides the order, because a clock can be set backwards."""
        archive = _saved(tmp_path / "holiday.nova")
        for at in (5_000, 2_000):
            archive.checkpoint(recorded_at_ms=at)
            archive.commit()
        assert [item.recorded_at_ms for item in archive.revisions().unwrap()] == [5_000, 2_000]

    def test_the_history_is_bounded(self, tmp_path: Path) -> None:
        archive = _saved(tmp_path / "holiday.nova")
        for at in range(10):
            archive.checkpoint(recorded_at_ms=2_000 + at)
            archive.commit()
        assert len(archive.revisions().unwrap()) == 5

    def test_the_oldest_are_the_ones_pruned(self, tmp_path: Path) -> None:
        archive = _saved(tmp_path / "holiday.nova")
        for at in range(10):
            archive.checkpoint(recorded_at_ms=2_000 + at)
            archive.commit()
        assert [item.recorded_at_ms for item in archive.revisions().unwrap()] == [
            2_005,
            2_006,
            2_007,
            2_008,
            2_009,
        ]

    def test_the_bound_is_a_constructor_argument(self, tmp_path: Path) -> None:
        archive = _archive(tmp_path / "holiday.nova", max_revisions=2)
        archive.write_manifest(_manifest())
        archive.write_document(TIMELINE_DOCUMENT, _timeline())
        for at in range(6):
            archive.checkpoint(recorded_at_ms=2_000 + at)
            archive.commit()
        assert len(archive.revisions().unwrap()) == 2

    def test_at_least_one_revision_must_be_kept(self, tmp_path: Path) -> None:
        with pytest.raises(ValueError, match="at least one revision"):
            _archive(tmp_path / "holiday.nova", max_revisions=0)

    def test_a_checkpoint_records_the_timeline_as_it_stands(self, tmp_path: Path) -> None:
        archive = _saved(tmp_path / "holiday.nova")
        archive.write_document(TIMELINE_DOCUMENT, _timeline(1, 2))
        archive.checkpoint(recorded_at_ms=2_000)
        archive.write_document(TIMELINE_DOCUMENT, _timeline(9))
        archive.commit()
        assert archive.read_document(revision_document(1)).unwrap() == _timeline(1, 2)

    def test_the_revision_is_a_plain_timeline_document(self, tmp_path: Path) -> None:
        """`unzip -p` gives you a timeline, not a wrapper."""
        archive = _saved(tmp_path / "holiday.nova")
        archive.checkpoint(recorded_at_ms=2_000)
        archive.commit()
        assert set(archive.read_document(revision_document(1)).unwrap()) == {
            "timebase",
            "tracks",
            "markers",
        }

    def test_the_metadata_lives_in_its_own_entry(self, tmp_path: Path) -> None:
        archive = _saved(tmp_path / "holiday.nova")
        archive.checkpoint(recorded_at_ms=2_000, label="kept")
        archive.commit()
        index = archive.read_document(REVISION_INDEX_DOCUMENT).unwrap()
        assert index["revisions"][0]["label"] == "kept"  # type: ignore[index,call-overload]

    def test_a_checkpoint_carries_a_checksum(self, tmp_path: Path) -> None:
        archive = _saved(tmp_path / "holiday.nova")
        assert archive.checkpoint(recorded_at_ms=2_000).unwrap().checksum is not None


class TestRestoring:
    def test_restoring_stages_the_revision(self, tmp_path: Path) -> None:
        archive = _saved(tmp_path / "holiday.nova")
        archive.checkpoint(recorded_at_ms=2_000)
        archive.commit()
        archive.write_document(TIMELINE_DOCUMENT, _timeline(9))
        assert archive.restore(1).unwrap() == _timeline()

    def test_restoring_changes_nothing_until_it_is_committed(self, tmp_path: Path) -> None:
        path = tmp_path / "holiday.nova"
        archive = _saved(path)
        archive.checkpoint(recorded_at_ms=2_000)
        archive.commit()
        archive.write_document(TIMELINE_DOCUMENT, _timeline(9))
        archive.commit()
        archive.restore(1)
        assert _archive(path).read_document(TIMELINE_DOCUMENT).unwrap() == _timeline(9)

    def test_a_restored_timeline_can_be_committed(self, tmp_path: Path) -> None:
        path = tmp_path / "holiday.nova"
        archive = _saved(path)
        archive.checkpoint(recorded_at_ms=2_000)
        archive.commit()
        archive.write_document(TIMELINE_DOCUMENT, _timeline(9))
        archive.commit()
        archive.restore(1)
        archive.commit()
        assert _archive(path).read_document(TIMELINE_DOCUMENT).unwrap() == _timeline()

    def test_a_revision_that_was_never_taken_is_refused(self, tmp_path: Path) -> None:
        archive = _saved(tmp_path / "holiday.nova")
        problem = archive.restore(99).unwrap_err()
        assert problem.code == "NS-STORAGE-4004"

    def test_the_refusal_names_the_revision(self, tmp_path: Path) -> None:
        archive = _saved(tmp_path / "holiday.nova")
        assert "99" in archive.restore(99).unwrap_err().message


# -- checksums ---------------------------------------------------------------


class TestChecksums:
    def test_a_healthy_file_reports_no_damage(self, tmp_path: Path) -> None:
        path = tmp_path / "holiday.nova"
        _saved(path)
        assert _archive(path).damaged_entries().unwrap() == ()

    def test_a_flipped_byte_is_never_silently_accepted(self, tmp_path: Path) -> None:
        """Either the container refuses to open, or it names what is broken.

        A flipped byte lands in compressed data more often than not, and a broken
        deflate stream is found by the zip reader before our checksums are read.
        That is still the right answer: what is never acceptable is shrugging and
        handing back a document we cannot vouch for.
        """
        path = tmp_path / "holiday.nova"
        _saved(path)
        data = bytearray(path.read_bytes())
        data[60] ^= 0xFF
        path.write_bytes(bytes(data))
        archive = _archive(path)
        reported = archive.damaged_entries().is_err() or bool(archive.damaged_entries().unwrap())
        assert reported

    def test_the_damaged_entry_is_named(self, tmp_path: Path) -> None:
        path = tmp_path / "holiday.nova"
        archive = _saved(path)
        archive.write_blob("preview.jpg", b"poster-bytes-are-here")
        archive.commit()
        with zipfile.ZipFile(path) as zipped:
            names = zipped.namelist()
        _replace_entry(path, names, "preview.jpg", b"corrupted-poster-bytes")
        assert _archive(path).damaged_entries().unwrap() == ("preview.jpg",)

    def test_damage_does_not_stop_a_document_being_read(self, tmp_path: Path) -> None:
        path = tmp_path / "holiday.nova"
        archive = _saved(path)
        archive.write_blob("preview.jpg", b"poster")
        archive.commit()
        with zipfile.ZipFile(path) as zipped:
            names = zipped.namelist()
        _replace_entry(path, names, "preview.jpg", b"nope")
        damaged = _archive(path)
        assert damaged.damaged_entries().unwrap() == ("preview.jpg",)
        assert damaged.read_document(PROJECT_DOCUMENT).unwrap() == {"name": "holiday"}

    def test_a_file_without_checksums_is_not_damaged(self, tmp_path: Path) -> None:
        path = tmp_path / "holiday.nova"
        _saved(path)
        _rewrite_without(path, "checksum.json")
        assert _archive(path).damaged_entries().unwrap() == ()

    def test_the_checksum_entry_covers_the_documents(self, tmp_path: Path) -> None:
        path = tmp_path / "holiday.nova"
        _saved(path)
        archive = _archive(path)
        assert archive.read_document("checksum.json").unwrap()["entries"]  # type: ignore[index]


# -- helpers -----------------------------------------------------------------


def _unwritable(archive: ZipProjectArchive, tmp_path: Path) -> None:
    """Point an archive at a path that cannot be written: a file in the way.

    The adapter creates a missing directory on purpose — a project may be saved
    into a folder the user just made — so the way to make a save fail is to put
    something where the directory has to go.
    """
    blocker = tmp_path / "blocker"
    blocker.write_text("not a directory")
    archive._path = blocker / "holiday.nova"  # type: ignore[assignment]


def _replace_entry(path: Path, names: list[str], target: str, data: bytes) -> None:
    """Rewrite the archive with one entry's bytes changed, order preserved."""
    with zipfile.ZipFile(path) as zipped:
        payloads = {name: zipped.read(name) for name in names}
    payloads[target] = data
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as zipped:
        for name in names:
            zipped.writestr(name, payloads[name])


def _rewrite_without(path: Path, dropped: str) -> None:
    with zipfile.ZipFile(path) as zipped:
        names = [name for name in zipped.namelist() if name != dropped]
        payloads = {name: zipped.read(name) for name in names}
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as zipped:
        for name in names:
            zipped.writestr(name, payloads[name])
