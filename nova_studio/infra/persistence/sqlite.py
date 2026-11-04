"""L4 — the SQLite gateway: the only module in Nova Studio that may say `sqlite3`.

ARCHITECTURE §6 calls for hand-written SQL behind repository ports, with no ORM,
and for a **single writer connection serialised through a gateway**. This is that
gateway, and the reasons it is one module with one job are not stylistic:

* **One place that knows the pragmas.** WAL, `synchronous=NORMAL`,
  `foreign_keys=ON` — a second connection opened elsewhere with the defaults
  would silently take the database out of WAL mode for everyone, and the symptom
  ("writes got slow", or worse, "a crash lost a row") would appear months later
  somewhere unrelated.
* **One place that translates `sqlite3.Error`.** Adapters above this line speak
  `Result` with the persistence port's codes; `sqlite3.OperationalError` is a
  driver detail that must not leak into a service, and translating it in five
  places is how five different messages end up in the log for one fault.
* **One place that decides what a row is.** Rows come back as plain mappings, so
  no caller can end up depending on a driver type it would then have to import.

There is deliberately **no connection pool and no threading here**. SQLite
serialises writers itself, and a desktop editor writes from one place at a time;
a pool would add a failure mode (leaked connections) to solve a problem we do
not have. Multiple readers, when they arrive, get their own gateway instance
pointed at the same file — WAL is what makes that safe, not Python.

The gateway raises, it does not return `Result`. A failure here is a bug or a
dead disk, and the caller that can turn that into a sentence for the user is the
adapter one layer up, which knows whether it was reading a thumbnail index or
writing a project.
"""

from __future__ import annotations

import contextlib
import sqlite3
from typing import TYPE_CHECKING, Final

if TYPE_CHECKING:
    from collections.abc import Iterator, Mapping, Sequence
    from pathlib import Path

__all__ = ["SqliteError", "SqliteGateway"]

#: The pragmas every connection is opened with, in order.
#:
#: ``journal_mode=WAL`` lets a reader work while a writer writes — which is what
#: makes "the preview thread reads the cache index while a proxy job writes it"
#: a non-event. ``synchronous=NORMAL`` is the WAL-appropriate durability level:
#: a commit still survives a process crash, and only a machine-level power loss
#: can lose the last one, which is the trade every desktop app makes for a
#: responsive save. ``foreign_keys=ON`` because SQLite does not enforce them
#: unless asked, and a constraint nobody enforces is a comment.
_PRAGMAS: Final[tuple[str, ...]] = (
    "PRAGMA journal_mode=WAL",
    "PRAGMA synchronous=NORMAL",
    "PRAGMA foreign_keys=ON",
)


class SqliteError(RuntimeError):
    """A SQLite failure, with the statement that failed attached.

    Carries the SQL because "database is locked" is useless without knowing what
    was being written, and because the alternative — logging inside the gateway —
    would put a logging decision in the one module that should not make any.
    """

    def __init__(self, message: str, *, sql: str = "") -> None:
        super().__init__(message)
        self.sql = sql


