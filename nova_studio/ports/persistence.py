"""L2 port — persistence: how durable state is written without naming SQLite.

Four capabilities, four lifetimes, declared narrowest-first in the same style as
``ports/media.py``:

``UnitOfWork``
    A transaction boundary.  Everything ADR-0004 §3 promises — the document and
    the rows can never disagree — is a promise about *this* object: both writes
    happen inside one unit, or neither happens.
``ProjectArchive``
    The ``.nova`` container: canonical-JSON documents in, documents out, plus
    the checkpoint history.  Writes are *staged*; nothing is durable until
    :meth:`ProjectArchive.commit`, which is where the atomic replace happens
    (ADR-0015 rule 4).
``Journal``
    The append-only NDJSON command log that turns a crash into a restart
    (ADR-0015 rule 6).  Append fast, read back by sequence, truncate after a
    successful checkpoint.
``CacheIndex``
    The LRU bookkeeping for derived artefacts (proxies, thumbnails, waveforms).
    *Which* entries to drop is decided by
    :func:`nova_studio.domain.persistence.select_for_eviction` — a pure
    function — and this port only executes the decision.

Why a port, and why this shape
------------------------------
Every one of these touches the filesystem, and each has at least two plausible
implementations: SQLite + ZIP for production, an in-memory store for tests, and
later maybe a cloud-synced project store.  The shape matters more than the
seam, though:

* **Staging then committing** is what makes a crash safe.  An adapter that
  writes members directly into the live file can leave a project that opens on
  Monday and does not open on Tuesday; staging means the worst case is "the
  previous version is still there".
* **Reading by sequence, not by position**, is what makes recovery resumable:
  the caller remembers one integer and asks for everything after it.
* **Booleans and counts return as values** (``CacheEntry | None``, ``int``)
  whereas anything that can fail for a reason the user can act on returns
  ``Result`` — a missing revision is one thing, a disk that is full is another.

Contract rules an adapter must honour
-------------------------------------
1. **Staged writes, atomic commit.**  :meth:`ProjectArchive.commit` writes a
   temporary container in the same directory, fsyncs it, then ``os.replace``s
   it over the target.  A crash may leave a ``.tmp`` file; it may never leave a
   truncated project.
2. **Commit the document before the rows.**  The document is authoritative and
   the tables are a derived index (ADR-0004 §3).  Committing in this order
   means the only divergence a crash can produce is *rows behind*, which the
   integrity checker repairs by rebuilding; the reverse order can lose an edit
   that the user was told had been saved.
3. **A newer format version is refused, not guessed.**  An adapter reports
   :attr:`PersistenceErrorCode.UNSUPPORTED_VERSION` rather than opening a file
   written by a future release (ADR-0015 rule 5).
4. **A torn journal tail is data, not an error.**  Being killed mid-write is
   the normal state of a journal, so :meth:`Journal.read_since` returns the
   entries it could parse and sets ``torn_tail``.  Declaring the whole log
   corrupt would throw away exactly the work the log exists to protect.
5. **Entry names are validated.**  A ``.nova`` file is a ZIP; an entry name is
   untrusted input.  Adapters reject anything
   :func:`~nova_studio.domain.persistence.is_valid_document_name` refuses.
6. **No third-party types.**  No ``sqlite3``, no ``zipfile``, no ``pydantic`` in
   any signature — documents are plain mappings, blobs are ``bytes``.

*Open decision, deliberately not settled here:* ADR-0004 §6 calls the per-project
store a "SQLite container" while ADR-0015 defines ``.nova`` as a ZIP of
canonical-JSON documents.  Whether the SQLite index lives *inside* the archive
as a member or beside it as a sidecar is an ``infra`` decision that must be
made before the adapter is written — SQLite's WAL files cannot live inside a
ZIP member, which argues for a sidecar in the project's data directory with the
archive remaining the portable artefact.  The port is written so that either
answer is one adapter, not one rewrite.
"""

from __future__ import annotations

from enum import StrEnum
from typing import TYPE_CHECKING, Protocol, runtime_checkable

if TYPE_CHECKING:
    from collections.abc import Mapping
    from types import TracebackType

    from nova_studio.core import Result
    from nova_studio.domain.persistence import (
        CacheEntry,
        CacheKind,
        JournalEntry,
        JournalWindow,
        ProjectManifest,
        RevisionRef,
    )

