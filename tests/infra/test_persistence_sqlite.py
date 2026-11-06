"""`infra/persistence/sqlite.py` — one file, one owner, and the one exception.

The gateway's promise is *one connection, one thread*: SQLite binds a connection
to the thread that created it, and the desktop editor writes from one place at a
time, so that has always been enough.

It stopped being enough the moment the cache index went on the request path.
FastAPI runs a ``def`` handler in a thread pool, so "does this asset have a
proxy" was being asked from whichever thread picked up the request — by a
connection that was opened on the one that built the workspace. The symptom is a
``sqlite3.ProgrammingError`` under load, which is the kind of bug that survives
review and reaches a user.

So ``shared=True`` exists, and these tests pin what it means:

* a shared gateway works from another thread — the failure that prompted it;
* concurrent readers never see a half-written row, because a statement is
  serialised rather than interleaved;
* the default is unchanged: a private gateway is still refused elsewhere, which
  is the promise that made the single-owner rule safe.
"""

from __future__ import annotations

import threading
from typing import TYPE_CHECKING

import pytest

from nova_studio.infra.persistence.cache import open_cache_index, open_shared_cache_index
from nova_studio.infra.persistence.sqlite import SqliteError, SqliteGateway

if TYPE_CHECKING:
    from pathlib import Path

pytestmark = pytest.mark.unit

DDL = "CREATE TABLE IF NOT EXISTS note (id INTEGER PRIMARY KEY, body TEXT NOT NULL)"


def _write(db: SqliteGateway, index: int, body: str) -> None:
    db.run("INSERT INTO note (id, body) VALUES (?, ?)", (index, body))


def _bodies(db: SqliteGateway) -> list[str]:
    rows = db.rows("SELECT body FROM note ORDER BY id")
    return [str(row["body"]) for row in rows]


class TestOneOwner:
    """The default, unchanged."""

    def test_a_private_gateway_refuses_another_thread(self, tmp_path: Path) -> None:
        """Not a limitation to work around — the rule that made the default
        safe. A refusal here is how a caller learns it needed `shared=True`."""
        with SqliteGateway(tmp_path / "notes.sqlite3") as db:
            db.script(DDL)
            errors: list[BaseException] = []

            def from_elsewhere() -> None:
                try:
                    db.run("INSERT INTO note (body) VALUES (?)", ("written elsewhere",))
                except BaseException as error:
                    errors.append(error)

            worker = threading.Thread(target=from_elsewhere)
            worker.start()
            worker.join()

        assert any(isinstance(error, SqliteError) for error in errors)

    def test_a_shared_gateway_accepts_another_thread(self, tmp_path: Path) -> None:
        with SqliteGateway(tmp_path / "notes.sqlite3", shared=True) as db:
            db.script(DDL)
            worker = threading.Thread(target=_write, args=(db, 1, "written elsewhere"))
            worker.start()
            worker.join()
            assert _bodies(db) == ["written elsewhere"]


class TestSerialisation:
    """Concurrent statements, not interleaved ones."""

    def test_many_threads_writing_leaves_every_row(self, tmp_path: Path) -> None:
        """Two threads sharing a connection without a lock lose rows, or raise
        "database is locked", or corrupt the statement cursor. Every row present
        is the only outcome worth having."""
        with SqliteGateway(tmp_path / "notes.sqlite3", shared=True) as db:
            db.script(DDL)
            db.begin()
            threads = [
                threading.Thread(target=_write, args=(db, index, f"note {index}"))
                for index in range(24)
            ]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join()
            db.commit()
            assert len(_bodies(db)) == 24
            assert _bodies(db)[0] == "note 0"

    def test_a_read_never_returns_another_threads_rows(self, tmp_path: Path) -> None:
        """The lock covers the *statement*, including the cursor iteration —
        the failure mode a cursor-level lock would leave is not an exception,
        it is silently someone else's result."""
        with SqliteGateway(tmp_path / "notes.sqlite3", shared=True) as db:
            db.script(DDL)
            _write(db, 1, "mine")
            seen: list[list[str]] = []

            def reader() -> None:
                seen.append(_bodies(db))

            worker = threading.Thread(target=reader)
            worker.start()
            worker.join()

        assert seen == [["mine"]]

    def test_a_shared_gateway_still_commits_and_rolls_back(self, tmp_path: Path) -> None:
        """Transactions keep their meaning: the lock is a serialiser, not a
        transaction of its own."""
        with SqliteGateway(tmp_path / "notes.sqlite3", shared=True) as db:
            db.script(DDL)
            db.begin()
            _write(db, 1, "kept")
            db.commit()
            db.begin()
            _write(db, 2, "dropped")
            assert db.in_transaction()
            db.rollback()
            assert _bodies(db) == ["kept"]


class TestTheTwoOpeners:
    """Which opener an adapter uses, and why it is not one."""

    def test_the_shared_index_survives_being_used_from_another_thread(self, tmp_path: Path) -> None:
        """The case that prompted the whole thing: the cache index, read from a
        request thread by a connection opened at startup."""
        index = open_shared_cache_index(tmp_path / "cache.sqlite3")
        try:
            entries: list[int] = []

            def from_a_request_thread() -> None:
                entries.append(len(index.entries()))

            worker = threading.Thread(target=from_a_request_thread)
            worker.start()
            worker.join()
        finally:
            index.close()

        assert entries == [0]

    def test_the_index_creates_the_directory_it_was_given(self, tmp_path: Path) -> None:
        """A fresh install, or a portable build on a new machine: the data
        directory does not exist yet, and asking the user to mkdir it is not a
        design, it is a bug report waiting to happen."""
        index = open_shared_cache_index(tmp_path / "data" / "cache.sqlite3")
        try:
            assert index.entries() == ()
        finally:
            index.close()
        assert (tmp_path / "data" / "cache.sqlite3").exists()

    def test_the_private_index_is_for_one_thread_and_one_owner(self, tmp_path: Path) -> None:
        """A unit of work wants exactly this: a connection nobody else can
        commit behind its back."""
        index = open_cache_index(tmp_path / "cache.sqlite3")
        try:
            assert index.entries() == ()
        finally:
            index.close()
