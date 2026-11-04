"""`infra/persistence/cache.py` and `work.py` — derived bytes, and one transaction.

The cache index pins the bookkeeping: what is cached, what it costs, when it was
last used, and that the *decision* about eviction is not made here — that is
`domain/persistence.select_for_eviction`, a pure function, which is why the rule
is reviewable in one screen and testable without a database.

The unit of work pins the promise ADR-0004 §3 makes: the document and the rows
commit together or not at all. Specifically, that a failure leaves the *rows*
behind rather than the document behind, because rows can be rebuilt from the
document and a document cannot be rebuilt from rows.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

from nova_studio.domain.persistence import (
    PROJECT_DOCUMENT,
    TIMELINE_DOCUMENT,
    CacheEntry,
    CacheKind,
    ProjectManifest,
    select_for_eviction,
)
from nova_studio.infra.persistence import (
    PersistenceCommitError,
    PersistenceUnitOfWork,
    ZipProjectArchive,
    open_cache_index,
)
from nova_studio.infra.persistence.cache import _COLUMNS
from nova_studio.infra.persistence.sqlite import SqliteError, SqliteGateway

if TYPE_CHECKING:
    from pathlib import Path

pytestmark = pytest.mark.unit

T0 = 1_700_000_000_000


def _entry(key: str, **over: object) -> CacheEntry:
    defaults: dict[str, object] = {
        "key": key,
        "kind": CacheKind.THUMBNAIL,
        "size_bytes": 100,
        "created_ms": T0,
        "last_used_ms": T0,
    }
    return CacheEntry(**{**defaults, **over})  # type: ignore[arg-type]


def _index(tmp_path: Path):
    return open_cache_index(tmp_path / "cache.sqlite3")


def _project(tmp_path: Path) -> ZipProjectArchive:
    archive = ZipProjectArchive(tmp_path / "holiday.nova")
    archive.write_manifest(
        ProjectManifest(
            project_id="01J8ZZ9K3M4N5P6Q7R8S9T0V1W",
            format_version=2,
            app_version="0.1.0",
            created_ms=T0,
            modified_ms=T0,
        )
    )
    archive.write_document(PROJECT_DOCUMENT, {"name": "holiday"})
    archive.write_document(TIMELINE_DOCUMENT, {"timebase": [30, 1], "tracks": [], "markers": []})
    archive.commit()
    return archive


# -- the cache index ---------------------------------------------------------


class TestPuttingAndGetting:
    def test_an_entry_round_trips(self, tmp_path: Path) -> None:
        index = _index(tmp_path)
        index.put(_entry("a"))
        assert index.get("a") == _entry("a")

    def test_a_missing_entry_is_none(self, tmp_path: Path) -> None:
        assert _index(tmp_path).get("nope") is None

    def test_the_kind_survives(self, tmp_path: Path) -> None:
        index = _index(tmp_path)
        index.put(_entry("a", kind=CacheKind.PROXY))
        assert index.get("a").kind is CacheKind.PROXY  # type: ignore[union-attr]

    def test_the_size_survives(self, tmp_path: Path) -> None:
        index = _index(tmp_path)
        index.put(_entry("a", size_bytes=4_096))
        assert index.get("a").size_bytes == 4_096  # type: ignore[union-attr]

    def test_a_pinned_entry_stays_pinned(self, tmp_path: Path) -> None:
        index = _index(tmp_path)
        index.put(_entry("a", pinned=True))
        assert index.get("a").pinned  # type: ignore[union-attr]

    def test_putting_twice_replaces(self, tmp_path: Path) -> None:
        index = _index(tmp_path)
        index.put(_entry("a", size_bytes=100))
        index.put(_entry("a", size_bytes=200))
        assert index.get("a").size_bytes == 200  # type: ignore[union-attr]

    def test_replacing_keeps_when_it_was_created(self, tmp_path: Path) -> None:
        """A rebuilt artefact must not look freshly created, or it never ages out."""
        index = _index(tmp_path)
        index.put(_entry("a", created_ms=T0))
        index.put(_entry("a", created_ms=T0, size_bytes=1, last_used_ms=T0 + 50))
        assert index.get("a").created_ms == T0  # type: ignore[union-attr]


class TestListing:
    def test_every_entry_is_listed(self, tmp_path: Path) -> None:
        index = _index(tmp_path)
        index.put(_entry("a"))
        index.put(_entry("b"))
        assert [item.key for item in index.entries()] == ["a", "b"]

    def test_the_list_is_ordered(self, tmp_path: Path) -> None:
        """SQL without ORDER BY may return anything it likes."""
        index = _index(tmp_path)
        for key in ("c", "a", "b"):
            index.put(_entry(key))
        assert [item.key for item in index.entries()] == ["a", "b", "c"]

    def test_it_can_be_filtered_to_one_kind(self, tmp_path: Path) -> None:
        index = _index(tmp_path)
        index.put(_entry("a", kind=CacheKind.THUMBNAIL))
        index.put(_entry("b", kind=CacheKind.PROXY))
        assert [item.key for item in index.entries(CacheKind.PROXY)] == ["b"]

    def test_an_empty_index_lists_nothing(self, tmp_path: Path) -> None:
        assert _index(tmp_path).entries() == ()

    def test_total_bytes_adds_up(self, tmp_path: Path) -> None:
        index = _index(tmp_path)
        index.put(_entry("a", size_bytes=100))
        index.put(_entry("b", size_bytes=250))
        assert index.total_bytes() == 350

    def test_an_empty_index_costs_nothing(self, tmp_path: Path) -> None:
        assert _index(tmp_path).total_bytes() == 0


class TestTouching:
    def test_touching_records_the_use(self, tmp_path: Path) -> None:
        index = _index(tmp_path)
        index.put(_entry("a"))
        index.touch("a", at_ms=T0 + 10)
        assert index.get("a").last_used_ms == T0 + 10  # type: ignore[union-attr]

    def test_touching_an_unknown_key_is_not_an_error(self, tmp_path: Path) -> None:
        assert _index(tmp_path).touch("nope", at_ms=T0).is_ok()

    def test_touching_never_moves_time_backwards(self, tmp_path: Path) -> None:
        index = _index(tmp_path)
        index.put(_entry("a", last_used_ms=T0 + 100))
        index.touch("a", at_ms=T0 + 10)
        assert index.get("a").last_used_ms == T0 + 100  # type: ignore[union-attr]

    def test_touching_leaves_the_created_time_alone(self, tmp_path: Path) -> None:
        index = _index(tmp_path)
        index.put(_entry("a"))
        index.touch("a", at_ms=T0 + 10)
        assert index.get("a").created_ms == T0  # type: ignore[union-attr]


class TestRemoving:
    def test_an_entry_is_removed(self, tmp_path: Path) -> None:
        index = _index(tmp_path)
        index.put(_entry("a"))
        index.remove("a")
        assert index.get("a") is None

    def test_removing_frees_the_bytes(self, tmp_path: Path) -> None:
        index = _index(tmp_path)
        index.put(_entry("a", size_bytes=100))
        index.remove("a")
        assert index.total_bytes() == 0

    def test_removing_an_absent_key_is_not_an_error(self, tmp_path: Path) -> None:
        assert _index(tmp_path).remove("nope").is_ok()


class TestEvictionStaysInTheDomain:
    def test_the_index_feeds_the_pure_planner(self, tmp_path: Path) -> None:
        from nova_studio.domain.persistence import CacheBudget

        index = _index(tmp_path)
        index.put(_entry("stale", last_used_ms=T0))
        index.put(_entry("fresh", last_used_ms=T0 + 500))
        budget = CacheBudget(max_bytes=250)
        victims = select_for_eviction(index.entries(), 100, budget)
        assert [item.key for item in victims] == ["stale"]

    def test_a_pinned_entry_is_not_a_victim(self, tmp_path: Path) -> None:
        from nova_studio.domain.persistence import CacheBudget

        index = _index(tmp_path)
        index.put(_entry("busy", pinned=True, last_used_ms=T0))
        index.put(_entry("idle", last_used_ms=T0 + 500))
        victims = select_for_eviction(index.entries(), 100, CacheBudget(max_bytes=250))
        assert [item.key for item in victims] == ["idle"]


class TestTheTable:
    def test_it_exists_after_opening(self, tmp_path: Path) -> None:
        _index(tmp_path)
        with SqliteGateway(tmp_path / "cache.sqlite3") as gateway:
            names = {
                row["name"]
                for row in gateway.rows("SELECT name FROM sqlite_master WHERE type = 'table'")
            }
        assert "cache_index" in names

    def test_every_column_the_domain_needs_is_there(self, tmp_path: Path) -> None:
        """The columns are the domain's own field names, so they cannot drift."""
        _index(tmp_path)
        with SqliteGateway(tmp_path / "cache.sqlite3") as gateway:
            columns = {row["name"] for row in gateway.rows("PRAGMA table_info(cache_index)")}
        assert set(_COLUMNS) <= columns

    def test_the_index_is_reopenable(self, tmp_path: Path) -> None:
        index = _index(tmp_path)
        index.put(_entry("a"))
        index.close()
        assert _index(tmp_path).get("a") == _entry("a")


