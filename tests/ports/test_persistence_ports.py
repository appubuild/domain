"""The persistence port contract, driven by in-memory fakes.

The doubles here are deliberately faithful about the two properties that make
persistence trustworthy and are invisible in a happy-path test:

* **Staging.**  A write that is not committed must not be visible to a reader of
  the committed state, and a failed commit must leave the previous version
  intact *and* the staged changes available for a retry.  A crash is only safe
  if the old bytes are still there.
* **Resumability.**  The journal is read by sequence number, so recovery can
  stop, restart and continue without re-reading or losing its place — and a
  partial trailing line is reported rather than turning into corruption.

Conformance, narrowness and the ``runtime_checkable`` limitation are pinned
exactly as in ``tests/ports/test_media_ports.py``; purity is checked by parsing
the port's imports.  No SQLite, no ZIP, no filesystem anywhere in this file.
"""

from __future__ import annotations

import pathlib
from typing import TYPE_CHECKING, Any

import pytest

from nova_studio.core import ErrorDomain, error_result, ok
from nova_studio.domain.persistence import (
    CacheBudget,
    CacheEntry,
    CacheKind,
    JournalEntry,
    JournalWindow,
    ProjectManifest,
    RevisionRef,
    is_valid_document_name,
    revision_document,
    select_for_eviction,
)
from nova_studio.ports.persistence import (
    CacheIndex,
    Journal,
    PersistenceErrorCode,
    ProjectArchive,
    UnitOfWork,
)

if TYPE_CHECKING:
    from collections.abc import Mapping, Sequence

pytestmark = pytest.mark.unit

T0 = 1_700_000_000_000


def _manifest(**overrides: Any) -> ProjectManifest:
    defaults: dict[str, Any] = {
        "project_id": "01999999-0000-7000-8000-000000000000",
        "format_version": 1,
        "app_version": "0.1.0",
        "created_ms": T0,
        "modified_ms": T0,
    }
    return ProjectManifest(**{**defaults, **overrides})


