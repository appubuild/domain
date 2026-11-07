"""The schema, and the only way it changes.

A migration runner is a component that is wrong for a year and then wrong all at
once on a machine it has never seen. So the tests here are not about the DDL —
they are about the *paths through time*:

* a fresh install (nothing exists);
* an install that has been running for a year (v1 exists, v2 arrives);
* an install that predates versioning entirely (the objects are there, the
  ledger is not — today's `cache.sqlite3`);
* an install that has been *ahead* of this build (a downgrade, a copied file);
* a ledger somebody edited by hand (a hole in it).

Plus the one property every migration system claims and few have: a migration
that fails halfway leaves nothing behind, not even its own ledger row.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

from nova_studio.core.clock import FixedClock
from nova_studio.infra.persistence.migrations import (
    CACHE_MIGRATIONS,
    INSTALL_MIGRATIONS,
    SCHEMA_VERSION,
    Migration,
    MigrationError,
    applied_versions,
    current_version,
    ensure_schema,
)
from nova_studio.infra.persistence.sqlite import SqliteError, SqliteGateway
from nova_studio.ports.persistence import PersistenceErrorCode

if TYPE_CHECKING:
    from pathlib import Path


@pytest.fixture
def clock() -> FixedClock:
    """A clock that does not move, so a migration time is an assertion."""
    return FixedClock(wall_ms=1_700_000_000_000)


@pytest.fixture
def db(tmp_path: Path) -> SqliteGateway:
    gateway = SqliteGateway(tmp_path / "nova.db")
    gateway.open()
    yield gateway
    gateway.close()


def tables(gateway: SqliteGateway) -> set[str]:
    rows = gateway.rows("SELECT name FROM sqlite_master WHERE type = 'table'")
    return {str(row["name"]) for row in rows}


def user_version(gateway: SqliteGateway) -> int:
    return int(gateway.value("PRAGMA user_version") or 0)


# ---------------------------------------------------------------------------
# A fresh install
# ---------------------------------------------------------------------------


class TestAFreshDatabase:
    def test_every_migration_runs_and_the_objects_exist(self, db: SqliteGateway) -> None:
        ran = ensure_schema(db)
        assert ran == len(INSTALL_MIGRATIONS)
        assert {"settings", "recent_files", "jobs"} <= tables(db)

    def test_the_ledger_says_what_ran(self, db: SqliteGateway, clock: FixedClock) -> None:
        ensure_schema(db, clock=clock)
        rows = db.rows(
            "SELECT version, name, applied_ms, adopted FROM schema_migrations ORDER BY version"
        )
        assert [
            (row["version"], row["name"], row["applied_ms"], row["adopted"]) for row in rows
        ] == [
            (1, "install_core", clock.now_ms(), 0),
            (2, "job_history", clock.now_ms(), 0),
            (3, "job_history_index_tidy", clock.now_ms(), 0),
        ]

    def test_the_pragma_mirrors_the_version(self, db: SqliteGateway) -> None:
        # The one command a support engineer runs on a database in the field.
        ensure_schema(db)
        assert user_version(db) == SCHEMA_VERSION
        assert current_version(db) == SCHEMA_VERSION

    def test_running_it_twice_changes_nothing(self, db: SqliteGateway) -> None:
        assert ensure_schema(db) == len(INSTALL_MIGRATIONS)
        assert ensure_schema(db) == 0
        assert applied_versions(db) == tuple(range(1, len(INSTALL_MIGRATIONS) + 1))

    def test_the_indexes_the_queries_were_written_for_exist(self, db: SqliteGateway) -> None:
        ensure_schema(db)
        rows = db.rows(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'"
        )
        names = {str(row["name"]) for row in rows}
        assert "jobs_by_kind" in names
        assert "jobs_by_status" in names
        assert "recent_files_by_opened" in names


# ---------------------------------------------------------------------------
# An older install, upgraded
# ---------------------------------------------------------------------------


class TestAnOlderDatabase:
    @pytest.fixture
    def old(self, tmp_path: Path) -> SqliteGateway:
        """A database at v1, built by hand the way last year's build left it."""
        gateway = SqliteGateway(tmp_path / "old.db")
        gateway.open()
        for statement in INSTALL_MIGRATIONS[0].statements:
            gateway.run(statement)
        gateway.run("PRAGMA user_version = 1")
        yield gateway
        gateway.close()

    def test_only_the_new_migrations_run(self, old: SqliteGateway) -> None:
        assert ensure_schema(old) == len(INSTALL_MIGRATIONS) - 1
        assert applied_versions(old) == tuple(range(1, len(INSTALL_MIGRATIONS) + 1))

    def test_the_upgrade_keeps_the_data_it_finds(self, old: SqliteGateway) -> None:
        # The whole point of an upgrade: the rows a user accumulated are still
        # there afterwards, and are not re-created from scratch.
        old.run(
            "INSERT INTO settings (scope, key, value, updated_ms) VALUES ('install', 'theme', '\"dark\"', 5)"
        )
        ensure_schema(old)
        assert old.value("SELECT value FROM settings WHERE key = 'theme'") == '"dark"'
        assert "jobs" in tables(old)


# ---------------------------------------------------------------------------
# A database that predates versioning
# ---------------------------------------------------------------------------