__all__ = [
    "CacheIndex",
    "Journal",
    "PersistenceErrorCode",
    "ProjectArchive",
    "UnitOfWork",
]


class PersistenceErrorCode(StrEnum):
    """The codes a persistence adapter may return in the ``Err`` half.

    Declared beside the contract that defines when each is produced, so the
    vocabulary has one home and ``infra`` never invents a spelling.  The domain
    segment is ``STORAGE`` (:class:`~nova_studio.core.errors.ErrorDomain`), so
    the API maps these to storage-level remedies rather than media ones.
    """

    #: The target path cannot be created or written — read-only volume, missing
    #: directory, permission denied, disk full.
    UNWRITABLE = "NS-STORAGE-4001"
    #: The archive or one of its documents failed validation: bad JSON, missing
    #: manifest, a checksum that does not match the bytes it covers.
    CORRUPT = "NS-STORAGE-4002"
    #: The file was written by a newer Nova Studio than this build.  Refused
    #: whole, never partially parsed (ADR-0015 rule 5).
    UNSUPPORTED_VERSION = "NS-STORAGE-4003"
    #: A revision or journal sequence was asked for that does not exist.
    NO_SUCH_REVISION = "NS-STORAGE-4004"
    #: The operation failed underneath us — I/O error, interrupted write,
    #: another process holding the file.  Retryable, unlike the corrupt case.
    IO_FAILED = "NS-STORAGE-4005"


@runtime_checkable
class UnitOfWork(Protocol):
    """One transaction: the document and the rows commit together or not at all.

    Used as a context manager so that an exception unwinds into a rollback
    without every caller remembering to write ``finally``::

        with unit_of_work as work:
            archive.write_document(...)
            rows.upsert(...)
            work.commit()

    Implementations are expected to refuse a second ``commit`` and to make
    ``rollback`` safe after a commit, because the same mistake appears in every
    codebase that has ever had a transaction object.
    """

    def __enter__(self) -> UnitOfWork:
        """Begin the unit and return it."""
        ...

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        """Roll back if the unit is still open, however the block ended.

        Whether the block raised or simply forgot to commit, the safe end state
        is the same: nothing is left dangling.  A half-open transaction in a
        single-writer store is how an application deadlocks itself an hour
        later, and "keep my work" is spelled :meth:`commit`.
        """
        ...

    def commit(self) -> None:
        """Make every staged change durable.

        Raises an adapter exception (not a ``Result``) because a failure here
        means the caller's own bookkeeping is now wrong — this is a bug or a
        dead disk, not a user-correctable condition.
        """
        ...

    def rollback(self) -> None:
        """Discard every staged change.  Safe to call after ``commit``."""
        ...

    def is_active(self) -> bool:
        """Whether the unit is still open and able to accept work."""
        ...


@runtime_checkable
class ProjectArchive(Protocol):
    """The ``.nova`` container: documents, blobs and the checkpoint history.

    One of these per open project.  Writes are staged and become durable only
    on :meth:`commit`, which is the atomic-replace step; reads see the staged
    state, so a caller can write, read back, and still decide to
    :meth:`discard`.
    """

    # -- reads ------------------------------------------------------------

    def read_manifest(self) -> Result[ProjectManifest]:
        """Return the manifest, or the reason the file cannot be opened.

        Reports :attr:`PersistenceErrorCode.UNSUPPORTED_VERSION` for a file
        written by a newer release and :attr:`PersistenceErrorCode.CORRUPT` for
        one that is not a project at all — the difference is whether the user
        should update Nova Studio or restore from a backup.
        """
        ...

    def read_document(self, name: str) -> Result[Mapping[str, object]]:
        """Return one canonical-JSON document by its entry name.

        Args:
            name: A valid document name from
                :mod:`nova_studio.domain.persistence`.  An invalid name is
                rejected with :attr:`PersistenceErrorCode.CORRUPT` — it cannot
                have come from a project we wrote.
        """
        ...

    def read_blob(self, name: str) -> Result[bytes]:
        """Return one binary entry (a poster image, an embedded proxy)."""
        ...

    def revisions(self) -> Result[tuple[RevisionRef, ...]]:
        """Return the stored checkpoints, oldest first."""
        ...

    # -- staged writes ----------------------------------------------------

    def write_manifest(self, manifest: ProjectManifest) -> Result[None]:
        """Stage the manifest."""
        ...

    def write_document(self, name: str, document: Mapping[str, object]) -> Result[None]:
        """Stage one canonical-JSON document.

        The adapter serialises canonically (sorted keys, no insignificant
        whitespace, UTF-8), which is what makes two saves of an unchanged
        project byte-identical and checksums stable (ADR-0015 rule 2).
        """
        ...

    def write_blob(self, name: str, data: bytes) -> Result[None]:
        """Stage one binary entry."""
        ...

    def checkpoint(self, *, recorded_at_ms: int, label: str = "") -> Result[RevisionRef]:
        """Stage the current timeline document as a numbered revision.

        The timestamp is passed in, never read from a clock inside the adapter:
        the caller owns the clock (ADR-0002 rule 1).  The revision is *staged*;
        it becomes durable with the next :meth:`commit`.
        """
        ...

    def restore(self, sequence: int) -> Result[Mapping[str, object]]:
        """Stage revision ``sequence`` as the current timeline document.

        Returns the restored document so the caller can rebuild its in-memory
        model without re-reading it.  The change is staged, not committed —
        recovery always offers the user a look before it overwrites anything.
        """
        ...

    # -- lifecycle --------------------------------------------------------

    def commit(self) -> Result[None]:
        """Write every staged change atomically and fsync.

        Implemented as: write ``<name>.nova.tmp-<random>`` in the same
        directory, fsync, then ``os.replace``.  A crash may leave a temporary
        file; it may never leave a truncated project (ADR-0015 rule 4).
        """
        ...

    def discard(self) -> None:
        """Drop every staged change, leaving the file as it was."""
        ...

    def close(self) -> None:
        """Release the archive.  Staged changes are *not* committed by this."""
        ...