# -- the sqlite gateway ------------------------------------------------------


class TestTheGateway:
    def test_it_creates_the_file(self, tmp_path: Path) -> None:
        with SqliteGateway(tmp_path / "db.sqlite3") as gateway:
            gateway.script("CREATE TABLE t (a INTEGER)")
        assert (tmp_path / "db.sqlite3").exists()

    def test_it_refuses_a_file_that_is_not_there(self, tmp_path: Path) -> None:
        with pytest.raises(SqliteError, match="no database"):
            SqliteGateway(tmp_path / "absent.sqlite3", create=False).open()

    def test_a_query_returns_mappings(self, tmp_path: Path) -> None:
        with SqliteGateway(tmp_path / "db.sqlite3") as gateway:
            gateway.script("CREATE TABLE t (a INTEGER)")
            gateway.run("INSERT INTO t VALUES (?)", (7,))
            assert gateway.rows("SELECT a FROM t") == ({"a": 7},)

    def test_a_value_query_returns_one_value(self, tmp_path: Path) -> None:
        with SqliteGateway(tmp_path / "db.sqlite3") as gateway:
            gateway.script("CREATE TABLE t (a INTEGER)")
            gateway.run("INSERT INTO t VALUES (?)", (7,))
            assert gateway.value("SELECT a FROM t") == 7

    def test_a_rollback_after_a_commit_is_safe(self, tmp_path: Path) -> None:
        with SqliteGateway(tmp_path / "db.sqlite3") as gateway:
            gateway.script("CREATE TABLE t (a INTEGER)")
            gateway.begin()
            gateway.run("INSERT INTO t VALUES (?)", (7,))
            gateway.commit()
            gateway.rollback()

    def test_a_transaction_is_visible(self, tmp_path: Path) -> None:
        with SqliteGateway(tmp_path / "db.sqlite3") as gateway:
            gateway.begin()
            assert gateway.in_transaction()
            gateway.commit()

    def test_using_a_closed_gateway_is_an_error(self, tmp_path: Path) -> None:
        gateway = SqliteGateway(tmp_path / "db.sqlite3")
        with pytest.raises(SqliteError, match="not open"):
            gateway.script("CREATE TABLE t (a INTEGER)")

    def test_the_wal_is_on(self, tmp_path: Path) -> None:
        with SqliteGateway(tmp_path / "db.sqlite3") as gateway:
            assert gateway.value("PRAGMA journal_mode") == "wal"


