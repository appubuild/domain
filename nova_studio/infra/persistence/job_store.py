"""L4 — the job history as rows, in the install database.

The second :class:`~nova_studio.ports.jobs.JobStore` adapter (the first is
:class:`~nova_studio.infra.persistence.jobs.JsonJobStore`), and the one the
service uses. Same port, same rules, different engine — the swap is a
constructor argument, which is the whole reason the port was drawn.

What the rows buy, and what they deliberately do not
---------------------------------------------------

**The columns are the index; ``record_json`` is the record.** ``by_kind``,
``active``, ``reconcile_interrupted`` and ``prune`` are all queries over
``kind``, ``status``, ``attempts`` or a timestamp, so those are columns.
Everything else — progress, artefacts, the resume checkpoint — is the record's
own JSON, read whole and handed to
:meth:`~nova_studio.core.jobs.JobRecord.from_wire`. That split is ADR-0004 §3
one level down, and it buys the same thing it buys there: **a new field on
``JobRecord`` is not a migration.** A column per field would make every schema
version a negotiation with a table nobody has queried yet.

**The domain owns the vocabulary.** Which statuses mean "still active" is
:attr:`JobStatus.is_terminal`, and this adapter asks rather than spelling a
second list in a query — a second list is a second definition, and the two
disagree the first time somebody adds a status.

**A history is a cache of what happened, not a ledger of what is true.** Every
read tolerates a row it cannot parse rather than failing, because a history that
refuses to open is worse than a history with a hole: the panel shows what it
can, and the next ``put`` for that id overwrites the unreadable row.

**Writes are one statement.** ``put`` is a single upsert, so there is no window
in which a reader sees a job half-updated. The two operations that touch many
rows — ``reconcile_interrupted`` and ``prune`` — take the lock and a
transaction, because a reconcile that marked three of five interrupted is not a
state the UI has a word for.

Concurrency
-----------

The history is written from job threads and read from the request pool, so the
gateway is opened ``shared=True`` (see ``sqlite.py``) and every operation takes
an :class:`~threading.RLock` of this object's. The lock is here and not in the
caller for the same reason it is in the JSON adapter: a lock in every caller is
a lock somebody forgets to take.
"""

from __future__ import annotations

import json
import threading
from typing import TYPE_CHECKING, Any, Final

from nova_studio.core.clock import SystemClock
from nova_studio.core.jobs import JobRecord, JobStatus
from nova_studio.core.result import Result, err, ok
from nova_studio.infra.persistence.jobs import job_unavailable, record_json
from nova_studio.infra.persistence.migrations import ensure_schema
from nova_studio.infra.persistence.paths import install_database_path
from nova_studio.infra.persistence.sqlite import SqliteError, SqliteGateway

if TYPE_CHECKING:
    from collections.abc import Mapping, Sequence
    from pathlib import Path

    from nova_studio.ports.clock import Clock

__all__ = ["SqliteJobStore", "import_json_history", "open_job_store"]

_COLUMNS: Final[tuple[str, ...]] = (
    "job_id",
    "kind",
    "status",
    "priority",
    "params_hash",
    "submitted_ms",
    "updated_ms",
    "started_ms",
    "finished_ms",
    "attempts",
    "error_code",
)

#: The upsert, in one statement: a job is written before it starts and again on
#: every transition, and a reader must never find it half-written.
_UPSERT: Final[str] = f"""
INSERT INTO jobs ({", ".join(_COLUMNS)}, record_json)
VALUES ({", ".join("?" for _ in _COLUMNS)}, ?)
ON CONFLICT(job_id) DO UPDATE SET
    {", ".join(f"{name} = excluded.{name}" for name in _COLUMNS if name != "job_id")},
    record_json = excluded.record_json
"""

_SELECT: Final[str] = f"SELECT {', '.join(_COLUMNS)}, record_json FROM jobs"