class MemoryArchive:
    """A ``.nova`` container with a staged layer and a committed layer."""

    def __init__(self, *, fail_on_commit_with: PersistenceErrorCode | None = None) -> None:
        self._manifest = _manifest()
        self._documents: dict[str, Mapping[str, object]] = {
            "timeline/document.json": {"tracks": []}
        }
        self._blobs: dict[str, bytes] = {}
        self._revisions: list[RevisionRef] = []
        self._staged: dict[str, Any] = {}
        self._fail_with = fail_on_commit_with
        self.closed = False
        self.commit_count = 0

    # -- reads ------------------------------------------------------------

    def read_manifest(self) -> Any:
        if self._manifest.format_version > 1:
            return error_result(
                PersistenceErrorCode.UNSUPPORTED_VERSION,
                f"project format {self._manifest.format_version} is newer than 1",
                domain=ErrorDomain.STORAGE,
                remedy="Update Nova Studio to open this project.",
            )
        return ok(self._manifest)

    def read_document(self, name: str) -> Any:
        if not is_valid_document_name(name):
            return error_result(
                PersistenceErrorCode.CORRUPT,
                f"{name!r} is not a valid document name",
                domain=ErrorDomain.STORAGE,
            )
        staged = self._staged.get(("document", name))
        if staged is not None:
            return ok(staged)
        if name in self._documents:
            return ok(self._documents[name])
        return error_result(
            PersistenceErrorCode.NO_SUCH_REVISION,
            f"{name} is not in this project",
            domain=ErrorDomain.STORAGE,
        )

    def read_blob(self, name: str) -> Any:
        staged = self._staged.get(("blob", name))
        if staged is not None:
            return ok(staged)
        if name in self._blobs:
            return ok(self._blobs[name])
        return error_result(PersistenceErrorCode.NO_SUCH_REVISION, f"{name} is not in this project")

    def revisions(self) -> Any:
        return ok(tuple(sorted(self._revisions, key=lambda revision: revision.sequence)))

    # -- staged writes ----------------------------------------------------

    def write_manifest(self, manifest: ProjectManifest) -> Any:
        self._staged[("manifest",)] = manifest
        return ok(None)

    def write_document(self, name: str, document: Mapping[str, object]) -> Any:
        if not is_valid_document_name(name):
            return error_result(
                PersistenceErrorCode.CORRUPT,
                f"{name!r} is not a valid document name",
                domain=ErrorDomain.STORAGE,
            )
        self._staged[("document", name)] = dict(document)
        return ok(None)

    def write_blob(self, name: str, data: bytes) -> Any:
        self._staged[("blob", name)] = data
        return ok(None)

    def checkpoint(self, *, recorded_at_ms: int, label: str = "") -> Any:
        sequence = len(self._revisions) + 1
        revision = RevisionRef(sequence=sequence, recorded_at_ms=recorded_at_ms, label=label)
        self._staged.setdefault(("revision",), []).append(
            (revision, dict(self._staged.get(("document", "timeline/document.json"), {})))
        )
        return ok(revision)

    def restore(self, sequence: int) -> Any:
        for revision, document in self._committed_revisions():
            if revision.sequence == sequence:
                self._staged[("document", "timeline/document.json")] = document
                return ok(document)
        return error_result(
            PersistenceErrorCode.NO_SUCH_REVISION,
            f"no revision {sequence}",
            domain=ErrorDomain.STORAGE,
        )

    # -- lifecycle --------------------------------------------------------

    def commit(self) -> Any:
        if self._fail_with is not None:
            return error_result(
                self._fail_with, "the volume is read-only", domain=ErrorDomain.STORAGE
            )
        for key, value in self._staged.items():
            if key == ("manifest",):
                self._manifest = value
            elif key[0] == "document":
                self._documents[key[1]] = value
            elif key[0] == "blob":
                self._blobs[key[1]] = value
            elif key[0] == "revision":
                for revision, document in value:
                    self._revisions.append(revision)
                    self._documents[revision.document_name] = document
        self._staged.clear()
        self.commit_count += 1
        return ok(None)

    def discard(self) -> None:
        self._staged.clear()

    def close(self) -> None:
        self.closed = True

    # -- test helpers -----------------------------------------------------

    def _committed_revisions(self) -> Sequence[tuple[RevisionRef, Mapping[str, object]]]:
        return tuple(
            (revision, self._documents.get(revision.document_name, {}))
            for revision in sorted(self._revisions, key=lambda item: item.sequence)
        )

    def committed_documents(self) -> Mapping[str, Mapping[str, object]]:
        return dict(self._documents)


class MemoryJournal:
    """An append-only log that can simulate the crash it exists to survive."""

    def __init__(self, *, torn_tail: bool = False) -> None:
        self._entries: list[JournalEntry] = []
        self._torn_tail = torn_tail
        self.closed = False

    def append(self, entry: JournalEntry) -> Any:
        self._entries.append(entry)
        return ok(None)

    def read_since(self, sequence: int) -> Any:
        entries = tuple(entry for entry in self._entries if entry.sequence > sequence)
        next_sequence = entries[-1].sequence if entries else 0
        return ok(
            JournalWindow(entries=entries, next_sequence=next_sequence, torn_tail=self._torn_tail)
        )

    def truncate_through(self, sequence: int) -> Any:
        self._entries = [entry for entry in self._entries if entry.sequence > sequence]
        return ok(None)

    def close(self) -> None:
        self.closed = True


class MemoryCacheIndex:
    """LRU bookkeeping only; the eviction decision is the domain's."""

    def __init__(self) -> None:
        self._entries: dict[str, CacheEntry] = {}
        self.closed = False

    def get(self, key: str) -> CacheEntry | None:
        return self._entries.get(key)

    def put(self, entry: CacheEntry) -> Any:
        self._entries[entry.key] = entry
        return ok(None)

    def touch(self, key: str, *, at_ms: int) -> Any:
        existing = self._entries.get(key)
        if existing is not None:
            self._entries[key] = existing.touch(at_ms)
        return ok(None)

    def remove(self, key: str) -> Any:
        self._entries.pop(key, None)
        return ok(None)

    def entries(self, kind: CacheKind | None = None) -> tuple[CacheEntry, ...]:
        found = [entry for entry in self._entries.values() if kind is None or entry.kind is kind]
        return tuple(sorted(found, key=lambda entry: entry.key))

    def total_bytes(self) -> int:
        return sum(entry.size_bytes for entry in self._entries.values())

    def close(self) -> None:
        self.closed = True


