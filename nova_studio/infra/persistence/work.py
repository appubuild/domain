"""L4 — the unit of work: the document and the index commit together, or not at all.

ADR-0004 §3 promises that "the document and the rows can never disagree". That
promise is not a property of SQLite, or of a ZIP, or of writing things in a
sensible order — it is a property of *this object*, and it is the only reason the
hybrid model is safe at all. A project whose timeline document says one thing and
whose asset index says another is not a project with a small inconsistency; it is
a project where "delete this clip" means two different things depending on which
surface you ask.

The order is fixed, and it is the design:

1. **The document commits first.** It is authoritative; the tables are a derived
   index. So the only divergence a crash can produce is *rows behind the
   document*, which the integrity checker repairs by rebuilding the index from
   the document — a repair that is always possible, because the document is a
   complete description of the project.
2. **The rows commit second.** If they fail, the document is already durable and
   the index is behind: the same state as a crash, the same repair. Written in
   the other order, a failure would leave rows describing an edit the document
   does not contain, and *that* cannot be repaired — only the document knows
   what the edit was.

Everything else here is the small, unglamorous discipline that a transaction
object needs and that every codebase that has ever had one has got wrong once:

* **A block that forgets to commit rolls back.** Not "leaves a transaction open
  until the connection dies an hour later", which in a single-writer store is how
  an application deadlocks itself.
* **A second ``commit`` is refused.** Silently accepting it would let a second
  caller believe work was saved that had already been discarded.
* **``rollback`` after ``commit`` is a no-op**, because the natural cleanup code
  runs on both paths and must be safe on both.
* **Failure raises.** :meth:`commit` does not return a `Result`: if the document
  cannot be saved, the caller's own bookkeeping is now wrong, and that is a bug
  or a dead disk rather than something the user can fix by clicking again. The
  `Result` that reaches the user is produced by the layer that knows what was
  being attempted.

The row store is asked to participate **by shape, not by type**: the `CacheIndex`
port does not require transaction methods, because an in-memory index in a test
has nothing to roll back. An adapter that can take part exposes `begin`, `commit`
and `rollback`, and this object calls them if they are there. No `isinstance`
against SQLite, and a future adapter needs no change here.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Final

from nova_studio.core.errors import ErrorDomain, NovaError
from nova_studio.core.result import Result, error_result
from nova_studio.ports.persistence import PersistenceErrorCode

if TYPE_CHECKING:
    from types import TracebackType

    from nova_studio.ports.persistence import CacheIndex, ProjectArchive

__all__ = ["PersistenceCommitError", "PersistenceUnitOfWork"]

#: The code a raised commit failure carries, so a caller that does catch it can
#: still file it under the same vocabulary as the returned errors.
COMMIT_FAILED: Final[str] = PersistenceErrorCode.IO_FAILED


class PersistenceCommitError(RuntimeError):
    """A commit that could not be completed, raised rather than returned.

    Carries both halves — whether the document made it to disk, and whether the
    rows did — because the two answers together are what decide what to tell the
    user. "Nothing was saved, try again" and "your edit is safe but the cache
    index is stale" are different sentences, and both are reachable here.

    The underlying :class:`NovaError` is kept as :attr:`error` so that a caller
    can put one object into the log, the API response and the telemetry stream.
    """

    def __init__(self, error: NovaError, *, document_committed: bool, rows_committed: bool) -> None:
        super().__init__(error.message)
        self.error = error
        self.document_committed = document_committed
        self.rows_committed = rows_committed


class PersistenceUnitOfWork:
    """One save: the archive and the index, committed in that order.

    Used as a context manager, so an exception unwinds into a rollback without
    every caller writing its own ``finally``::

        with PersistenceUnitOfWork(archive=archive, rows=index) as work:
            archive.write_document(...)
            index.put(...)
            work.commit()

    Args:
        archive: The `.nova` container, whose writes are already staged.
        rows: The derived index, or ``None`` when this unit touches only the
            document — an open that rebuilds an index writes no rows at all.
    """

    def __init__(self, *, archive: ProjectArchive, rows: CacheIndex | None = None) -> None:
        self._archive = archive
        self._rows = rows
        self._active = False
        self._document_committed = False
        self._rows_committed = False

    # -- state -------------------------------------------------------------

    def is_active(self) -> bool:
        """Whether the unit is still open and able to accept work."""
        return self._active

    @property
    def document_committed(self) -> bool:
        """Whether the document half of this unit is durable."""
        return self._document_committed

    @property
    def rows_committed(self) -> bool:
        """Whether the rows half of this unit is durable."""
        return self._rows_committed

    # -- context manager ---------------------------------------------------

    def __enter__(self) -> PersistenceUnitOfWork:
        self._active = True
        if self._rows is not None:
            begun = _rows_call(self._rows, "begin")
            problem = begun.error() if begun is not None else None
            if problem is not None:
                self._active = False
                raise _failure(
                    f"the unit of work could not be started: {problem.message}",
                    document_committed=False,
                    rows_committed=False,
                    cause=problem.message,
                )
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        # Whether the block raised or simply forgot to commit, the safe end state
        # is the same: nothing left dangling.
        if self._active:
            self.rollback()

    # -- the transaction ---------------------------------------------------

    def commit(self) -> None:
        """Make every staged change durable: document first, then rows.

        Raises:
            PersistenceCommitError: The document, or the rows, could not be
                committed. The exception says which.
        """
        if not self._active:
            raise _failure(
                "this unit of work is already closed",
                document_committed=self._document_committed,
                rows_committed=self._rows_committed,
            )
        problem = self._archive.commit().error()
        if problem is not None:
            self.rollback()
            raise _failure(
                f"the project could not be saved: {problem.message}",
                document_committed=False,
                rows_committed=False,
                cause=problem.message,
            )
        self._document_committed = True

        if self._rows is None:
            self._rows_committed = True
            self._active = False
            return

        committed = _rows_call(self._rows, "commit")
        problem = committed.error() if committed is not None else None
        if problem is not None:
            # The document is durable and the index is behind — the same state a
            # crash produces, repaired by rebuilding from the document. Rolling
            # the document back now would lose an edit the user was told was
            # saved, which is the one outcome this ordering exists to prevent.
            rolled_back = _rows_call(self._rows, "rollback")
            rolled_error = rolled_back.error() if rolled_back is not None else None
            note = f" (rollback: {rolled_error.message})" if rolled_error is not None else ""
            raise _failure(
                f"the project was saved but its index could not be updated: "
                f"{problem.message}{note}",
                document_committed=True,
                rows_committed=False,
                cause=problem.message,
            )
        self._rows_committed = True
        self._active = False

    def rollback(self) -> None:
        """Discard every staged change. Safe to call after a commit."""
        self._active = False
        self._archive.discard()
        if self._rows is not None and not self._rows_committed:
            _rows_call(self._rows, "rollback")


def _rows_call(rows: CacheIndex, name: str) -> Result[None] | None:
    """Ask the row store for one transactional step, if it has it.

    Duck-typed on purpose. The port cannot require these methods — an in-memory
    test double has nothing to commit — so participation is a capability an
    adapter declares by having the method. Asking by name keeps this module
    free of any knowledge of SQLite and of any `isinstance` that a second
    adapter would have to be added to.
    """
    method = getattr(rows, name, None)
    return method() if callable(method) else None


def _failure(
    message: str,
    *,
    document_committed: bool,
    rows_committed: bool,
    cause: str = "",
) -> PersistenceCommitError:
    """One spelling of a commit that did not complete, with both halves named."""
    error = error_result(
        COMMIT_FAILED,
        message,
        domain=ErrorDomain.STORAGE,
        details={
            "document_committed": document_committed,
            "rows_committed": rows_committed,
            **({"cause": cause} if cause else {}),
        },
        remedy="Check that the file is writable and the disk is not full, then try again.",
        retryable=True,
    )
    return PersistenceCommitError(
        error.unwrap_err(),
        document_committed=document_committed,
        rows_committed=rows_committed,
    )