#: Which statuses count as "still holding a slot", derived from the domain
#: rather than written here. `active()` narrows its query with these so the
#: index on `status` does the work, then asks the record to be sure.
_ACTIVE_STATUSES: Final[tuple[str, ...]] = tuple(
    status.value for status in JobStatus if not status.is_terminal
)
_TERMINAL_VALUES: Final[tuple[str, ...]] = tuple(
    status.value for status in JobStatus if status.is_terminal
)


def open_job_store(data_root: Path, *, clock: Clock | None = None) -> SqliteJobStore:
    """Open the install's job history, importing whatever predates the rows.

    A database that has never been opened is migrated here, and a ``jobs.json``
    left by an earlier build is then imported into it — see
    :func:`import_json_history`. The file is left on disk: it is another
    build's record of work, deleting it is not ours to decide, and an install
    whose database was thrown away can rebuild from it.
    """
    data_root.mkdir(parents=True, exist_ok=True)
    gateway = SqliteGateway(install_database_path(data_root), shared=True)
    gateway.open()
    ensure_schema(gateway)
    store = SqliteJobStore(gateway, clock=clock)
    legacy = data_root / "jobs.json"
    if legacy.exists():
        import_json_history(legacy, store)
    return store


def import_json_history(source: Path, target: SqliteJobStore) -> int:
    """Copy one file-backed history into the rows. Returns how many moved.

    Skips a job the rows already hold, so running it twice is a no-op — which
    is what makes an interrupted import, or a second window starting while the
    first is still importing, a non-event rather than a duplicate.

    A row the file cannot be parsed into is skipped rather than raised: the
    import exists to carry history forward, and one unreadable record is not a
    reason to lose the other two hundred.
    """
    records = _records_in_file(source)
    moved = 0
    for record in records:
        if target.get(record.job_id) is None:
            target.put(record)
            moved += 1
    return moved


def _records_in_file(path: Path) -> tuple[JobRecord, ...]:
    """Every record a ``jobs.json`` holds, active or not.

    The port has no "read everything" method — a history is read by kind or by
    whether a job is still running, which is what the UI asks — so the import
    reads the file itself. That is acceptable *because* it is a migration: a
    migration is allowed to know both sides of itself, and this is the only
    place in the codebase that knows both.
    """
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError:
        return ()
    try:
        document: Any = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        return ()
    jobs = document.get("jobs") if isinstance(document, dict) else None
    if not isinstance(jobs, dict):
        return ()
    records: list[JobRecord] = []
    for wire in jobs.values():
        try:
            records.append(JobRecord.from_wire(wire))
        except Exception:
            continue
    return tuple(records)