class MemoryUnitOfWork:
    """A transaction that records how it was left."""

    def __init__(self) -> None:
        self.committed = False
        self.rolled_back = False
        self.active = False
        self.staged: list[str] = []

    def __enter__(self) -> MemoryUnitOfWork:
        self.active = True
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: object,
    ) -> None:
        if self.active:
            self.rollback()

    def commit(self) -> None:
        if not self.active:
            raise RuntimeError("cannot commit a unit that is not active")
        self.committed = True
        self.active = False

    def rollback(self) -> None:
        self.rolled_back = True
        self.active = False

    def is_active(self) -> bool:
        return self.active


class TestProtocolConformance:
    def test_each_double_satisfies_its_port(self) -> None:
        assert isinstance(MemoryArchive(), ProjectArchive)
        assert isinstance(MemoryJournal(), Journal)
        assert isinstance(MemoryCacheIndex(), CacheIndex)
        assert isinstance(MemoryUnitOfWork(), UnitOfWork)

    def test_subclass_checks_work_because_every_member_is_a_method(self) -> None:
        """Data members would make ``issubclass`` raise ``TypeError``."""
        assert issubclass(MemoryArchive, ProjectArchive)
        assert issubclass(MemoryJournal, Journal)
        assert issubclass(MemoryUnitOfWork, UnitOfWork)


class TestNarrowness:
    def test_an_archive_is_not_a_journal(self) -> None:
        archive = MemoryArchive()
        assert isinstance(archive, ProjectArchive)
        assert not isinstance(archive, Journal)

    def test_a_cache_is_not_a_journal(self) -> None:
        cache = MemoryCacheIndex()
        assert isinstance(cache, CacheIndex)
        assert not isinstance(cache, Journal)

    def test_a_partial_double_is_refused(self) -> None:
        class OnlyClose:
            def close(self) -> None: ...

        assert not isinstance(OnlyClose(), ProjectArchive)
        assert not isinstance(OnlyClose(), Journal)
        assert not isinstance(OnlyClose(), CacheIndex)


class TestRuntimeCheckableLimitations:
    def test_a_double_with_the_right_names_and_wrong_behaviour_passes(self) -> None:
        class WrongArchive:
            def read_manifest(self) -> ProjectManifest:
                return _manifest()

            def read_document(self, name: str) -> dict[str, object]:
                return {}

            def read_blob(self, name: str) -> bytes:
                return b""

            def revisions(self) -> tuple[RevisionRef, ...]:
                return ()

            def write_manifest(self, manifest: ProjectManifest) -> None: ...

            def write_document(self, name: str, document: object) -> None: ...

            def write_blob(self, name: str, data: bytes) -> None: ...

            def checkpoint(self, *, recorded_at_ms: int, label: str = "") -> RevisionRef: ...

            def restore(self, sequence: int) -> dict[str, object]:
                return {}

            def commit(self) -> None: ...

            def discard(self) -> None: ...

            def close(self) -> None: ...

        assert isinstance(WrongArchive(), ProjectArchive)

    def test_the_mistake_surfaces_at_the_call_not_at_the_check(self) -> None:
        class WrongArchive:
            def read_manifest(self) -> ProjectManifest:
                return _manifest()

            def read_document(self, name: str) -> dict[str, object]:
                return {}

            def read_blob(self, name: str) -> bytes:
                return b""

            def revisions(self) -> tuple[RevisionRef, ...]:
                return ()

            def write_manifest(self, manifest: ProjectManifest) -> None: ...

            def write_document(self, name: str, document: object) -> None: ...

            def write_blob(self, name: str, data: bytes) -> None: ...

            def checkpoint(self, *, recorded_at_ms: int, label: str = "") -> RevisionRef: ...

            def restore(self, sequence: int) -> dict[str, object]:
                return {}

            def commit(self) -> None: ...

            def discard(self) -> None: ...

            def close(self) -> None: ...

        result = WrongArchive().read_manifest()
        assert not hasattr(result, "is_ok"), "a bare value has no Result protocol"


