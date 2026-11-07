"""L4 — the projects this install has seen, as rows.

:class:`~nova_studio.ports.persistence.RecentFiles` on SQLite. The home screen's
list, in other words — the reason an editor can say "welcome back" and the
reason it can say "this one was left unsaved".

Four decisions, none of them about performance:

**Keyed by path, not by project id.** A project is where the user put it. Two
rows for one path are two entries in a list that is supposed to be short, and a
row keyed by id would keep a stale path alive forever after a rename.

**Bounded by the store, not by the caller.** `record` keeps the newest ``keep``
entries and drops the rest, inside the same transaction. A "recent" list that
grows without limit is a list of every project ever opened, and the caller that
would have to prune it is a caller that would forget to.

**A close is not a deletion.** `mark_closed` records that the window was closed
and whether the project was left dirty. Removing the row on close would make
the list "projects open right now", which the workspace already knows.

**A read never raises.** An unreadable row is skipped: a list that is missing
one entry is a list; a list that throws is a home screen that will not draw.
"""

from __future__ import annotations

import threading
from typing import TYPE_CHECKING, Any, Final

from nova_studio.core.errors import NovaError
from nova_studio.core.result import Result, err, ok
from nova_studio.domain.persistence import RecentProject
from nova_studio.infra.persistence.migrations import ensure_schema
from nova_studio.infra.persistence.paths import install_database_path
from nova_studio.infra.persistence.sqlite import SqliteError, SqliteGateway
from nova_studio.ports.persistence import PersistenceErrorCode

if TYPE_CHECKING:
    from pathlib import Path

__all__ = ["DEFAULT_KEEP", "SqliteRecentFiles", "open_recent_files"]

#: How many entries the list holds. Twenty is what fits on one screen without a
#: scroll, which is also the honest size of "recent".
DEFAULT_KEEP: Final[int] = 20

_COLUMNS: Final[tuple[str, ...]] = (
    "path",
    "project_id",
    "name",
    "opened_ms",
    "closed_ms",
    "dirty",
    "last_status",
)

_UPSERT: Final[str] = f"""
INSERT INTO recent_files ({", ".join(_COLUMNS)})
VALUES ({", ".join("?" for _ in _COLUMNS)})
ON CONFLICT(path) DO UPDATE SET
    {", ".join(f"{name} = excluded.{name}" for name in _COLUMNS if name != "path")}
"""

_SELECT: Final[str] = f"SELECT {', '.join(_COLUMNS)} FROM recent_files"


def open_recent_files(data_root: Path, *, keep: int = DEFAULT_KEEP) -> SqliteRecentFiles:
    """Open this install's recent-projects list."""
    data_root.mkdir(parents=True, exist_ok=True)
    gateway = SqliteGateway(install_database_path(data_root), shared=True)
    gateway.open()
    ensure_schema(gateway)
    return SqliteRecentFiles(gateway, keep=keep)


class SqliteRecentFiles:
    """The `RecentFiles` port, on rows in ``nova.db``.

    Args:
        gateway: An **open** gateway on the install database.
        keep: How many entries to hold. The bound is the store's, because a
            caller that had to prune would be a caller that forgot.
    """

    __slots__ = ("_gateway", "_keep", "_lock")

    def __init__(self, gateway: SqliteGateway, *, keep: int = DEFAULT_KEEP) -> None:
        if keep < 1:
            raise ValueError(f"keep must be at least 1, got {keep}")
        self._gateway = gateway
        self._keep = keep
        self._lock = threading.RLock()

    @property
    def keep(self) -> int:
        """How many entries this list holds."""
        return self._keep

    # -- the port ---------------------------------------------------------

    def record(self, entry: RecentProject) -> Result[None]:
        """Remember that this project was opened, and drop what fell off the end."""
        with self._lock:
            try:
                self._gateway.begin()
                self._gateway.run(_UPSERT, _params(entry))
                # Everything past the newest `keep`, by the order the list is
                # read in. Deleting inside the same transaction as the write is
                # what keeps the bound true even if the process dies here.
                self._gateway.run(
                    "DELETE FROM recent_files WHERE path NOT IN"
                    " (SELECT path FROM recent_files ORDER BY opened_ms DESC LIMIT ?)",
                    (self._keep,),
                )
            except SqliteError as error:
                self._gateway.rollback()
                return err(_unavailable(str(error), path=entry.path))
            self._gateway.commit()
            return ok(None)

    def mark_closed(self, path: str, *, at_ms: int, dirty: bool = False) -> Result[None]:
        """Record that the project at ``path`` was closed, and whether it was
        left dirty. A project that is not in the list is not an error: it was
        never recorded, and there is nothing to update."""
        with self._lock:
            try:
                self._gateway.run(
                    "UPDATE recent_files SET closed_ms = ?, dirty = ? WHERE path = ?",
                    (at_ms, 1 if dirty else 0, path),
                )
            except SqliteError as error:
                return err(_unavailable(str(error), path=path))
            return ok(None)

    def recent(self, *, limit: int = DEFAULT_KEEP) -> tuple[RecentProject, ...]:
        """The most recently opened projects, newest first. Served by
        ``recent_files_by_opened``."""
        with self._lock:
            try:
                rows = self._gateway.rows(
                    f"{_SELECT} ORDER BY opened_ms DESC LIMIT ?", (max(limit, 0),)
                )
            except SqliteError:
                return ()
            entries: list[RecentProject] = []
            for row in rows:
                try:
                    entries.append(_entry(row))
                except Exception:
                    continue
            return tuple(entries)

    def forget(self, path: str) -> Result[None]:
        """Remove one entry, because the user asked."""
        with self._lock:
            try:
                self._gateway.run("DELETE FROM recent_files WHERE path = ?", (path,))
            except SqliteError as error:
                return err(_unavailable(str(error), path=path))
            return ok(None)

    def close(self) -> None:
        """Release the store."""
        with self._lock:
            self._gateway.close()


def _params(entry: RecentProject) -> tuple[object, ...]:
    return (
        entry.path,
        entry.project_id,
        entry.name,
        entry.opened_ms,
        entry.closed_ms,
        1 if entry.dirty else 0,
        entry.last_status,
    )


def _entry(row: Any) -> RecentProject:
    """Rebuild one row. Raises on anything it does not trust."""
    closed = row["closed_ms"]
    return RecentProject(
        path=str(row["path"]),
        project_id=str(row["project_id"]),
        name=str(row["name"]),
        opened_ms=int(str(row["opened_ms"])),
        closed_ms=None if closed is None else int(str(closed)),
        dirty=bool(int(str(row["dirty"]))),
        last_status=str(row["last_status"]),
    )


def _unavailable(cause: str, *, path: str) -> NovaError:
    return NovaError(
        PersistenceErrorCode.UNWRITABLE,
        "the recent-projects list could not be written",
        remedy="Check that the application data directory is writable.",
        cause=cause,
        details={"path": path},
    )