@runtime_checkable
class Journal(Protocol):
    """The append-only command log behind crash recovery (ADR-0015 rule 6).

    One per open project, written next to the autosave.  The contract is
    deliberately small: append entries, read them back from a sequence number,
    drop everything up to a sequence once a checkpoint has made them redundant.
    """

    def append(self, entry: JournalEntry) -> Result[None]:
        """Append one entry and flush it.

        Flushing on every append is the point: an entry that is still in a
        buffer when the power goes is an edit the user made and we lost.
        """
        ...

    def read_since(self, sequence: int) -> Result[JournalWindow]:
        """Return every entry after ``sequence``.

        A partial trailing line (the process died mid-write) is reported
        through ``JournalWindow.torn_tail`` rather than as an error — the
        entries before it are exactly the work we are trying to recover.
        """
        ...

    def truncate_through(self, sequence: int) -> Result[None]:
        """Drop every entry up to and including ``sequence``.

        Called only after the checkpoint that supersedes those entries has been
        committed; truncating earlier would leave recovery with a checkpoint
        and no commands to replay onto it.
        """
        ...

    def close(self) -> None:
        """Flush and release the log."""
        ...


@runtime_checkable
class CacheIndex(Protocol):
    """Bookkeeping for derived artefacts: what is cached and how much it costs.

    The *policy* — what to evict — is
    :func:`nova_studio.domain.persistence.select_for_eviction`, a pure function
    over the entries this port exposes.  Keeping the decision out of the adapter
    is what lets the eviction rules be tested without a filesystem and changed
    without touching SQL.
    """

    def get(self, key: str) -> CacheEntry | None:
        """Return the entry for ``key``, or ``None`` when nothing is cached."""
        ...

    def put(self, entry: CacheEntry) -> Result[None]:
        """Insert or replace an entry.

        Replacing must preserve ``created_ms`` from the caller's entry: the
        cache index does not decide when something was first computed.
        """
        ...

    def touch(self, key: str, *, at_ms: int) -> Result[None]:
        """Record that ``key`` was used at ``at_ms``.

        Unknown keys are silently ignored — a cache miss that has already been
        evicted is not an error, and turning it into one would make every read
        path handle a failure it cannot act on.
        """
        ...

    def remove(self, key: str) -> Result[None]:
        """Delete an entry and its bytes.  Removing an absent key is not an error."""
        ...

    def entries(self, kind: CacheKind | None = None) -> tuple[CacheEntry, ...]:
        """Return every entry, optionally filtered to one kind.

        The whole index is small by construction — it is metadata about cached
        artefacts, not the artefacts themselves — so returning it in one call is
        what lets the eviction planner be a pure function.
        """
        ...

    def total_bytes(self) -> int:
        """Bytes currently held by cached artefacts, across all kinds."""
        ...

    def close(self) -> None:
        """Release the index."""
        ...