class TestErrorCodes:
    def test_codes_are_stable_strings(self) -> None:
        assert PersistenceErrorCode.UNWRITABLE == "NS-STORAGE-4001"
        assert PersistenceErrorCode.CORRUPT == "NS-STORAGE-4002"
        assert PersistenceErrorCode.UNSUPPORTED_VERSION == "NS-STORAGE-4003"
        assert PersistenceErrorCode.NO_SUCH_REVISION == "NS-STORAGE-4004"
        assert PersistenceErrorCode.IO_FAILED == "NS-STORAGE-4005"

    def test_codes_are_unique_and_namespaced(self) -> None:
        values = [code.value for code in PersistenceErrorCode]
        assert len(values) == len(set(values))
        assert all(value.startswith("NS-STORAGE-") for value in values)

    def test_the_media_port_codes_do_not_collide(self) -> None:
        from nova_studio.ports.media import MediaErrorCode

        overlap = {code.value for code in PersistenceErrorCode} & {
            code.value for code in MediaErrorCode
        }
        assert not overlap

    def test_a_code_builds_a_structured_error(self) -> None:
        failure = error_result(
            PersistenceErrorCode.UNSUPPORTED_VERSION,
            "project format 2 is newer than 1",
            domain=ErrorDomain.STORAGE,
            details={"found": 2, "supported": 1},
            remedy="Update Nova Studio to open this project.",
        )
        error = failure.unwrap_err()
        assert error.code == "NS-STORAGE-4003"
        assert error.domain is ErrorDomain.STORAGE
        assert error.remedy
        assert error.details["supported"] == 1


class TestTheArchiveIsStaged:
    def test_a_write_is_invisible_to_the_committed_state_until_commit(self) -> None:
        archive = MemoryArchive()
        archive.write_document("timeline/document.json", {"tracks": [{"id": 1}]})
        assert archive.committed_documents()["timeline/document.json"] == {"tracks": []}
        assert archive.commit().is_ok()
        assert archive.committed_documents()["timeline/document.json"] == {"tracks": [{"id": 1}]}

    def test_a_reader_sees_its_own_staged_writes(self) -> None:
        archive = MemoryArchive()
        archive.write_document("timeline/document.json", {"tracks": [1]})
        assert archive.read_document("timeline/document.json").unwrap() == {"tracks": [1]}

    def test_discard_leaves_the_committed_state_untouched(self) -> None:
        archive = MemoryArchive()
        archive.write_document("timeline/document.json", {"tracks": [1]})
        archive.discard()
        assert archive.committed_documents()["timeline/document.json"] == {"tracks": []}

    def test_a_failed_commit_keeps_the_previous_version_and_the_staged_work(self) -> None:
        """The whole point of staging: a crash may never truncate a project,
        and the caller can retry without redoing anything."""
        archive = MemoryArchive(fail_on_commit_with=PersistenceErrorCode.UNWRITABLE)
        archive.write_document("timeline/document.json", {"tracks": [1]})
        result = archive.commit()
        assert result.unwrap_err().code == "NS-STORAGE-4001"
        assert archive.committed_documents()["timeline/document.json"] == {"tracks": []}
        assert archive.read_document("timeline/document.json").unwrap() == {"tracks": [1]}

    def test_a_newer_format_is_refused_whole(self) -> None:
        archive = MemoryArchive()
        archive.write_manifest(_manifest(format_version=2))
        assert archive.commit().is_ok()
        result = archive.read_manifest()
        assert result.unwrap_err().code == "NS-STORAGE-4003"
        assert result.unwrap_err().remedy

    def test_an_invalid_entry_name_is_rejected_before_it_reaches_the_disk(self) -> None:
        archive = MemoryArchive()
        result = archive.write_document("../../escape.json", {})
        assert result.unwrap_err().code == PersistenceErrorCode.CORRUPT

    def test_reading_an_absent_document_reports_a_code_not_an_exception(self) -> None:
        archive = MemoryArchive()
        result = archive.read_document("captions/nope.json")
        assert result.is_err()