class SqliteJobStore:
    """The `JobStore` port, on rows in ``nova.db``.

    Args:
        gateway: An **open** gateway on the install database. Injected rather
            than built from a path so a test can share one connection with a
            fixture, and so the caller decides whether it is shared.
        clock: For :meth:`reconcile_interrupted`, which stamps the moment the
            interruption was *noticed* — the process was not running to notice
            it happening.
    """

    __slots__ = ("_clock", "_gateway", "_lock")

    def __init__(self, gateway: SqliteGateway, *, clock: Clock | None = None) -> None:
        self._gateway = gateway
        self._clock: Any = clock if clock is not None else SystemClock()
        self._lock = threading.RLock()

    # -- the port ---------------------------------------------------------

    def put(self, record: JobRecord) -> Result[None]:
        """Write or overwrite one record, in one statement.

        Failure is :attr:`JobErrorCode.RECORD_UNAVAILABLE`, and a job whose
        record cannot be written is not started.
        """
        with self._lock:
            try:
                self._gateway.run(_UPSERT, _params(record))
            except SqliteError as error:
                return err(job_unavailable(str(error)))
            return ok(None)

    def get(self, job_id: str) -> JobRecord | None:
        """Read one record, or ``None`` if this job was never recorded."""
        with self._lock:
            rows = self._rows(f"{_SELECT} WHERE job_id = ?", (job_id,))
            return rows[0] if rows else None

    def active(self) -> tuple[JobRecord, ...]:
        """Every record that is not in a terminal state, in submission order."""
        placeholders = ", ".join("?" for _ in _ACTIVE_STATUSES)
        with self._lock:
            records = self._rows(f"{_SELECT} WHERE status IN ({placeholders})", _ACTIVE_STATUSES)
            return tuple(sorted((r for r in records if r.is_active), key=lambda r: r.submitted_ms))

    def by_kind(self, kind: str, *, limit: int = 50) -> tuple[JobRecord, ...]:
        """Recent records for one job kind, newest first. Served by `jobs_by_kind`."""
        with self._lock:
            return self._rows(
                f"{_SELECT} WHERE kind = ? ORDER BY updated_ms DESC LIMIT ?", (kind, limit)
            )

    def reconcile_interrupted(self) -> tuple[JobRecord, ...]:
        """Turn every non-terminal record into ``INTERRUPTED`` (ADR-0010 §6).

        Called once at start-up. A job that was ``RUNNING`` when the power went
        out did not fail and did not finish; bleaching the table instead would
        lose exactly the work the record exists to protect.

        Returns:
            The reconciled records, so the UI can list what was lost. An empty
            tuple on failure: the editor must start even if its history cannot.
        """
        with self._lock:
            now_ms = self._clock.now_ms()
            stale = self.active()
            if not stale:
                return ()
            interrupted = [record.interrupted(now_ms) for record in stale]
            try:
                self._gateway.begin()
                for record in interrupted:
                    self._gateway.run(_UPSERT, _params(record))
            except SqliteError:
                self._gateway.rollback()
                return ()
            self._gateway.commit()
            return tuple(interrupted)

    def prune(self, *, older_than_ms: int) -> int:
        """Delete terminal records finished before ``older_than_ms``.

        Job history accumulates: a month of exports and transcriptions is
        thousands of rows. Only terminal records go, so a crash cannot
        disappear a job that might still be resumable.
        """
        placeholders = ", ".join("?" for _ in _TERMINAL_VALUES)
        with self._lock:
            try:
                removed = self._gateway.run(
                    "DELETE FROM jobs WHERE finished_ms IS NOT NULL AND finished_ms < ?"
                    f" AND status IN ({placeholders})",
                    (older_than_ms, *_TERMINAL_VALUES),
                )
            except SqliteError:
                return 0
            return max(removed, 0)

    # -- internals --------------------------------------------------------

    def _rows(self, sql: str, params: Sequence[object] = ()) -> tuple[JobRecord, ...]:
        """Run a query and rebuild what it can. A row that will not parse is
        skipped, not raised: one bad record must not hide the rest."""
        try:
            rows = self._gateway.rows(sql, params)
        except SqliteError:
            return ()
        records: list[JobRecord] = []
        for row in rows:
            try:
                records.append(JobRecord.from_wire(_json_of(row)))
            except Exception:
                continue
        return tuple(records)


def _json_of(row: Mapping[str, object]) -> dict[str, object]:
    """The record, out of the column that holds it."""
    return dict(json.loads(str(row["record_json"])))


def _params(record: JobRecord) -> tuple[object, ...]:
    """One record as the upsert's parameters: the columns, then the JSON."""
    return (
        record.job_id,
        record.kind,
        record.status.value,
        record.priority.value,
        record.params_hash,
        record.submitted_ms,
        # The newest timestamp the record carries: "recent" in a job history
        # means "the last thing that happened to it" — when a finished job
        # finished, when a waiting one was submitted.
        record.finished_ms
        if record.finished_ms is not None
        else (record.started_ms or record.submitted_ms),
        record.started_ms,
        record.finished_ms,
        record.attempts,
        record.error_code,
        record_json(record),
    )