class SqliteGateway:
    """One connection to one SQLite file, opened once and closed by its owner.

    Use it as a context manager so a connection cannot outlive the block that
    needed it::

        with SqliteGateway(path) as db:
            db.script(CACHE_INDEX_DDL)
            db.run("INSERT INTO cache_index ...", params)

    Transaction control is manual (``isolation_level=None``): the adapter decides
    where a unit of work begins, and Python's implicit transaction handling —
    which opens one on the first DML and commits on ``with`` exit — is exactly
    the kind of invisible decision this gateway exists to remove.
    """

    def __init__(self, path: Path, *, create: bool = True) -> None:
        self._path = path
        self._connection: sqlite3.Connection | None = None
        self._create = create

    # -- lifecycle ---------------------------------------------------------

    def open(self) -> None:
        """Open the connection and apply the pragmas.

        Raises:
            SqliteError: The file could not be opened, or is not a database.
        """
        if self._connection is not None:
            return
        if not self._create and not self._path.exists():
            raise SqliteError(f"no database at {self._path}")
        try:
            connection = sqlite3.connect(
                self._path,
                isolation_level=None,  # transactions are ours, not Python's
            )
        except sqlite3.Error as error:
            raise SqliteError(f"could not open {self._path}: {error}") from error
        connection.row_factory = sqlite3.Row
        for pragma in _PRAGMAS:
            try:
                connection.execute(pragma)
            except sqlite3.Error as error:
                connection.close()
                raise SqliteError(f"could not apply {pragma!r}: {error}", sql=pragma) from error
        self._connection = connection

    def close(self) -> None:
        """Close the connection. Safe to call twice; never raises."""
        if self._connection is None:
            return
        with contextlib.suppress(sqlite3.Error):
            # Closing a connection that is already broken is not a failure the
            # caller can act on, and raising here would mask whatever did.
            self._connection.close()
        self._connection = None

    @property
    def is_open(self) -> bool:
        """Whether the connection is usable."""
        return self._connection is not None

    @property
    def path(self) -> Path:
        """The file this gateway writes."""
        return self._path

    def __enter__(self) -> SqliteGateway:
        self.open()
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()

    # -- transactions ------------------------------------------------------

    def begin(self) -> None:
        """Start a unit of work. Nested begins are refused, not stacked."""
        self._run("BEGIN")

    def commit(self) -> None:
        """Make the current unit of work durable."""
        self._run("COMMIT")

    def rollback(self) -> None:
        """Discard the current unit of work. Safe when none is open."""
        connection = self._require()
        try:
            connection.execute("ROLLBACK")
        except sqlite3.Error as error:
            # "cannot rollback - no transaction is active" is the expected state
            # after a rollback triggered by an exception on a read-only path.
            if "no transaction is active" not in str(error):
                raise SqliteError(f"rollback failed: {error}", sql="ROLLBACK") from error

    def in_transaction(self) -> bool:
        """Whether a transaction is currently open."""
        return bool(self._require().in_transaction)

    # -- statements --------------------------------------------------------

    def script(self, sql: str) -> None:
        """Execute one or more statements — DDL, or a batch of writes."""
        connection = self._require()
        try:
            connection.executescript(sql)
        except sqlite3.Error as error:
            raise SqliteError(f"{error}", sql=sql) from error

    def run(self, sql: str, params: Sequence[object] = ()) -> int:
        """Execute one statement and return the rows it changed."""
        connection = self._require()
        try:
            cursor = connection.execute(sql, tuple(params))
        except sqlite3.Error as error:
            raise SqliteError(f"{error}", sql=sql) from error
        return int(cursor.rowcount or 0)

    def rows(self, sql: str, params: Sequence[object] = ()) -> tuple[Mapping[str, object], ...]:
        """Run a query and return every row as a plain mapping."""
        return tuple(self._query(sql, params))

    def value(self, sql: str, params: Sequence[object] = ()) -> object | None:
        """Run a query and return the first column of the first row, if any."""
        for row in self._query(sql, params):
            return next(iter(row.values()))
        return None

    # -- internals ---------------------------------------------------------

    def _require(self) -> sqlite3.Connection:
        if self._connection is None:
            raise SqliteError(f"{self._path} is not open", sql="")
        return self._connection

    def _run(self, sql: str) -> None:
        connection = self._require()
        try:
            connection.execute(sql)
        except sqlite3.Error as error:
            raise SqliteError(f"{error}", sql=sql) from error

    def _query(self, sql: str, params: Sequence[object]) -> Iterator[Mapping[str, object]]:
        connection = self._require()
        try:
            cursor = connection.execute(sql, tuple(params))
            fetched = cursor.fetchall()
        except sqlite3.Error as error:
            raise SqliteError(f"{error}", sql=sql) from error
        for row in fetched:
            # ``sqlite3.Row`` iterates as *values*, not keys, so ``for key in row``
            # is a trap. ``dict(row)`` is the one spelling that cannot be misread.
            yield dict(row)
