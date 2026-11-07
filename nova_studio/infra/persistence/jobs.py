"""L4 — the job history: one port, two adapters, one constructor apart.

:class:`~nova_studio.ports.jobs.JobStore` exists for one reason: **history must
outlive the pools.** After a crash there is no executor, nothing is running, and
the only thing that can tell the user "these three exports were interrupted" is
something that was written down.

Two adapters implement it, and the difference between them is one line in the
composition root:

:class:`JsonJobStore`
    One JSON document in the data directory. The adapter the service shipped
    with, kept because it is the fallback when the install database cannot be
    opened — a history that cannot be written is not a reason to refuse to
    start — and because it is the shape an upgrade *imports from*.
:class:`SqliteJobStore`
    Rows in ``nova.db`` (ADR-0004 §6, migration ``job_history``). Wired in
    production. Queries are queries: `by_kind` and `reconcile_interrupted` are
    indexed rather than a scan of everything ever run.

Both obey the same rules, because the rules belong to the port and not to a
storage engine:

* **A record is written before the work starts, and after every transition.**
  The last thing the process did is always on disk (port rule 4), which is the
  whole of post-crash reporting — and a job whose record cannot be written is
  not started, because the alternative is work nobody can account for.
* **A write is atomic.** The file adapter stages beside the target and promotes
  with ``os.replace``, which is only atomic within one filesystem; the SQL
  adapter writes one row in one statement, and reconciles inside one
  transaction.
* **A corrupt row is data, not an error.** One unreadable record hides itself
  and leaves the rest of the history readable: a history that cannot be read
  must not take the editor down with it.
* **The bytes are the same.** Both adapters serialise a record with
  :func:`record_json`, so a row and a file entry are the same string for the
  same job — which is what makes the upgrade an import and not a translation.
"""

from __future__ import annotations

import contextlib
import json
import os
import threading
import uuid
from typing import TYPE_CHECKING, Any

from nova_studio.core.clock import SystemClock
from nova_studio.core.errors import NovaError
from nova_studio.core.jobs import JobRecord
from nova_studio.core.result import Result, err, ok
from nova_studio.ports.jobs import JobErrorCode

if TYPE_CHECKING:
    from pathlib import Path

__all__ = [
    "JOB_HISTORY_NAME",
    "JsonJobStore",
    "job_history_path",
    "job_unavailable",
    "record_json",
]

#: The file's name inside the data directory. One name, so a support engineer
#: reading a bug report knows where to look and a user cleaning up knows what
#: they are deleting.
JOB_HISTORY_NAME: str = "jobs.json"

#: Bumped only when the shape changes incompatibly. Read, not enforced: this
#: store is a cache of history, and a future version that cannot read it starts
#: a new one rather than refusing to start at all.
HISTORY_VERSION: int = 1


def job_history_path(data_root: Path) -> Path:
    """Where one install's job history lives."""
    return data_root / JOB_HISTORY_NAME


def record_json(record: JobRecord) -> str:
    """The bytes one record is stored as, whichever adapter is storing it.

    ``sort_keys`` and ``allow_nan=False`` are not decoration: the first makes
    the bytes stable, so two writes of one record produce one string and a test
    can compare them; the second refuses a float that JSON cannot spell, which
    would otherwise be written by one adapter, read back as ``NaN`` by the
    other, and fail somewhere with no connection to where it came from.
    """
    return json.dumps(
        record.to_wire(),
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
        allow_nan=False,
    )


def job_unavailable(cause: str, *, path: str = "") -> NovaError:
    return NovaError(
        JobErrorCode.RECORD_UNAVAILABLE,
        "the job history could not be read or written",
        remedy="Check that the application data directory is writable.",
        cause=cause,
        details={"path": path},
    )


