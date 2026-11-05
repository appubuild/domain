"""L4 — the workspace: which projects this session has open.

A REST service is stateless by habit and a desktop editor is not: between two
requests there is a project in memory, an autosave clock running, a journal being
appended to, and a file that may or may not match what is on screen. Somebody has
to own that, and this module is that somebody.

It owns **plumbing, not policy**:

* which projects are open, and which archive and journal each is attached to;
* that two requests cannot write the same project at once;
* that an edit is journalled and fsynced *before* it is acknowledged, so a crash
  is a restart rather than a loss (ADR-0015 rule 6);
* that a checkpoint truncates the journal it has just made redundant.

Every *decision* — when a checkpoint is owed, what a recovery dialog offers,
whether a damaged project still opens — belongs to `services/projects` and is
delegated there. The only rules here are "one project, one lock, one journal".

**Why the methods are synchronous.** Opening and saving block: a `.nova` file is
a zip, and a save ends in an atomic replace and a directory fsync. Declaring
these handlers `async def` would run that blocking I/O on the event loop and
stall every other client, including the socket carrying export progress. FastAPI
runs a plain `def` handler in its worker thread pool instead, which is what these
want — so the guards here are `threading` locks, not `asyncio` ones.

**Events.** Every lifecycle change is published, because the window is not the
only thing that cares: the autosave indicator, the recent-projects list and a
future "this file changed on disk" watcher all need to know, and none of them
should have to poll.
"""

from __future__ import annotations

import threading
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Final

from nova_studio import __version__
from nova_studio.core.clock import SystemClock
from nova_studio.core.errors import ErrorDomain, ErrorSeverity, NovaError
from nova_studio.core.ident import new_entity_id
from nova_studio.core.result import Result, err, ok
from nova_studio.domain.persistence import JournalEntry
from nova_studio.domain.project import Project, ProjectMetadata
from nova_studio.infra.persistence.archive import SUPPORTED_FORMAT_VERSION, ZipProjectArchive
from nova_studio.infra.persistence.journal import open_journal
from nova_studio.services.projects import (
    DEFAULT_AUTOSAVE,
    AutosaveState,
    ProjectAudit,
    ProjectSession,
    RecoveryPlan,
    plan_recovery,
)

if TYPE_CHECKING:
    from collections.abc import Iterator, Mapping, Sequence
    from pathlib import Path

    from nova_studio.core.events import EventBus
    from nova_studio.domain.persistence import CheckpointPolicy, ProjectManifest, RevisionRef
    from nova_studio.ports.clock import Clock
    from nova_studio.ports.persistence import Journal, ProjectArchive

__all__ = [
    "CHECKPOINT_ENTRY",
    "NS_PROJECT_ALREADY_OPEN",
    "NS_PROJECT_JOURNAL_FAILED",
    "NS_PROJECT_NEVER_SAVED",
    "NS_PROJECT_NOT_OPEN",
    "NS_PROJECT_NO_SUCH_FILE",
    "NS_PROJECT_REFUSED",
    "Checkpoint",
    "OpenProject",
    "ProjectWorkspace",
    "SavedProject",
    "already_open",
    "journal_failed",
    "never_saved",
    "no_such_file",
    "not_open",
    "refused",
]

#: This project is already open here. Two handles on one archive would disagree
#: about what the file contains, and the second save would silently win.
NS_PROJECT_ALREADY_OPEN: Final[str] = "NS-PROJECT-4090"

#: The project has never been given a file, so there is nowhere to save it.
NS_PROJECT_NEVER_SAVED: Final[str] = "NS-PROJECT-4091"

#: The journal could not be written. The edit in memory is fine, but the crash
#: guarantee is broken, so the user is told rather than reassured.
NS_PROJECT_JOURNAL_FAILED: Final[str] = "NS-PROJECT-4005"

#: No project with this id is open in this session. The transport reports this
#: as 404 however severe the domain thinks it is — see `routers/projects.py`.
NS_PROJECT_NOT_OPEN: Final[str] = "NS-PROJECT-4040"

#: The file the caller named is not there. The archive's own answer to this is
#: "not a Nova Studio project", which is true and unhelpful: the user's next
#: move is different depending on whether the file is missing or damaged.
NS_PROJECT_NO_SUCH_FILE: Final[str] = "NS-PROJECT-4041"

#: The project the caller asked for could not be constructed (an empty name).
NS_PROJECT_REFUSED: Final[str] = "NS-PROJECT-4220"

#: The journal name of a checkpoint entry, so a recovery read can find it.
CHECKPOINT_ENTRY: Final[str] = "checkpoint"