class TestCheckpoints:
    def test_a_checkpoint_is_numbered_and_staged(self) -> None:
        archive = MemoryArchive()
        revision = archive.checkpoint(recorded_at_ms=T0, label="before relink").unwrap()
        assert revision.sequence == 1
        assert revision.label == "before relink"
        assert archive.revisions().unwrap() == ()

    def test_committed_checkpoints_are_listed_oldest_first(self) -> None:
        archive = MemoryArchive()
        archive.checkpoint(recorded_at_ms=T0, label="one")
        archive.commit()
        archive.checkpoint(recorded_at_ms=T0 + 1_000, label="two")
        archive.commit()
        revisions = archive.revisions().unwrap()
        assert [revision.label for revision in revisions] == ["one", "two"]
        assert revisions[1].document_name == revision_document(2)

    def test_restoring_stages_the_revision_without_overwriting_the_present(self) -> None:
        archive = MemoryArchive()
        archive.write_document("timeline/document.json", {"tracks": [1]})
        archive.checkpoint(recorded_at_ms=T0, label="v1")
        archive.commit()
        archive.write_document("timeline/document.json", {"tracks": [1, 2]})
        archive.commit()

        restored = archive.restore(1).unwrap()
        assert restored == {"tracks": [1]}
        # Staged only: the user is offered a look before anything is replaced.
        assert archive.committed_documents()["timeline/document.json"] == {"tracks": [1, 2]}
        assert archive.commit().is_ok()
        assert archive.committed_documents()["timeline/document.json"] == {"tracks": [1]}

    def test_restoring_an_absent_revision_reports_a_code(self) -> None:
        archive = MemoryArchive()
        assert archive.restore(9).unwrap_err().code == "NS-STORAGE-4004"


class TestTheJournal:
    @staticmethod
    def _entry(sequence: int, name: str = "MoveClip") -> JournalEntry:
        return JournalEntry(sequence=sequence, recorded_at_ms=T0 + sequence, name=name)

    def test_entries_are_read_back_from_a_sequence_number(self) -> None:
        journal = MemoryJournal()
        journal.append(self._entry(1))
        journal.append(self._entry(2))
        window = journal.read_since(0).unwrap()
        assert [entry.sequence for entry in window.entries] == [1, 2]
        assert window.next_sequence == 2

    def test_recovery_resumes_from_where_it_stopped(self) -> None:
        journal = MemoryJournal()
        for sequence in (1, 2, 3):
            journal.append(self._entry(sequence))
        first = journal.read_since(0).unwrap()
        assert journal.read_since(first.next_sequence).unwrap().entries == ()

    def test_truncating_after_a_checkpoint_drops_the_replayed_commands(self) -> None:
        journal = MemoryJournal()
        for sequence in (1, 2, 3):
            journal.append(self._entry(sequence))
        journal.truncate_through(2)
        window = journal.read_since(0).unwrap()
        assert [entry.sequence for entry in window.entries] == [3]

    def test_a_torn_tail_is_reported_not_treated_as_corruption(self) -> None:
        """Being killed mid-write is the normal state of a journal."""
        journal = MemoryJournal(torn_tail=True)
        journal.append(self._entry(1))
        window = journal.read_since(0).unwrap()
        assert len(window.entries) == 1
        assert window.torn_tail

    def test_an_empty_journal_reads_cleanly(self) -> None:
        window = MemoryJournal().read_since(0).unwrap()
        assert window.entries == () and window.next_sequence == 0