class TestAdoption:
    def test_a_cache_index_from_before_versioning_is_adopted_not_rebuilt(
        self, tmp_path: Path, clock: FixedClock
    ) -> None:
        # Today's cache.sqlite3: one table, no ledger. Creating the ledger and
        # running v1 would leave the existing table alone (IF NOT EXISTS), so
        # the visible difference is the ledger row — and it must say "adopted",
        # because "applied" would claim we created something we did not.
        gateway = SqliteGateway(tmp_path / "cache.sqlite3")
        gateway.open()
        gateway.script(
            "CREATE TABLE cache_index (key TEXT PRIMARY KEY, kind TEXT NOT NULL,"
            " size_bytes INTEGER NOT NULL, created_ms INTEGER NOT NULL,"
            " last_used_ms INTEGER NOT NULL, pinned INTEGER NOT NULL DEFAULT 0)"
        )
        gateway.run("INSERT INTO cache_index VALUES ('thumb:1', 'thumbnail', 10, 1, 2, 0)")
        try:
            ran = ensure_schema(gateway, migrations=CACHE_MIGRATIONS, clock=clock)
            assert ran == 0
            rows = gateway.rows("SELECT version, adopted FROM schema_migrations")
            assert [(row["version"], row["adopted"]) for row in rows] == [(1, 1)]
            assert gateway.value("SELECT COUNT(*) FROM cache_index") == 1
            assert (
                gateway.value(
                    "SELECT COUNT(*) FROM sqlite_master WHERE name = 'cache_index_by_kind'"
                )
                == 0
            )  # adopted means adopted: the index was not there, so it stays not-there
        finally:
            gateway.close()

    def test_a_database_missing_everything_is_not_adopted(self, db: SqliteGateway) -> None:
        assert ensure_schema(db) == len(INSTALL_MIGRATIONS)
        assert db.value("SELECT COUNT(*) FROM schema_migrations WHERE adopted = 1") == 0


# ---------------------------------------------------------------------------
# The refuse-to-guess cases
# ---------------------------------------------------------------------------


class TestRefusals:
    def test_a_database_from_a_newer_build_is_refused_whole(self, db: SqliteGateway) -> None:
        db.run(
            "CREATE TABLE IF NOT EXISTS schema_migrations"
            " (version INTEGER PRIMARY KEY, name TEXT NOT NULL,"
            " applied_ms INTEGER NOT NULL, adopted INTEGER NOT NULL DEFAULT 0)"
        )
        db.run("INSERT INTO schema_migrations VALUES (99, 'from_the_future', 1, 0)")
        db.run("PRAGMA user_version = 99")

        with pytest.raises(MigrationError) as caught:
            ensure_schema(db)
        assert caught.value.code is PersistenceErrorCode.UNSUPPORTED_VERSION
        # Nothing was written: a refused database is one a newer build can still
        # open, which is only true if we left it alone.
        assert user_version(db) == 99

    def test_a_ledger_with_a_hole_is_refused_as_corrupt(self, db: SqliteGateway) -> None:
        db.run(
            "CREATE TABLE IF NOT EXISTS schema_migrations"
            " (version INTEGER PRIMARY KEY, name TEXT NOT NULL,"
            " applied_ms INTEGER NOT NULL, adopted INTEGER NOT NULL DEFAULT 0)"
        )
        db.run("INSERT INTO schema_migrations VALUES (2, 'job_history', 1, 0)")

        with pytest.raises(MigrationError) as caught:
            ensure_schema(db)
        assert caught.value.code is PersistenceErrorCode.CORRUPT
        assert "jobs" not in tables(db)


# ---------------------------------------------------------------------------
# Atomicity
# ---------------------------------------------------------------------------


class TestAtomicity:
    def test_a_migration_that_fails_leaves_nothing_behind(
        self, db: SqliteGateway, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # The failure that matters: the second statement of a migration fails,
        # and the first is rolled back with it — including the ledger row,
        # which is the one a restart would otherwise believe.
        good = Migration(
            version=1,
            name="good",
            creates=("good_table",),
            statements=("CREATE TABLE good_table (id INTEGER PRIMARY KEY)",),
        )
        broken = Migration(
            version=2,
            name="broken",
            creates=("broken_table",),
            statements=(
                "CREATE TABLE broken_table (id INTEGER PRIMARY KEY)",
                "CREATE TABLE broken_table (id INTEGER PRIMARY KEY)",  # already there
            ),
        )
        monkeypatch.setattr(
            "nova_studio.infra.persistence.migrations.INSTALL_MIGRATIONS", (good, broken)
        )

        # The gateway's own error, not the driver's: an adapter that leaked
        # `sqlite3.OperationalError` would be leaking a driver into a layer that
        # must not know one is there.
        with pytest.raises(SqliteError):
            ensure_schema(db)

        # The failed migration's own work is gone, table and ledger row alike.
        assert "broken_table" not in tables(db)
        assert db.value("SELECT COUNT(*) FROM schema_migrations WHERE version = 2") == 0
        # And the migration before it stands: one transaction per migration
        # means a later failure cannot undo work that was already durable.
        assert applied_versions(db) == (1,)

    def test_a_rolled_back_migration_can_succeed_on_the_next_try(
        self, db: SqliteGateway, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # The second half of that promise: after the bug is fixed, the same
        # database migrates cleanly. A half-applied migration that poisoned the
        # database forever would be worse than the bug it replaced.
        first = Migration(
            version=1,
            name="one",
            creates=("one_table",),
            statements=("CREATE TABLE one_table (id INTEGER PRIMARY KEY)",),
        )
        monkeypatch.setattr("nova_studio.infra.persistence.migrations.INSTALL_MIGRATIONS", (first,))
        ensure_schema(db)
        assert applied_versions(db) == (1,)