_TOPIC_PREFIX: Final[str] = "project"


@dataclass(frozen=True, slots=True)
class OpenProject:
    """One project this session has open, as a value.

    Handed out rather than the internal entry, so a caller sees the project and
    its bookkeeping but cannot reach the archive, the journal or the lock — and
    so two callers holding the same value cannot disagree about it.
    """

    project_id: str
    name: str
    project: Project
    #: Where it came from, or `None` for one that has never been saved.
    path: Path | None
    #: Whether the project in memory differs from what is on disk.
    dirty: bool
    autosave: AutosaveState
    #: Newest journalled sequence; `0` when nothing has been recorded yet.
    journal_sequence: int
    #: The sequence of the newest checkpoint; `0` when there has not been one.
    checkpoint_sequence: int

    @property
    def pending_commands(self) -> int:
        """Commands recorded since the last checkpoint — what a crash would lose."""
        return self.journal_sequence - self.checkpoint_sequence


@dataclass(frozen=True, slots=True)
class SavedProject:
    """The outcome of a save: when, where, and in which format."""

    project_id: str
    path: Path
    saved_at_ms: int
    format_version: int


@dataclass(frozen=True, slots=True)
class Checkpoint:
    """The outcome of a checkpoint: which revision, and where the journal is now."""

    project_id: str
    sequence: int
    revision: RevisionRef
    recorded_at_ms: int
    #: Commands dropped from the journal because this checkpoint baked them in.
    truncated: int


@dataclass(slots=True)
class _Entry:
    """The mutable half: what the workspace keeps, always under its lock."""

    project: Project
    journal: Journal
    autosave: AutosaveState
    path: Path | None = None
    session: ProjectSession | None = None
    manifest: ProjectManifest | None = None
    dirty: bool = False
    journal_sequence: int = 0
    checkpoint_sequence: int = 0
    #: One lock per project, not one per workspace: two windows editing two
    #: projects must not serialise on each other.
    lock: threading.RLock = field(default_factory=threading.RLock)

    def as_value(self) -> OpenProject:
        return OpenProject(
            project_id=str(self.project.project_id),
            name=self.project.name,
            project=self.project,
            path=self.path,
            dirty=self.dirty,
            autosave=self.autosave,
            journal_sequence=self.journal_sequence,
            checkpoint_sequence=self.checkpoint_sequence,
        )