class TestTheCacheIndex:
    @staticmethod
    def _entry(
        key: str, *, last_used_ms: int = T0, size_bytes: int = 100, **kwargs: Any
    ) -> CacheEntry:
        return CacheEntry(
            key=key,
            kind=kwargs.pop("kind", CacheKind.THUMBNAIL),
            size_bytes=size_bytes,
            created_ms=T0,
            last_used_ms=last_used_ms,
            **kwargs,
        )

    def test_put_get_and_touch_round_trip(self) -> None:
        cache = MemoryCacheIndex()
        cache.put(self._entry("a"))
        assert cache.get("a") is not None
        cache.touch("a", at_ms=T0 + 500)
        assert cache.get("a") is not None and cache.get("a").last_used_ms == T0 + 500

    def test_an_absent_key_is_none_not_an_error(self) -> None:
        assert MemoryCacheIndex().get("nope") is None

    def test_touching_an_evicted_key_is_not_an_error(self) -> None:
        cache = MemoryCacheIndex()
        assert cache.touch("nope", at_ms=T0).is_ok()

    def test_removing_an_absent_key_is_not_an_error(self) -> None:
        assert MemoryCacheIndex().remove("nope").is_ok()

    def test_entries_can_be_filtered_by_kind(self) -> None:
        cache = MemoryCacheIndex()
        cache.put(self._entry("t", kind=CacheKind.THUMBNAIL))
        cache.put(self._entry("p", kind=CacheKind.PROXY))
        assert [entry.key for entry in cache.entries(CacheKind.PROXY)] == ["p"]
        assert len(cache.entries()) == 2

    def test_total_bytes_is_the_cost_of_the_cache(self) -> None:
        cache = MemoryCacheIndex()
        cache.put(self._entry("a", size_bytes=100))
        cache.put(self._entry("b", size_bytes=250))
        assert cache.total_bytes() == 350

    def test_eviction_is_planned_by_the_domain_and_executed_by_the_port(self) -> None:
        """The policy is a pure function over what this port exposes."""
        cache = MemoryCacheIndex()
        budget = CacheBudget(max_bytes=1_000)
        for index in range(6):
            cache.put(self._entry(f"e{index}", last_used_ms=T0 + index, size_bytes=250))

        doomed = select_for_eviction(cache.entries(), needed_bytes=250, budget=budget)
        for entry in doomed:
            assert cache.remove(entry.key).is_ok()
        assert cache.total_bytes() + 250 <= budget.max_bytes

    def test_pinned_entries_survive_eviction(self) -> None:
        cache = MemoryCacheIndex()
        budget = CacheBudget(max_bytes=400)
        cache.put(self._entry("busy", size_bytes=400, pinned=True))
        cache.put(self._entry("cold", size_bytes=100, last_used_ms=T0 + 9_000))
        doomed = select_for_eviction(cache.entries(), needed_bytes=200, budget=budget)
        for entry in doomed:
            cache.remove(entry.key)
        assert [entry.key for entry in cache.entries()] == ["busy"]


class TestTheUnitOfWork:
    def test_a_committed_unit_reports_committed(self) -> None:
        with MemoryUnitOfWork() as work:
            work.staged.append("document")
            work.commit()
        assert work.committed
        assert not work.rolled_back

    def test_an_exception_unwinds_into_a_rollback(self) -> None:
        work = MemoryUnitOfWork()

        def _a_block_that_fails() -> None:
            with work:
                raise RuntimeError("disk gone")

        with pytest.raises(RuntimeError, match="disk gone"):
            _a_block_that_fails()
        assert work.rolled_back
        assert not work.committed

    def test_a_unit_is_only_active_inside_its_block(self) -> None:
        work = MemoryUnitOfWork()
        assert not work.is_active()
        with work:
            assert work.is_active()
        assert not work.is_active()

    def test_leaving_a_block_without_committing_rolls_back(self) -> None:
        """A dangling transaction is a deadlock waiting to happen."""
        work = MemoryUnitOfWork()
        with work:
            work.staged.append("document")
        assert work.rolled_back
        assert not work.committed

    def test_committing_an_inactive_unit_is_refused(self) -> None:
        work = MemoryUnitOfWork()
        with pytest.raises(RuntimeError, match="not active"):
            work.commit()


class TestPortPurity:
    """A port that imports an adapter has stopped being a seam."""

    _PATH = pathlib.Path("nova_studio/ports/persistence.py")

    def _imported_modules(self) -> list[str]:
        import ast

        tree = ast.parse(self._PATH.read_text(encoding="utf-8"))
        modules: list[str] = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                modules.extend(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                modules.append(node.module)
        return modules

    @pytest.mark.parametrize("banned", ["sqlite3", "zipfile", "pydantic", "pathlib", "shutil"])
    def test_it_names_no_storage_mechanism(self, banned: str) -> None:
        offenders = [name for name in self._imported_modules() if name.split(".")[0] == banned]
        assert not offenders, f"ports/persistence.py names {banned}: {offenders}"

    def test_it_imports_no_outer_ring(self) -> None:
        offenders = [
            name
            for name in self._imported_modules()
            if name.startswith(("nova_studio.infra", "nova_studio.services", "nova_studio.api"))
        ]
        assert not offenders, f"ports/persistence.py reaches into an outer ring: {offenders}"

    def test_it_imports_the_domain_not_the_reverse(self) -> None:
        """The vocabulary lives in L2's domain half; the port only declares how
        it is moved."""
        assert "nova_studio.domain.persistence" in self._imported_modules()
