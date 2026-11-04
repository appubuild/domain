"""L4 — the cache index: what derived bytes we hold, and what they cost.

Proxies, thumbnails, waveforms, analysis results and preview frames are all
**derived**: everything in this index can be recomputed, which is the only
reason eviction is allowed to be aggressive. What cannot be recomputed is the
user's edit, and it is not in here — that asymmetry is the whole design.

The index stores *bookkeeping only*, never the bytes. Two consequences follow,
and both are deliberate:

* **The eviction decision stays in the domain.**
  :func:`~nova_studio.domain.persistence.select_for_eviction` is a pure function
  over the entries this port exposes, so the rule "drop the oldest thing nobody
  has touched, unless it is pinned or is the proxy a job is writing right now"
  is reviewable in one screen and testable without a database. This adapter
  executes the decision; it does not make it. An adapter that decided policy
  would be a second policy, and the two would disagree within a week.
* **The index can be deleted without asking.** `rm cache.sqlite3` costs a
  rebuild and not a single frame of the edit, because the file answers only "do
  we still have the thumbnail for asset X, and how big is it".

Rows are written through the domain's own wire vocabulary
(:meth:`CacheEntry.to_wire` / `from_wire`), so the columns and the domain object
cannot drift apart: adding a field to a `CacheEntry` is one migration here and
zero changes in the read and write paths.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Final

from nova_studio.core.errors import ErrorDomain
from nova_studio.core.result import Result, error_result, ok
from nova_studio.domain.persistence import CacheEntry, CacheKind
from nova_studio.infra.persistence.sqlite import SqliteError, SqliteGateway
from nova_studio.ports.persistence import PersistenceErrorCode

if TYPE_CHECKING:
    from collections.abc import Mapping
    from pathlib import Path

__all__ = ["CACHE_INDEX_DDL", "SqliteCacheIndex", "open_cache_index"]

#: The one table this adapter owns.
#:
#: ``key`` is the primary key because a cache is a key-value store that happens
#: to have a size; the index on ``(kind, last_used_ms)`` is the one the eviction
#: planner's ordering wants, so "oldest thumbnail first" is not a table scan.
CACHE_INDEX_DDL: Final[str] = """
CREATE TABLE IF NOT EXISTS cache_index (
    key          TEXT    PRIMARY KEY,
    kind         TEXT    NOT NULL,
    size_bytes   INTEGER NOT NULL,
    created_ms   INTEGER NOT NULL,
    last_used_ms INTEGER NOT NULL,
    pinned       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS cache_index_by_kind
    ON cache_index (kind, last_used_ms);
"""

_COLUMNS: Final[tuple[str, ...]] = (
    "key",
    "kind",
    "size_bytes",
    "created_ms",
    "last_used_ms",
    "pinned",
)

_SELECT: Final[str] = f"SELECT {', '.join(_COLUMNS)} FROM cache_index"


def open_cache_index(path: Path) -> SqliteCacheIndex:
    """Open (or create) the install-wide cache index at ``path``."""
    return SqliteCacheIndex(SqliteGateway(path))


class SqliteCacheIndex:
    """The `CacheIndex` port, on SQLite.

    The gateway is injected rather than constructed from a path so that a test
    can hand in a gateway pointed at a temp file, and so that the index can be
    part of a unit of work owned by something else (see ``work.py``).
    """

    def __init__(self, gateway: SqliteGateway) -> None:
        self._gateway = gateway
        if not gateway.is_open:
            gateway.open()
        gateway.script(CACHE_INDEX_DDL)

    # -- reads -------------------------------------------------------------

    def get(self, key: str) -> CacheEntry | None:
        """The entry for ``key``, or ``None`` when nothing is cached."""
        rows = self._gateway.rows(f"{_SELECT} WHERE key = ?", (key,))
        return _entry_from_row(rows[0]) if rows else None

    def entries(self, kind: CacheKind | None = None) -> tuple[CacheEntry, ...]:
        """Every entry, optionally filtered to one kind, ordered by key.

        Ordered so that a caller — the eviction planner, a cache inspector, a
        test — gets the same answer twice for the same data. SQL without
        ``ORDER BY`` is allowed to return rows in any order it likes.
        """
        if kind is None:
            rows = self._gateway.rows(f"{_SELECT} ORDER BY key")
        else:
            rows = self._gateway.rows(f"{_SELECT} WHERE kind = ? ORDER BY key", (str(kind),))
        return tuple(_entry_from_row(row) for row in rows)

    def total_bytes(self) -> int:
        """Bytes currently held by cached artefacts, across all kinds."""
        total = self._gateway.value("SELECT COALESCE(SUM(size_bytes), 0) FROM cache_index")
        return int(total) if isinstance(total, int | float) else 0

    # -- writes ------------------------------------------------------------

    def put(self, entry: CacheEntry) -> Result[None]:
        """Insert or replace an entry, keeping the caller's ``created_ms``.

        ``created_ms`` is when the artefact was first computed, which is a fact
        about the artefact and not about this row: an entry re-``put`` after a
        rebuild must not look freshly created, or the eviction planner will keep
        the thing it was about to drop.
        """
        try:
            self._gateway.run(
                "INSERT INTO cache_index "
                f"({', '.join(_COLUMNS)}) VALUES (?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(key) DO UPDATE SET "
                "kind = excluded.kind, "
                "size_bytes = excluded.size_bytes, "
                "created_ms = excluded.created_ms, "
                "last_used_ms = excluded.last_used_ms, "
                "pinned = excluded.pinned",
                (
                    entry.key,
                    str(entry.kind),
                    entry.size_bytes,
                    entry.created_ms,
                    entry.last_used_ms,
                    1 if entry.pinned else 0,
                ),
            )
        except SqliteError as error:
            return _io_failed(f"the cache entry for {entry.key!r} could not be written", error)
        return ok(None)

    def touch(self, key: str, *, at_ms: int) -> Result[None]:
        """Record that ``key`` was used at ``at_ms``.

        Unknown keys are ignored: a cache miss that has already been evicted is
        not an error, and making it one would force every read path to handle a
        failure it cannot act on. ``MAX`` rather than a plain assignment, so an
        out-of-order read cannot make an entry look older and therefore evictable.
        """
        try:
            self._gateway.run(
                "UPDATE cache_index SET last_used_ms = MAX(last_used_ms, ?) WHERE key = ?",
                (at_ms, key),
            )
        except SqliteError as error:
            return _io_failed(f"the cache entry for {key!r} could not be updated", error)
        return ok(None)

    def remove(self, key: str) -> Result[None]:
        """Delete an entry. Removing an absent key is not an error."""
        try:
            self._gateway.run("DELETE FROM cache_index WHERE key = ?", (key,))
        except SqliteError as error:
            return _io_failed(f"the cache entry for {key!r} could not be removed", error)
        return ok(None)

    # -- transactions ------------------------------------------------------

    def begin(self) -> Result[None]:
        """Begin a unit of work on the index, for the unit of work to own."""
        try:
            if not self._gateway.in_transaction():
                self._gateway.begin()
        except SqliteError as error:
            return _io_failed("the cache index transaction could not be started", error)
        return ok(None)

    def commit(self) -> Result[None]:
        """Make the current unit of work durable."""
        try:
            if self._gateway.in_transaction():
                self._gateway.commit()
        except SqliteError as error:
            return _io_failed("the cache index could not be committed", error)
        return ok(None)

    def rollback(self) -> Result[None]:
        """Discard the current unit of work."""
        try:
            self._gateway.rollback()
        except SqliteError as error:
            return _io_failed("the cache index could not be rolled back", error)
        return ok(None)

    def close(self) -> None:
        """Release the index."""
        self._gateway.close()


def _entry_from_row(row: Mapping[str, object]) -> CacheEntry:
    """Rebuild a `CacheEntry` from a row shaped like its own wire form."""
    wire = {
        "key": row["key"],
        "kind": row["kind"],
        "size_bytes": row["size_bytes"],
        "created_ms": row["created_ms"],
        "last_used_ms": row["last_used_ms"],
        "pinned": bool(row["pinned"]),
    }
    return CacheEntry.from_wire(wire)


def _io_failed(message: str, error: SqliteError) -> Result[None]:
    """One spelling for "the database said no", naming the statement that failed."""
    return error_result(
        PersistenceErrorCode.IO_FAILED,
        f"{message}: {error}",
        domain=ErrorDomain.STORAGE,
        details={"sql": error.sql} if error.sql else None,
        remedy="Check that the app data directory is writable and the disk is not full.",
        retryable=True,
    )
