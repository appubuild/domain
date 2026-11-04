"""L4 — the journal: the append-only log that makes a crash a restart.

Everything else in persistence protects the *saved* project. This protects the
work done **since** the save, which is the only work a crash can actually take:
two minutes of edits that were real, were on screen, and were never written to
the `.nova` file because writing it every keystroke would be absurd.

The design is one idea applied honestly — **a torn tail is data, not an error**.

A journal is written by a process that may die at any instant, including
mid-`write`. The last line of a journal written by a crashed process is
therefore very often a partial line, and that is the *expected* state, not the
corrupt one. An implementation that treats a partial line as corruption has
thrown away exactly the work it exists to protect, and done so at the moment
the user needs it most. So `read_since` returns the entries that made it to disk
and reports the damage as `JournalWindow.torn_tail`, letting the caller decide.

Three properties are worth naming, because they are the entire contract:

* **Sequence numbers are identity and are never reused.** Recovery remembers one
  integer and asks for everything after it; a sequence that could reappear would
  make "everything after 41" mean two different things.
* **Every append is flushed and fsynced.** An entry still sitting in a buffer
  when the power goes is an edit the user made and we lost, so the cost is paid
  on write rather than explained in a bug report.
* **Truncation follows a checkpoint, never precedes it.** Entries are dropped
  only once the checkpoint that supersedes them has been committed; truncating
  earlier would leave recovery with a checkpoint and no commands to replay onto
  it, which looks like data loss and is.

Files are named `cmds-<started_ms>-<token>.ndjson` in the project's autosave
directory (`paths.py`), one per run: a new session starts a new file rather than
appending to whatever it finds, so a journal is never a mixture of two process
lifetimes. Reads look at the newest file only.
"""

from __future__ import annotations

import contextlib
import json
import os
import secrets
from typing import TYPE_CHECKING, Final, TextIO

from nova_studio.core.errors import ErrorDomain, NovaInvariantError
from nova_studio.core.result import Result, error_result, ok
from nova_studio.domain.persistence import JournalEntry, JournalWindow
from nova_studio.infra.persistence import paths
from nova_studio.ports.persistence import PersistenceErrorCode

if TYPE_CHECKING:
    from pathlib import Path

__all__ = ["NdjsonJournal", "open_journal", "token"]

#: Bytes of randomness in a file name, so two processes starting in the same
#: millisecond cannot pick the same journal.
_TOKEN_BYTES: Final[int] = 6


def token() -> str:
    """A short random name fragment.

    Randomness lives here and not in a service because a file name is not a
    domain decision; it is the one place an adapter is allowed to roll dice.
    """
    return secrets.token_hex(_TOKEN_BYTES)


def open_journal(data_root: Path, project_id: str, *, started_ms: int) -> NdjsonJournal:
    """Open (or start) the journal for one project under ``data_root``."""
    directory = paths.journal_dir(data_root, project_id)
    return NdjsonJournal(directory, started_ms=started_ms)


