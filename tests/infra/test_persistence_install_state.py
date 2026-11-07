"""The install database's other two tables: settings and recent projects.

Both are small, both are read at boot, and both are the kind of thing that is
easy to get *nearly* right — the failure modes are quiet:

* a setting that reads back as ``None`` and silently reverts a preference;
* a "recent" list that grows forever, or that forgets that a project was left
  unsaved, or that is missing an entry because one row would not parse.

So the tests are about those, and about the one property that matters more than
any of them: **a decoration must never fail the work it decorates.** The
workspace records a project after opening it; if the record cannot be written,
the project is still open.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

import pytest

from nova_studio.domain.persistence import RecentProject, Setting
from nova_studio.infra.persistence.migrations import ensure_schema
from nova_studio.infra.persistence.recent import SqliteRecentFiles, open_recent_files
from nova_studio.infra.persistence.settings import SqliteSettingsStore, open_settings_store
from nova_studio.infra.persistence.sqlite import SqliteGateway
from nova_studio.ports.persistence import PersistenceErrorCode

if TYPE_CHECKING:
    from pathlib import Path

pytestmark = pytest.mark.unit

T0 = 1_700_000_000_000


def _setting(
    key: str = "theme",
    value: object = "dark",
    *,
    scope: str = "install",
    updated_ms: int = T0,
) -> Setting:
    return Setting(scope=scope, key=key, value=value, updated_ms=updated_ms)


def _project(path: str = "/a/one.nova", *, opened_ms: int = T0, name: str = "one") -> RecentProject:
    return RecentProject(path=path, project_id=f"id-{path}", name=name, opened_ms=opened_ms)


@pytest.fixture
def db(tmp_path: Path) -> SqliteGateway:
    gateway = SqliteGateway(tmp_path / "nova.db", shared=True)
    gateway.open()
    ensure_schema(gateway)
    return gateway


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------


class TestSettings:
    def test_a_setting_round_trips_with_its_type(self, db: SqliteGateway) -> None:
        store = SqliteSettingsStore(db)
        store.put(_setting("autosave_seconds", 120))
        store.put(_setting("recent_limit", 20))
        store.put(_setting("snap", True))
        store.put(_setting("layout", {"left": ["media"], "right": ["inspector"]}))
        assert store.get("install", "autosave_seconds").value == 120
        assert store.get("install", "snap").value is True
        assert store.get("install", "layout").value == {"left": ["media"], "right": ["inspector"]}

    def test_writing_twice_replaces_and_stamps_the_time(self, db: SqliteGateway) -> None:
        store = SqliteSettingsStore(db)
        store.put(_setting("theme", "dark", updated_ms=T0))
        store.put(_setting("theme", "light", updated_ms=T0 + 5))
        setting = store.get("install", "theme")
        assert setting.value == "light"
        assert setting.updated_ms == T0 + 5

    def test_a_key_that_was_never_written_is_none_not_an_error(self, db: SqliteGateway) -> None:
        assert SqliteSettingsStore(db).get("install", "nope") is None

    def test_a_scope_only_sees_its_own_keys(self, db: SqliteGateway) -> None:
        store = SqliteSettingsStore(db)
        store.put(_setting("theme", "dark"))
        store.put(_setting("theme", "neon", scope="plugin:captions"))
        assert store.get("install", "theme").value == "dark"
        assert store.get("plugin:captions", "theme").value == "neon"
        assert set(store.entries("install")) == {"theme"}
        assert store.entries("install")["theme"].value == "dark"

    def test_deleting_what_is_not_there_is_not_an_error(self, db: SqliteGateway) -> None:
        store = SqliteSettingsStore(db)
        assert store.delete("install", "nope").is_ok()

    def test_a_row_that_is_not_json_is_absent_not_fatal(self, db: SqliteGateway) -> None:
        # One corrupt preference must not stop the window drawing itself: the
        # caller falls back to its default, and the next write fixes the row.
        store = SqliteSettingsStore(db)
        store.put(_setting("good", 1))
        db.run(
            "INSERT INTO settings (scope, key, value, updated_ms) VALUES"
            " ('install', 'bad', '{not json', 1)"
        )
        assert store.get("install", "bad") is None
        assert store.get("install", "good").value == 1
        assert set(store.entries("install")) == {"good"}

    def test_a_failed_write_is_a_code_not_a_crash(self, db: SqliteGateway) -> None:
        store = SqliteSettingsStore(db)
        db.run("DROP TABLE settings")
        problem = store.put(_setting()).unwrap_err()
        assert problem.code == PersistenceErrorCode.UNWRITABLE
        assert problem.details["key"] == "theme"

    def test_a_read_from_a_broken_table_is_empty_not_loud(self, db: SqliteGateway) -> None:
        store = SqliteSettingsStore(db)
        db.run("DROP TABLE settings")
        assert store.get("install", "theme") is None
        assert store.entries("install") == {}

    def test_opening_creates_the_database(self, tmp_path: Path) -> None:
        store = open_settings_store(tmp_path / "data")
        store.put(_setting())
        assert (tmp_path / "data" / "nova.db").exists()
        assert store.get("install", "theme").value == "dark"


# ---------------------------------------------------------------------------
# Recent projects
# ---------------------------------------------------------------------------


class TestRecentProjects:
    def test_the_newest_come_first(self, db: SqliteGateway) -> None:
        store = SqliteRecentFiles(db)
        store.record(_project("/a/one.nova", opened_ms=T0))
        store.record(_project("/a/two.nova", opened_ms=T0 + 10))
        assert [entry.path for entry in store.recent()] == ["/a/two.nova", "/a/one.nova"]

    def test_opening_the_same_path_again_moves_it_and_keeps_one_row(
        self, db: SqliteGateway
    ) -> None:
        # Keyed by path: the second open must not add a second row, or the list
        # the user sees has the same project twice.
        store = SqliteRecentFiles(db)
        store.record(_project("/a/one.nova", opened_ms=T0))
        store.record(_project("/a/one.nova", opened_ms=T0 + 99))
        assert [entry.path for entry in store.recent()] == ["/a/one.nova"]
        assert store.recent()[0].opened_ms == T0 + 99
        assert db.value("SELECT COUNT(*) FROM recent_files") == 1

    def test_the_list_is_bounded_and_keeps_the_newest(self, db: SqliteGateway) -> None:
        store = SqliteRecentFiles(db, keep=3)
        for index in range(10):
            store.record(_project(f"/a/p{index}.nova", opened_ms=T0 + index))
        assert [entry.path for entry in store.recent(limit=50)] == [
            "/a/p9.nova",
            "/a/p8.nova",
            "/a/p7.nova",
        ]

    def test_closing_records_whether_it_was_left_dirty(self, db: SqliteGateway) -> None:
        store = SqliteRecentFiles(db)
        store.record(_project("/a/one.nova"))
        assert store.mark_closed("/a/one.nova", at_ms=T0 + 5, dirty=True).is_ok()
        entry = store.recent()[0]
        assert entry.closed_ms == T0 + 5
        assert entry.dirty is True

    def test_a_close_does_not_remove_the_project(self, db: SqliteGateway) -> None:
        # A list of "projects open right now" is what the workspace is for. The
        # point of *this* list is that it survives the close.
        store = SqliteRecentFiles(db)
        store.record(_project("/a/one.nova"))
        store.mark_closed("/a/one.nova", at_ms=T0 + 5)
        assert [entry.path for entry in store.recent()] == ["/a/one.nova"]

    def test_closing_or_forgetting_what_is_not_there_is_not_an_error(
        self, db: SqliteGateway
    ) -> None:
        store = SqliteRecentFiles(db)
        assert store.mark_closed("/a/never.nova", at_ms=T0).is_ok()
        assert store.forget("/a/never.nova").is_ok()

    def test_forgetting_removes_it(self, db: SqliteGateway) -> None:
        store = SqliteRecentFiles(db)
        store.record(_project("/a/one.nova"))
        store.record(_project("/a/two.nova", opened_ms=T0 + 1))
        store.forget("/a/one.nova")
        assert [entry.path for entry in store.recent()] == ["/a/two.nova"]

    def test_a_row_that_cannot_be_read_hides_only_itself(self, db: SqliteGateway) -> None:
        store = SqliteRecentFiles(db)
        store.record(_project("/a/good.nova"))
        db.run(
            "INSERT INTO recent_files (path, project_id, name, opened_ms, dirty, last_status)"
            " VALUES ('/a/bad.nova', 'id', 'bad', 'not a number', 0, '')"
        )
        assert [entry.path for entry in store.recent()] == ["/a/good.nova"]

    def test_a_failed_record_is_a_code_not_a_crash(self, db: SqliteGateway) -> None:
        store = SqliteRecentFiles(db)
        db.run("DROP TABLE recent_files")
        problem = store.record(_project()).unwrap_err()
        assert problem.code == PersistenceErrorCode.UNWRITABLE
        # And the bound is not left half-applied: the transaction rolled back
        # with the write.
        assert db.in_transaction() is False

    def test_the_query_is_served_by_its_index(self, db: SqliteGateway) -> None:
        plan = db.rows(
            "EXPLAIN QUERY PLAN SELECT * FROM recent_files ORDER BY opened_ms DESC LIMIT ?",
            (20,),
        )
        assert any("recent_files_by_opened" in str(row["detail"]) for row in plan)

    def test_opening_creates_the_database(self, tmp_path: Path) -> None:
        store = open_recent_files(tmp_path / "data")
        store.record(_project())
        assert (tmp_path / "data" / "nova.db").exists()
        assert [entry.path for entry in store.recent()] == ["/a/one.nova"]

    def test_the_bound_is_at_least_one_row(self, db: SqliteGateway) -> None:
        with pytest.raises(ValueError, match="keep must be at least 1"):
            SqliteRecentFiles(db, keep=0)


# ---------------------------------------------------------------------------
# The vocabulary itself
# ---------------------------------------------------------------------------


class TestTheVocabulary:
    def test_a_setting_that_json_cannot_spell_is_refused(self) -> None:
        with pytest.raises(Exception, match="is not JSON"):
            Setting(scope="install", key="handler", value=object())

    def test_a_scope_with_a_space_in_it_is_refused(self) -> None:
        with pytest.raises(Exception, match="invalid setting scope"):
            Setting(scope="install settings", key="theme", value="dark")

    def test_a_project_closed_before_it_was_opened_is_refused(self) -> None:
        with pytest.raises(Exception, match="must not precede"):
            RecentProject(
                path="/a/one.nova", project_id="id", name="one", opened_ms=10, closed_ms=5
            )

    def test_a_project_round_trips_through_wire(self) -> None:
        entry = _project().closed(T0 + 5, dirty=True)
        rebuilt = RecentProject.from_wire(entry.to_wire())
        assert rebuilt == entry
        assert rebuilt.dirty is True

    def test_a_setting_is_json_round_trippable(self) -> None:
        setting = _setting("layout", {"a": [1, 2]})
        assert json.loads(json.dumps(setting.to_wire()))["value"] == {"a": [1, 2]}
        assert Setting.from_wire(setting.to_wire()) == setting