# -- the unit of work --------------------------------------------------------


class TestTheUnitOfWork:
    def test_both_halves_commit(self, tmp_path: Path) -> None:
        archive = _project(tmp_path)
        index = _index(tmp_path)
        with PersistenceUnitOfWork(archive=archive, rows=index) as work:
            archive.write_document(PROJECT_DOCUMENT, {"name": "renamed"})
            index.put(_entry("a"))
            work.commit()
        assert work.document_committed and work.rows_committed

    def test_the_document_is_durable(self, tmp_path: Path) -> None:
        archive = _project(tmp_path)
        with PersistenceUnitOfWork(archive=archive, rows=_index(tmp_path)) as work:
            archive.write_document(PROJECT_DOCUMENT, {"name": "renamed"})
            work.commit()
        assert ZipProjectArchive(tmp_path / "holiday.nova").read_document(
            PROJECT_DOCUMENT
        ).unwrap() == {"name": "renamed"}

    def test_the_rows_are_durable(self, tmp_path: Path) -> None:
        index = _index(tmp_path)
        with PersistenceUnitOfWork(archive=_project(tmp_path), rows=index) as work:
            index.put(_entry("a"))
            work.commit()
        assert index.get("a") is not None

    def test_a_block_that_forgets_to_commit_rolls_back(self, tmp_path: Path) -> None:
        archive = _project(tmp_path)
        index = _index(tmp_path)
        with PersistenceUnitOfWork(archive=archive, rows=index):
            archive.write_document(PROJECT_DOCUMENT, {"name": "never"})
            index.put(_entry("never"))
        assert archive.read_document(PROJECT_DOCUMENT).unwrap() == {"name": "holiday"}
        assert index.get("never") is None

    def test_an_exception_rolls_back(self, tmp_path: Path) -> None:
        archive = _project(tmp_path)
        index = _index(tmp_path)

        def edit_then_fail() -> None:
            with PersistenceUnitOfWork(archive=archive, rows=index):
                archive.write_document(PROJECT_DOCUMENT, {"name": "never"})
                index.put(_entry("never"))
                raise RuntimeError("something went wrong")

        with pytest.raises(RuntimeError):
            edit_then_fail()
        assert archive.read_document(PROJECT_DOCUMENT).unwrap() == {"name": "holiday"}
        assert index.get("never") is None

    def test_committing_twice_is_refused(self, tmp_path: Path) -> None:
        archive = _project(tmp_path)
        with PersistenceUnitOfWork(archive=archive, rows=_index(tmp_path)) as work:
            archive.write_document(PROJECT_DOCUMENT, {"name": "renamed"})
            work.commit()
            with pytest.raises(PersistenceCommitError, match="already closed"):
                work.commit()

    def test_rollback_after_commit_is_a_no_op(self, tmp_path: Path) -> None:
        archive = _project(tmp_path)
        with PersistenceUnitOfWork(archive=archive, rows=_index(tmp_path)) as work:
            archive.write_document(PROJECT_DOCUMENT, {"name": "renamed"})
            work.commit()
            work.rollback()
        assert archive.read_document(PROJECT_DOCUMENT).unwrap() == {"name": "renamed"}

    def test_it_reports_being_active(self, tmp_path: Path) -> None:
        with PersistenceUnitOfWork(archive=_project(tmp_path)) as work:
            assert work.is_active()
            work.commit()
        assert not work.is_active()

    def test_it_works_without_rows(self, tmp_path: Path) -> None:
        archive = _project(tmp_path)
        with PersistenceUnitOfWork(archive=archive) as work:
            archive.write_document(PROJECT_DOCUMENT, {"name": "renamed"})
            work.commit()
        assert work.document_committed

    def test_a_document_that_cannot_be_saved_raises(self, tmp_path: Path) -> None:
        archive = _project(tmp_path)
        blocker = tmp_path / "blocker"
        blocker.write_text("not a directory")
        archive._path = blocker / "holiday.nova"  # type: ignore[assignment]

        def commit_into_a_wall() -> None:
            with PersistenceUnitOfWork(archive=archive, rows=_index(tmp_path)) as work:
                archive.write_document(PROJECT_DOCUMENT, {"name": "renamed"})
                work.commit()

        with pytest.raises(PersistenceCommitError) as caught:
            commit_into_a_wall()
        assert caught.value.document_committed is False
        assert caught.value.rows_committed is False

    def test_the_raised_error_carries_the_port_vocabulary(self, tmp_path: Path) -> None:
        archive = _project(tmp_path)
        blocker = tmp_path / "blocker"
        blocker.write_text("not a directory")
        archive._path = blocker / "holiday.nova"  # type: ignore[assignment]

        def commit_into_a_wall() -> None:
            with PersistenceUnitOfWork(archive=archive) as work:
                archive.write_document(PROJECT_DOCUMENT, {"name": "renamed"})
                work.commit()

        with pytest.raises(PersistenceCommitError) as caught:
            commit_into_a_wall()
        assert caught.value.error.code == "NS-STORAGE-4005"
        assert caught.value.error.retryable

    def test_a_failed_unit_leaves_nothing_half_written(self, tmp_path: Path) -> None:
        """Leaving the block rolls back, so a retry starts from a known state.

        The archive keeps the staged work for a caller that retries *without*
        leaving the block (pinned in `test_persistence_archive.py`); a `with`
        block that ends in failure is over, and its rollback is what makes the
        next attempt honest.
        """
        archive = _project(tmp_path)
        saved = tmp_path / "holiday.nova"
        blocker = tmp_path / "blocker"
        blocker.write_text("not a directory")
        archive._path = blocker / "holiday.nova"  # type: ignore[assignment]

        def commit_into_a_wall() -> None:
            with PersistenceUnitOfWork(archive=archive) as work:
                archive.write_document(PROJECT_DOCUMENT, {"name": "renamed"})
                work.commit()

        with pytest.raises(PersistenceCommitError):
            commit_into_a_wall()
        archive._path = saved  # type: ignore[assignment]
        assert ZipProjectArchive(saved).read_document(PROJECT_DOCUMENT).unwrap() == {
            "name": "holiday"
        }