class ProjectWorkspace:
    """The projects this session has open, and the guarantees around them.

    Args:
        bus: Where lifecycle events are published.
        data_dir: Root for journals; every project gets a directory beneath it.
        clock: Timestamps and autosave intervals come from here.
        archive_factory: Builds a `ProjectArchive` from a path. Injected so a
            test can serve an in-memory archive and never touch a disk.
        journal_factory: Opens the journal for one project. Injected likewise.
        supported_format_version: The newest `.nova` format this build reads.
        app_version: Recorded in every manifest a save writes.
        autosave_policy: When a checkpoint is owed.

    Every method returns a `Result`: refusing is an answer, not an exception,
    because "this project is already open" and "this file is not a project" are
    things a user is told, not crashes.
    """

    def __init__(
        self,
        bus: EventBus,
        *,
        data_dir: Path,
        clock: Clock | None = None,
        archive_factory: Any = ZipProjectArchive,
        journal_factory: Any = open_journal,
        supported_format_version: int = SUPPORTED_FORMAT_VERSION,
        app_version: str = __version__,
        autosave_policy: CheckpointPolicy | None = None,
    ) -> None:
        self._bus = bus
        self._data_dir = data_dir
        self._clock: Clock = clock or SystemClock()
        self._archive_factory = archive_factory
        self._journal_factory = journal_factory
        self._supported_format_version = supported_format_version
        self._app_version = app_version
        self._autosave_policy = autosave_policy or DEFAULT_AUTOSAVE
        self._open: dict[str, _Entry] = {}
        self._guard = threading.RLock()

    # -- asking ------------------------------------------------------------

    def open_projects(self) -> tuple[OpenProject, ...]:
        """Every project open in this session, in the order they were opened."""
        with self._guard:
            return tuple(entry.as_value() for entry in self._open.values())

    def now_ms(self) -> int:
        """The workspace's idea of now, which is the clock the autosave counts on.

        Routers read it from here rather than from a clock of their own so that
        "is a checkpoint due" means the same thing in the tick and in the summary.
        """
        return self._clock.now_ms()

    def get(self, project_id: str) -> OpenProject | None:
        """The open project with this id, or `None` when it is not open here."""
        with self._guard:
            entry = self._open.get(project_id)
            return entry.as_value() if entry is not None else None

    # -- lifecycle ---------------------------------------------------------

    def create(
        self,
        *,
        name: str,
        path: Path | None = None,
        author: str = "",
        description: str = "",
    ) -> Result[OpenProject]:
        """A new, empty project, open in memory.

        Args:
            name: What the user calls it; also the default file name on save.
            path: Optional file to attach straight away, so "new project" can be
                "new project here" in one call.
            author: Recorded in the project's metadata.
            description: Likewise.
        """
        now_ms = self._clock.now_ms()
        try:
            project = Project(
                project_id=new_entity_id(self._clock),
                name=name,
                metadata=ProjectMetadata(
                    author=author, description=description, created_ms=now_ms, modified_ms=now_ms
                ),
            )
        except Exception as error:  # an empty name is a 422, not a crash
            return err(refused(str(error)))
        return self._admit(project, path=path, dirty=True, topic="created")

    def open(self, path: Path) -> Result[OpenProject]:
        """Open a `.nova` file, refusing only what cannot be read at all.

        A damaged but readable project comes back with warnings (ADR-0015
        rule 3); a file written by a newer Nova Studio is refused whole.
        """
        # Checked here, before the archive is asked, because the archive's answer
        # to a missing file is "not a Nova Studio project" — true, and the wrong
        # thing to tell somebody who mistyped a path. It is a courtesy, not a
        # guarantee: a file can still vanish between this line and the open.
        if not path.exists():
            return err(no_such_file(path))
        session = self._new_session(path, manifest=None)
        opened = session.open()
        if opened.is_err():
            session.close()
            return err(opened.unwrap_err())
        value = opened.unwrap()
        return self._admit(
            value.project,
            path=path,
            dirty=False,
            topic="opened",
            manifest=value.manifest,
            warnings=value.warnings,
        )

    def close(self, project_id: str) -> Result[bool]:
        """Close a project and release its archive. Returns whether it was open.

        Unsaved work is *not* written first: a close that silently saved would
        overwrite the very file the user may be trying to abandon.
        """
        with self._guard:
            entry = self._open.pop(project_id, None)
        if entry is None:
            return ok(False)
        with entry.lock:
            if entry.session is not None:
                entry.session.close()
                entry.session = None
            self._close_journal(entry)
        self._publish("closed", project_id, name=entry.project.name, dirty=entry.dirty)
        return ok(True)

    def close_all(self) -> int:
        """Close every open project. Returns how many there were.

        Called when the service stops, because a process that exits holding an
        archive leaves a lock or a staged temporary file behind — and the next
        launch is the one that has to explain it.
        """
        with self._guard:
            project_ids = tuple(self._open)
        for project_id in project_ids:
            self.close(project_id)
        return len(project_ids)

    # -- editing -----------------------------------------------------------

    def store(
        self, project_id: str, project: Project, *, name: str = "edit"
    ) -> Result[OpenProject]:
        """Put an edited project back, and journal that it happened.

        The journalling is what makes this the durable path: the entry is
        fsynced *before* the caller is told the edit succeeded, so a process
        killed a millisecond later loses the edit and knows it, rather than
        believing in work that never reached the disk.
        """
        with self._entry_for(project_id) as entry:
            if entry is None:
                return err(not_open(project_id))
            now_ms = self._clock.now_ms()
            previous_project = entry.project
            previous_autosave = entry.autosave
            entry.project = project
            entry.dirty = True
            entry.autosave = entry.autosave.recorded(at_ms=now_ms)
            failure = self._append(entry, name, now_ms, {"name": project.name})
            if failure is not None:
                # The edit stands in memory; what failed is the guarantee, and
                # the caller is told so it can ask the user to save.
                entry.project = previous_project
                entry.autosave = previous_autosave
                entry.dirty = previous_project is not entry.project
                return err(failure)
            value = entry.as_value()
        self._publish("edited", project_id, name=project.name, pending=value.pending_commands)
        return ok(value)

    def audit(self, project_id: str) -> Result[ProjectAudit]:
        """What a user would want to know about the state of this project."""
        with self._entry_for(project_id) as entry:
            if entry is None:
                return err(not_open(project_id))
            if entry.session is None:
                return err(never_saved(project_id))
            return ok(entry.session.audit(entry.project))

    # -- saving ------------------------------------------------------------

    def save(self, project_id: str) -> Result[SavedProject]:
        """Write the project to the file it came from."""
        with self._entry_for(project_id) as entry:
            if entry is None:
                return err(not_open(project_id))
            if entry.path is None:
                return err(never_saved(project_id))
            return self._write(entry, entry.path)

    def save_as(self, project_id: str, path: Path) -> Result[SavedProject]:
        """Write the project to a new file, and make that its home.

        A "save as" is a new file, so it gets a new session — and the manifest
        travels with it, because "created" is when the user made the project,
        not when they copied it (ADR-0015 rule 2).
        """
        with self._entry_for(project_id) as entry:
            if entry is None:
                return err(not_open(project_id))
            return self._write(entry, path)

    def checkpoint(self, project_id: str, *, label: str = "") -> Result[Checkpoint]:
        """Take an autosave revision, and truncate the journal behind it.

        The order is the point: the checkpoint is journalled first, so a crash
        mid-checkpoint still records that one was attempted; then the revision is
        written and committed; then the journal is truncated, which is the one
        step that must not happen early.
        """
        with self._entry_for(project_id) as entry:
            if entry is None:
                return err(not_open(project_id))
            if entry.path is None:
                return err(never_saved(project_id))
            now_ms = self._clock.now_ms()
            failure = self._append(entry, CHECKPOINT_ENTRY, now_ms, {"label": label})
            if failure is not None:
                return err(failure)
            sequence = entry.journal_sequence
            if entry.session is None:
                entry.journal_sequence -= 1
                return err(never_saved(project_id))
            revision = entry.session.checkpoint(entry.project, label=label)
            if revision.is_err():
                entry.journal_sequence -= 1
                return err(revision.unwrap_err())
            # Minus one: the checkpoint's own journalled entry is the marker, not
            # one of the commands it made redundant.
            truncated = max(0, sequence - entry.checkpoint_sequence - 1)
            entry.checkpoint_sequence = sequence
            entry.autosave = entry.autosave.checkpointed(at_ms=now_ms)
            entry.journal.truncate_through(sequence)
            value = Checkpoint(
                project_id=project_id,
                sequence=sequence,
                revision=revision.unwrap(),
                recorded_at_ms=now_ms,
                truncated=truncated,
            )
        self._publish("checkpointed", project_id, sequence=sequence, label=label)
        return ok(value)

    def autosave(self, project_id: str) -> Result[Checkpoint | None]:
        """Take a checkpoint if one is owed, and say so either way.

        `None` is not a failure — it means "nothing was owed", which the caller
        answers by doing nothing. A tick that checkpointed unconditionally would
        rewrite the archive on every keypress.
        """
        with self._entry_for(project_id) as entry:
            if entry is None:
                return err(not_open(project_id))
            if entry.path is None or not entry.autosave.due(now_ms=self._clock.now_ms()):
                return ok(None)
        taken = self.checkpoint(project_id, label="autosave")
        if taken.is_err():
            return err(taken.unwrap_err())
        return ok(taken.unwrap())

    # -- recovery ----------------------------------------------------------

    def recovery(self, project_id: str) -> Result[RecoveryPlan]:
        """What to offer the user for this project's journal.

        Asked on startup, when a journal is found for a project that was open
        when the process died, and on demand by the recovery dialog.
        """
        with self._entry_for(project_id) as entry:
            if entry is None:
                return err(not_open(project_id))
            window = entry.journal.read_since(0)
            if window.is_err():
                return err(window.unwrap_err())
            return ok(plan_recovery(window.unwrap(), checkpoint_sequence=entry.checkpoint_sequence))

    # -- internals ---------------------------------------------------------

    @contextmanager
    def _entry_for(self, project_id: str) -> Iterator[_Entry | None]:
        """One project's entry, held under its lock for the duration."""
        with self._guard:
            entry = self._open.get(project_id)
        if entry is None:
            yield None
            return
        with entry.lock:
            yield entry

    def _new_session(self, path: Path, *, manifest: ProjectManifest | None) -> ProjectSession:
        archive: ProjectArchive = self._archive_factory(
            path, supported_format_version=self._supported_format_version
        )
        return ProjectSession(
            archive=archive,
            clock=self._clock,
            supported_format_version=self._supported_format_version,
            app_version=self._app_version,
            manifest=manifest,
        )

    def _admit(
        self,
        project: Project,
        *,
        path: Path | None,
        dirty: bool,
        topic: str,
        manifest: ProjectManifest | None = None,
        warnings: Sequence[str] = (),
    ) -> Result[OpenProject]:
        """Take ownership of a project: journal, session, entry."""
        project_id = str(project.project_id)
        with self._guard:
            if project_id in self._open:
                return err(already_open(project_id))
            journal: Journal = self._journal_factory(
                self._data_dir, project_id, started_ms=self._clock.now_ms()
            )
            entry = _Entry(
                project=project,
                journal=journal,
                autosave=AutosaveState(policy=self._autosave_policy),
                path=path,
                manifest=manifest,
                dirty=dirty,
                session=None if path is None else self._new_session(path, manifest=manifest),
            )
            self._open[project_id] = entry
            value = entry.as_value()
        self._publish(
            topic,
            project_id,
            name=project.name,
            path=str(path) if path is not None else None,
            warnings=list(warnings),
        )
        return ok(value)

    def _write(self, entry: _Entry, path: Path) -> Result[SavedProject]:
        """Save through the session, and remember where and when."""
        if entry.session is None:
            entry.session = self._new_session(path, manifest=entry.manifest)
        elif path != entry.path:
            # A different file: a new session on a new archive, carrying the
            # manifest so the project keeps its identity and its creation time.
            entry.session.close()
            entry.session = self._new_session(path, manifest=entry.manifest)
        result = entry.session.save(entry.project)
        if result.is_err():
            return err(result.unwrap_err())
        saved: ProjectManifest = result.unwrap()
        entry.manifest = saved
        entry.path = path
        entry.dirty = False
        self._publish(
            "saved",
            str(entry.project.project_id),
            path=str(path),
            modified_ms=saved.modified_ms,
        )
        return ok(
            SavedProject(
                project_id=str(entry.project.project_id),
                path=path,
                saved_at_ms=saved.modified_ms,
                format_version=saved.format_version,
            )
        )

    def _append(
        self, entry: _Entry, name: str, now_ms: int, payload: Mapping[str, object]
    ) -> NovaError | None:
        """Journal one entry. Returns the failure, or `None` when it landed."""
        entry.journal_sequence += 1
        result = entry.journal.append(
            JournalEntry(
                sequence=entry.journal_sequence,
                recorded_at_ms=now_ms,
                name=name,
                payload=payload,
            )
        )
        if result.is_err():
            entry.journal_sequence -= 1
            return journal_failed(result.unwrap_err().message)
        return None

    @staticmethod
    def _close_journal(entry: _Entry) -> None:
        """Release the journal, never letting it fail the close."""
        try:
            entry.journal.close()
        except Exception:
            return

    def _publish(self, event: str, project_id: str, **payload: object) -> None:
        """Announce a lifecycle change. A dead bus must not lose the user's save."""
        try:
            self._bus.publish(
                f"{_TOPIC_PREFIX}.{event}",
                {"project_id": project_id, **payload},
                source="api.projects",
            )
        except Exception:
            return