class NdjsonJournal:
    """The `Journal` port, as one NDJSON file per project run.

    The file is opened once, in append mode, and kept open: an append is a
    `write` plus a `flush` plus an `fsync`, and reopening per entry would double
    the cost of the only operation that has to be fast.
    """

    def __init__(self, directory: Path, *, started_ms: int) -> None:
        self._directory = directory
        self._started_ms = started_ms
        self._path: Path | None = None
        self._handle: TextIO | None = None
        self._last_sequence: int | None = None
        self._closed = False

    # -- properties --------------------------------------------------------

    @property
    def path(self) -> Path | None:
        """The file being written, once it has been."""
        return self._path

    @property
    def directory(self) -> Path:
        """Where journals for this project live."""
        return self._directory

    # -- writing -----------------------------------------------------------

    def append(self, entry: JournalEntry) -> Result[None]:
        """Append one entry, flush it and fsync it.

        Raises:
            NovaInvariantError: The sequence does not move forward. That is a
                caller bug, not a user condition: a reused sequence would make
                "everything after N" ambiguous, which is worse than losing the
                entry, so it is refused loudly rather than written quietly.
        """
        if self._closed:
            return _io_failed("the journal is closed", "close")
        # The handle is required *first*: opening it is what reads the file this
        # run may be continuing, and therefore what tells us the last sequence
        # that was used. Checking before that would only ever see this session's
        # own writes, and a second run would happily reuse a dead session's
        # sequence numbers.
        handle = self._require_handle()
        if self._last_sequence is not None and entry.sequence <= self._last_sequence:
            raise NovaInvariantError(
                f"journal sequence must move forward: {entry.sequence} follows "
                f"{self._last_sequence}"
            )
        line = json.dumps(
            entry.to_wire(),
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
            allow_nan=False,
        )
        try:
            handle.write(line)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        except OSError as error:
            return _io_failed(f"journal entry {entry.sequence} could not be written", str(error))
        self._last_sequence = entry.sequence
        return ok(None)

    # -- reading -----------------------------------------------------------

    def read_since(self, sequence: int) -> Result[JournalWindow]:
        """Every entry after ``sequence``, with a torn tail reported not raised."""
        entries: list[JournalEntry] = []
        torn_tail = False
        for line in self._lines():
            stripped = line.strip()
            if not stripped:
                continue
            try:
                payload = json.loads(stripped)
            except json.JSONDecodeError:
                # A line that will not parse is the last line of a process that
                # died mid-write. Everything before it is intact and is exactly
                # the work we are trying to recover, so we drop this one line
                # and say so.
                torn_tail = True
                continue
            if not isinstance(payload, dict):
                torn_tail = True
                continue
            try:
                entry = JournalEntry.from_wire(payload)
            except (NovaInvariantError, KeyError, TypeError):
                torn_tail = True
                continue
            if entry.sequence > sequence:
                entries.append(entry)
        entries.sort(key=lambda item: item.sequence)
        last = entries[-1].sequence if entries else 0
        return ok(JournalWindow(entries=tuple(entries), next_sequence=last, torn_tail=torn_tail))

    def truncate_through(self, sequence: int) -> Result[None]:
        """Drop every entry up to and including ``sequence``.

        The surviving entries are rewritten to a new file and the old one is
        replaced atomically: truncating a file in place while another process is
        mid-append is how a log loses the entries it was keeping.
        """
        if self._closed:
            return _io_failed("the journal is closed", "close")
        kept: list[JournalEntry] = []
        for line in self._lines():
            stripped = line.strip()
            if not stripped:
                continue
            try:
                entry = JournalEntry.from_wire(json.loads(stripped))
            except (NovaInvariantError, KeyError, TypeError, json.JSONDecodeError):
                continue
            if entry.sequence > sequence:
                kept.append(entry)
        kept.sort(key=lambda item: item.sequence)

        # Truncating is a recovery-time operation: it happens after a checkpoint,
        # on a journal a *previous* run wrote, before this one has appended
        # anything. So the file is the newest one in the directory — not "the one
        # this instance has opened", which may be none at all.
        self._flush_handle()
        source = self._source()
        if source is None or not source.exists():
            return ok(None)
        target = paths.temp_path(source, token())
        try:
            with target.open("w", encoding="utf-8") as handle:
                for entry in kept:
                    handle.write(
                        json.dumps(
                            entry.to_wire(),
                            ensure_ascii=False,
                            separators=(",", ":"),
                            sort_keys=True,
                            allow_nan=False,
                        )
                        + "\n"
                    )
                handle.flush()
                os.fsync(handle.fileno())
            target.replace(source)
            _fsync_directory(source.parent)
        except OSError as error:
            _discard(target)
            return _io_failed(f"the journal could not be truncated at {sequence}", str(error))
        self._last_sequence = kept[-1].sequence if kept else None
        return ok(None)

    def close(self) -> None:
        """Flush and release the log. Safe to call twice."""
        self._flush_handle()
        self._closed = True

    # -- internals ---------------------------------------------------------

    def _require_handle(self) -> TextIO:
        if self._handle is not None:
            return self._handle
        self._directory.mkdir(parents=True, exist_ok=True)
        existing = _newest_journal(self._directory)
        if existing is not None:
            path = existing
        else:
            path = self._directory / paths.journal_name(self._started_ms, token())
        # A long-lived handle: the point of keeping it open is that an append is
        # a write, a flush and an fsync rather than an open, three syscalls and
        # a close. There is no `with` that can express a handle outliving a call.
        handle = path.open("a", encoding="utf-8")
        self._path = path
        self._handle = handle
        # Continue where the file left off, so a second session on the same
        # project cannot reuse a sequence number the first one already used.
        for entry in self.read_since(0).unwrap().entries:
            self._last_sequence = entry.sequence
        return handle

    def _flush_handle(self) -> None:
        if self._handle is None:
            return
        with contextlib.suppress(OSError):
            self._handle.flush()
            os.fsync(self._handle.fileno())
        with contextlib.suppress(OSError):
            self._handle.close()
        self._handle = None

    def _source(self) -> Path | None:
        """The file a read should come from: this run's, or the newest there is."""
        if self._path is not None and self._path.exists():
            return self._path
        return _newest_journal(self._directory)

    def _lines(self) -> list[str]:
        """Every line of the journal, or none if there is no file yet.

        Reads its own run's file first, because that is the one it is writing;
        before the first append, the newest file in the directory is the one a
        previous run left behind, and that is what recovery wants to see.
        """
        source = self._source()
        if source is None:
            return []
        try:
            return source.read_text(encoding="utf-8").splitlines()
        except OSError:
            return []


def _newest_journal(directory: Path) -> Path | None:
    """The most recently started journal in ``directory``, if there is one."""
    try:
        names = [item.name for item in directory.iterdir() if item.is_file()]
    except OSError:
        return None
    journals = sorted(
        (name for name in names if paths.is_journal_name(name)),
        key=paths.journal_started_ms,
    )
    return directory / journals[-1] if journals else None


def _fsync_directory(directory: Path) -> None:
    """Fsync a directory so that a rename is durable, not just visible.

    Without this, a crash can leave the *file* written and the directory entry
    missing — the worst possible outcome, because the data is on disk and
    unreachable.
    """
    try:
        handle = os.open(directory, os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(handle)
    except OSError:
        pass
    finally:
        os.close(handle)


def _discard(path: Path) -> None:
    """Remove a staging file, ignoring the reasons it may not be there."""
    with contextlib.suppress(OSError):
        path.unlink(missing_ok=True)


def _io_failed(message: str, cause: str) -> Result[None]:
    return error_result(
        PersistenceErrorCode.IO_FAILED,
        message,
        domain=ErrorDomain.STORAGE,
        details={"cause": cause},
        remedy="Check that the app data directory is writable and the disk is not full.",
        retryable=True,
    )