class JsonJobStore:
    """The job record, persisted as one JSON document.

    Every method is synchronous and cheap: a job history is small — hundreds of
    rows, not millions — and the record is rewritten whole on each transition,
    which is what makes the file impossible to half-update.

    Args:
        path: Where the document lives. Resolved by the caller, so a test uses
            a temporary directory and the composition root uses
            :func:`job_history_path`.
        clock: For :meth:`reconcile_interrupted`, which stamps the moment the
            interruption was noticed rather than the moment it happened — the
            process was not running to notice.
    """

    __slots__ = ("_clock", "_lock", "_path")

    def __init__(self, path: Path, *, clock: Any = None) -> None:
        self._path = path
        self._clock = clock if clock is not None else SystemClock()
        # One writer at a time. Every public method is a read-modify-write over
        # one document, and two jobs finishing at the same moment would each
        # read the whole history and write back their own copy — one of them
        # silently losing the other's record. The lock lives here because this
        # is the only place it can: a lock in every caller is a lock somebody
        # forgets to take.
        self._lock = threading.RLock()

    @property
    def path(self) -> Path:
        """Where this history lives. Readable so a caller can reopen it."""
        return self._path

    # -- the port ---------------------------------------------------------

    def put(self, record: JobRecord) -> Result[None]:
        """Write or overwrite one record, atomically.

        Called before a job starts and again on every transition, so the last
        thing the process did is always on disk. Failure is
        :attr:`JobErrorCode.RECORD_UNAVAILABLE`, and a job whose record cannot
        be written is not started.
        """
        with self._lock:
            try:
                document = self._read_document()
            except OSError as error:
                return err(job_unavailable(str(error), path=str(self._path)))
            if document is None:
                return err(job_unavailable("the file is not a job history", path=str(self._path)))
            document["jobs"][record.job_id] = record.to_wire()
            return self._write_document(document)

    def get(self, job_id: str) -> JobRecord | None:
        """Read one record, or ``None`` if this job was never recorded.

        A missing record is an ordinary answer, not an error: the resync path
        asks about ids that may have been pruned.
        """
        with self._lock:
            try:
                document = self._read_document()
            except OSError:
                return None
            if document is None:
                return None
            wire = document["jobs"].get(job_id)
            if wire is None:
                return None
            try:
                return JobRecord.from_wire(wire)
            except Exception:
                # One unreadable row must not hide the rest of the history: the
                # panel shows what it can, and the bad row is overwritten by
                # the next `put` for that id, if there is one.
                return None

    def active(self) -> tuple[JobRecord, ...]:
        """Every record that is not in a terminal state, in submission order."""
        with self._lock:
            return self._select(lambda record: record.is_active)

    def by_kind(self, kind: str, *, limit: int = 50) -> tuple[JobRecord, ...]:
        """Recent records for one job kind, newest first."""
        with self._lock:
            matches = self._select(lambda record: record.kind == kind)
            ordered = sorted(matches, key=lambda record: record.submitted_ms, reverse=True)
            return tuple(ordered[:limit])

    def reconcile_interrupted(self) -> tuple[JobRecord, ...]:
        """Turn every non-terminal record into
        :attr:`~nova_studio.core.jobs.JobStatus.INTERRUPTED` (ADR-0010 §6).

        Called once, at startup. A job that was ``RUNNING`` when the editor
        closed did not fail and did not finish — it was interrupted, and the
        user is shown a resume action. Bleaching the table instead would lose
        exactly the work the record exists to protect.

        Returns:
            The reconciled records, so the UI can list what was lost.
        """
        with self._lock:
            now_ms = self._clock.now_ms()
            try:
                document = self._read_document()
            except OSError:
                return ()
            if document is None:
                return ()
            reconciled: list[JobRecord] = []
            for job_id, wire in document["jobs"].items():
                try:
                    record = JobRecord.from_wire(wire)
                except Exception:
                    continue
                if not record.is_active:
                    continue
                interrupted = record.interrupted(now_ms)
                document["jobs"][job_id] = interrupted.to_wire()
                reconciled.append(interrupted)
            written = self._write_document(document)
            if written.is_err():
                return ()
            return tuple(reconciled)

    def prune(self, *, older_than_ms: int) -> int:
        """Delete terminal records finished before ``older_than_ms``.

        Job history accumulates: a month of exports and transcriptions is
        thousands of rows. Only terminal records go, so a crash cannot disappear
        a job that might still be resumable.
        """
        with self._lock:
            try:
                document = self._read_document()
            except OSError:
                return 0
            if document is None:
                return 0
            keep: dict[str, dict[str, object]] = {}
            for job_id, wire in document["jobs"].items():
                try:
                    record = JobRecord.from_wire(wire)
                except Exception:
                    continue
                finished = record.finished_ms
                terminal = record.status.is_terminal
                if terminal and finished is not None and finished < older_than_ms:
                    continue
                keep[job_id] = wire
            removed = len(document["jobs"]) - len(keep)
            if removed:
                document["jobs"] = keep
                if self._write_document(document).is_err():
                    return 0
            return removed

    # -- internals --------------------------------------------------------

    def _select(self, predicate: Any) -> tuple[JobRecord, ...]:
        try:
            document = self._read_document()
        except OSError:
            return ()
        if document is None:
            return ()
        records: list[JobRecord] = []
        for wire in document["jobs"].values():
            try:
                record = JobRecord.from_wire(wire)
            except Exception:
                continue
            if predicate(record):
                records.append(record)
        records.sort(key=lambda record: record.submitted_ms)
        return tuple(records)

    def _read_document(self) -> dict[str, Any] | None:
        """The whole history, or ``None`` when the file is absent or unreadable.

        Absent and unreadable are the same answer to a reader — there is no
        history — and a caller that needs to distinguish them reads the error
        from :meth:`put`, which is the operation that must not silently lose
        one.
        """
        try:
            raw = self._path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return {"version": HISTORY_VERSION, "jobs": {}}
        except OSError:
            raise
        try:
            document = json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            return None
        if not isinstance(document, dict) or not isinstance(document.get("jobs"), dict):
            return None
        return document

    def _write_document(self, document: dict[str, Any]) -> Result[None]:
        """Write the history atomically: stage beside, fsync, promote.

        The temporary file is a sibling, not a ``/tmp`` file, because
        ``os.replace`` is only atomic inside one filesystem (see
        ``infra/persistence/paths.py``).
        """
        self._path.parent.mkdir(parents=True, exist_ok=True)
        # Unique per write, not per process: two threads staging at the same
        # moment would otherwise race to rename the same temporary file, and
        # one of the renames would fail on a file the other had already moved.
        staged = self._path.parent / f"{self._path.name}.{os.getpid()}.{uuid.uuid4().hex}.tmp"
        payload = json.dumps(
            document,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
            allow_nan=False,
        )  # the document's own spelling; each record inside it uses record_json
        try:
            with staged.open("w", encoding="utf-8") as handle:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            staged.replace(self._path)
            _fsync_directory(self._path.parent)
        except OSError as error:
            _discard(staged)
            return err(job_unavailable(str(error), path=str(self._path)))
        return ok(None)


def _fsync_directory(directory: Any) -> None:
    """Persist the rename itself, not just the bytes.

    A directory entry is metadata, and without this a power cut can leave the
    old file in place after ``replace`` reported success — which for a job
    history means reporting a job as interrupted when it had in fact finished.
    """
    try:
        handle = os.open(str(directory), os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(handle)
    except OSError:
        pass
    finally:
        os.close(handle)


def _discard(path: Any) -> None:
    """Remove a staged file. A failure here is not the caller's problem."""
    with contextlib.suppress(OSError):
        path.unlink(missing_ok=True)