def already_open(project_id: str) -> NovaError:
    return NovaError(
        NS_PROJECT_ALREADY_OPEN,
        f"'{project_id}' is already open in this session",
        domain=ErrorDomain.PROJECT,
        severity=ErrorSeverity.WARNING,
        remedy="Close it first, or open it in a new window.",
    )


def never_saved(project_id: str) -> NovaError:
    return NovaError(
        NS_PROJECT_NEVER_SAVED,
        f"'{project_id}' has no file yet, so there is nothing to write to",
        domain=ErrorDomain.PROJECT,
        severity=ErrorSeverity.WARNING,
        remedy="Choose Save as and pick a location.",
    )


def no_such_file(path: Any) -> NovaError:
    return NovaError(
        NS_PROJECT_NO_SUCH_FILE,
        f"there is no file at {path}",
        domain=ErrorDomain.PROJECT,
        severity=ErrorSeverity.WARNING,
        remedy="Check the path, or open the project from a checkpoint.",
    )


def not_open(project_id: str) -> NovaError:
    return NovaError(
        NS_PROJECT_NOT_OPEN,
        f"'{project_id}' is not open in this session",
        domain=ErrorDomain.PROJECT,
        severity=ErrorSeverity.WARNING,
        remedy="Open the project first.",
    )


def journal_failed(cause: str) -> NovaError:
    return NovaError(
        NS_PROJECT_JOURNAL_FAILED,
        f"the edit was made but could not be journalled: {cause}",
        domain=ErrorDomain.PROJECT,
        severity=ErrorSeverity.ERROR,
        remedy="Save now; without a journal a crash cannot be recovered.",
        retryable=True,
    )


def refused(cause: str) -> NovaError:
    return NovaError(
        NS_PROJECT_REFUSED,
        cause,
        domain=ErrorDomain.PROJECT,
        severity=ErrorSeverity.WARNING,
    )
