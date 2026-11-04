"""L3 — the project session: open, save, checkpoint, audit.

This is the service a user is actually talking to when they double-click a
``.nova`` file.  The domain decides *what a project is*; the archive decides
*how the bytes are stored*; this decides **what happens when a human opens one**
— and the answer is shaped by one rule that every other decision here follows:

    **A damaged project still opens.**

A clip naming an asset that moved, a caption document whose bytes are corrupt,
a project that fails validation: each is reported as a warning and none of them
stops the open (ADR-0015 rule 3).  An editor that refuses to open a broken
project is an editor that loses work.  Only two things refuse: a file written by
a *newer* Nova Studio — which is refused whole rather than half-parsed (rule 5)
— and a file that is not a project at all.

The second rule is that **the clock is a port**.  ``modified_ms`` is read from
``ports.clock`` and never from ``datetime.now()``, so a save is reproducible to
the millisecond and a test can open, edit and save a project without touching a
filesystem or waiting for time to pass.

Deliberately not here: **the container format** (that is
[`project-file-format.md`](../../docs/architecture/project-file-format.md) and
``infra/persistence``), **the undo stack** (``core/commands.py``, driven by
``services/timeline``), and **autosave and crash recovery** — those are their
own modules beside this one, because they answer different questions.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Final

from nova_studio.core.errors import ErrorDomain, NovaError, NovaInvariantError
from nova_studio.core.result import Result, failed, ok
from nova_studio.domain.captions import CaptionDocument
from nova_studio.domain.persistence import (
    PROJECT_DOCUMENT,
    TIMELINE_DOCUMENT,
    ProjectManifest,
    RevisionRef,
    caption_document,
)
from nova_studio.domain.project import Project, ProjectDocuments, validate_project
from nova_studio.services.projects.migrations import DocumentKind, migrated

if TYPE_CHECKING:
    from collections.abc import Mapping

    from nova_studio.domain.media import MediaAsset
    from nova_studio.ports.clock import Clock
    from nova_studio.ports.persistence import ProjectArchive

__all__ = [
    "NS_PROJECT_MISSING_DOCUMENT",
    "NS_PROJECT_SAVE_FAILED",
    "NS_PROJECT_UNREADABLE",
    "NS_PROJECT_UNSUPPORTED_VERSION",
    "OpenedProject",
    "ProjectAudit",
    "ProjectSession",
]

#: The file was written by a newer Nova Studio.  Refused whole (ADR-0015 rule 5).
NS_PROJECT_UNSUPPORTED_VERSION: Final[str] = "NS-PROJECT-4001"
#: A required document is missing or is not the document it claims to be.
NS_PROJECT_MISSING_DOCUMENT: Final[str] = "NS-PROJECT-4002"
#: The project rebuilt into something the domain will not accept — unknown
#: fields, a caption id that would escape the archive.
NS_PROJECT_UNREADABLE: Final[str] = "NS-PROJECT-4003"
#: The save did not become durable.  The previous file is still intact.
NS_PROJECT_SAVE_FAILED: Final[str] = "NS-PROJECT-4004"


def _unsupported_version(manifest: ProjectManifest, supported: int) -> NovaError:
    return NovaError(
        code=NS_PROJECT_UNSUPPORTED_VERSION,
        message=(
            f"this project was written by a newer Nova Studio "
            f"(format {manifest.format_version}, this build reads {supported})"
        ),
        domain=ErrorDomain.PROJECT,
        details={
            "format_version": manifest.format_version,
            "supported_format_version": supported,
        },
        remedy="Update Nova Studio to open this project.",
        retryable=False,
    )


def _missing_document(name: str, cause: str) -> NovaError:
    return NovaError(
        code=NS_PROJECT_MISSING_DOCUMENT,
        message=f"'{name}' is missing or unreadable in this project",
        domain=ErrorDomain.PROJECT,
        details={"document": name},
        remedy="Restore the project from a backup or a checkpoint.",
        cause=cause,
        retryable=False,
    )


def _unreadable(cause: str) -> NovaError:
    return NovaError(
        code=NS_PROJECT_UNREADABLE,
        message="this project could not be read",
        domain=ErrorDomain.PROJECT,
        remedy="Restore the project from a backup or a checkpoint.",
        cause=cause,
        retryable=False,
    )


def _save_failed(cause: str) -> NovaError:
    return NovaError(
        code=NS_PROJECT_SAVE_FAILED,
        message="the project could not be saved",
        domain=ErrorDomain.PROJECT,
        remedy="Check that the file is writable and the disk is not full, then try again.",
        cause=cause,
        retryable=True,
    )


@dataclass(frozen=True, slots=True, kw_only=True)
class OpenedProject:
    """What :meth:`ProjectSession.open` hands back.

    ``project`` is always a usable project.  ``warnings`` are the things a user
    has to know but is not blocked by: media that moved, a caption document that
    could not be read, a validation problem.  The UI shows them; it does not
    gate on them.
    """

    manifest: ProjectManifest
    project: Project
    warnings: tuple[str, ...] = ()

    @property
    def is_clean(self) -> bool:
        """Whether the project opened with nothing to report."""
        return not self.warnings


@dataclass(frozen=True, slots=True, kw_only=True)
class ProjectAudit:
    """What is wrong with a project, as sentences rather than as a boolean.

    A single boolean ("invalid") is useless to a user staring at a timeline with
    a red clip in it.  This is the list the relink panel and the project
    inspector render.
    """

    problem: str = ""
    missing_assets: tuple[MediaAsset, ...] = ()
    unused_assets: tuple[MediaAsset, ...] = ()
    clip_count: int = 0
    duration_frames: int = 0

    @property
    def is_clean(self) -> bool:
        """Whether there is nothing at all to report."""
        return not self.summary()

    def summary(self) -> tuple[str, ...]:
        """Every problem, as one sentence each, in the order to fix them."""
        lines: list[str] = []
        if self.problem:
            lines.append(self.problem)
        lines.extend(
            f"media '{asset.display_name}' is not where this project expects it"
            for asset in self.missing_assets
        )
        lines.extend(
            f"media '{asset.display_name}' is in the bin but no clip uses it"
            for asset in self.unused_assets
        )
        return tuple(lines)


class ProjectSession:
    """One open ``.nova`` file.

    Holds the archive it reads and writes and the clock it timestamps with, and
    nothing else: no project state lives here beyond the manifest, because the
    session is a *door*, not a copy of the house.
    """

    def __init__(
        self,
        *,
        archive: ProjectArchive,
        clock: Clock,
        supported_format_version: int,
        app_version: str,
        manifest: ProjectManifest | None = None,
    ) -> None:
        self._archive = archive
        self._clock = clock
        self._supported_format_version = supported_format_version
        self._app_version = app_version
        self._manifest = manifest

    # -- opening -----------------------------------------------------------

    def open(self) -> Result[OpenedProject]:
        """Read the project, refusing only what cannot be read at all."""
        manifest_result = self._archive.read_manifest()
        if manifest_result.is_err():
            return failed(manifest_result.unwrap_err())
        manifest = manifest_result.unwrap()

        if manifest.is_from_a_newer_format(self._supported_format_version):
            return failed(_unsupported_version(manifest, self._supported_format_version))
        self._manifest = manifest

        project_document = self._read_document(PROJECT_DOCUMENT)
        if project_document.is_err():
            return failed(project_document.unwrap_err())
        timeline_document = self._read_document(TIMELINE_DOCUMENT)
        if timeline_document.is_err():
            return failed(timeline_document.unwrap_err())

        warnings: list[str] = []
        captions = self._read_captions(warnings, manifest.format_version)

        try:
            project = Project.from_documents(
                ProjectDocuments(
                    project=project_document.unwrap(),
                    timeline=timeline_document.unwrap(),
                    captions=captions,
                )
            )
        except NovaInvariantError as error:
            return failed(_unreadable(str(error)))

        problem = validate_project(project)
        if problem:
            warnings.insert(0, problem)
        return ok(OpenedProject(manifest=manifest, project=project, warnings=tuple(warnings)))

    def _read_document(self, name: str) -> Result[Mapping[str, object]]:
        result = self._archive.read_document(name)
        if result.is_err():
            error = result.unwrap_err()
            return failed(_missing_document(name, error.message))
        return ok(result.unwrap())

    def _read_captions(
        self, warnings: list[str], format_version: int
    ) -> tuple[tuple[str, Mapping[str, object]], ...]:
        """Read every caption document, reporting the ones that would not read.

        Captions are separate entries precisely so that one bad document cannot
        take the edit with it (ADR-0015 rule 7): a document that is missing,
        unreadable or malformed is skipped and named, and the project opens
        without it.  Each document is decoded here rather than in
        :meth:`Project.from_documents` so that the failure can be attributed to
        the document that caused it.

        A document written by an **older** build is migrated first
        (`docs/architecture/project-file-format.md` §7), which is the whole
        point of the format version: a cue gaining a field is not a reason to
        throw away a project's captions.
        """
        ids = self._archive.caption_document_ids()
        if ids.is_err():
            warnings.append(
                f"the caption documents could not be listed: {ids.unwrap_err().message}"
            )
            return ()
        captions: list[tuple[str, Mapping[str, object]]] = []
        for document_id in ids.unwrap():
            result = self._archive.read_document(caption_document(document_id))
            if result.is_err():
                warnings.append(
                    f"caption document '{document_id}' could not be read and was skipped"
                )
                continue
            document = result.unwrap()
            upgraded = migrated(
                DocumentKind.CAPTIONS,
                document,
                from_version=format_version,
                to_version=self._supported_format_version,
            )
            if upgraded.is_err():
                warnings.append(
                    f"caption document '{document_id}' is from a format this build "
                    f"cannot read and was skipped: {upgraded.unwrap_err().message}"
                )
                continue
            document = upgraded.unwrap()
            try:
                CaptionDocument.from_wire(document)
            except NovaInvariantError as error:
                warnings.append(
                    f"caption document '{document_id}' is damaged and was skipped: {error}"
                )
                continue
            captions.append((document_id, document))
        return tuple(captions)

    # -- saving ------------------------------------------------------------

    def save(self, project: Project) -> Result[ProjectManifest]:
        """Write the project and make it durable.

        Returns the manifest as it now stands, so a caller can show "saved at"
        without re-reading the file.  A failed save is durable-safe: the archive
        stages everything and replaces the file in one atomic step, so the
        previous version is still there (ADR-0015 rule 4).
        """
        now_ms = self._clock.now_ms()
        try:
            manifest = self._stamp(project, now_ms)
        except NovaInvariantError as error:
            # The only way this can happen is a clock that moved backwards,
            # which is a bug in the caller's clock rather than in the project.
            return failed(_save_failed(str(error)))

        for name, document in self._documents(project):
            written = self._archive.write_document(name, document)
            if written.is_err():
                self._archive.discard()
                return failed(_save_failed(written.unwrap_err().message))

        staged = self._archive.write_manifest(manifest)
        if staged.is_err():
            self._archive.discard()
            return failed(_save_failed(staged.unwrap_err().message))

        committed = self._archive.commit()
        if committed.is_err():
            self._archive.discard()
            return failed(_save_failed(committed.unwrap_err().message))

        self._manifest = manifest
        return ok(manifest)

    def checkpoint(self, project: Project, *, label: str = "") -> Result[RevisionRef]:
        """Store the current timeline as a numbered revision and commit it.

        Autosave and the recovery flow both come through here.  It commits
        rather than leaving the revision staged, because a checkpoint that is not
        durable is no use to a process that dies.
        """
        written = self._archive.write_document(TIMELINE_DOCUMENT, project.timeline.to_wire())
        if written.is_err():
            self._archive.discard()
            return failed(_save_failed(written.unwrap_err().message))
        revision = self._archive.checkpoint(recorded_at_ms=self._clock.now_ms(), label=label)
        if revision.is_err():
            self._archive.discard()
            return failed(_save_failed(revision.unwrap_err().message))
        committed = self._archive.commit()
        if committed.is_err():
            self._archive.discard()
            return failed(_save_failed(committed.unwrap_err().message))
        return ok(revision.unwrap())

    def _stamp(self, project: Project, now_ms: int) -> ProjectManifest:
        """The manifest as of ``now_ms``.

        A project saved for the first time gets a manifest built from the
        project's own id; one that was opened keeps its creation time, because
        "created" is when the user made it, not when this session started.
        """
        if self._manifest is None:
            return ProjectManifest(
                project_id=str(project.project_id),
                format_version=self._supported_format_version,
                app_version=self._app_version,
                created_ms=now_ms,
                modified_ms=now_ms,
            )
        return self._manifest.touched(now_ms)

    @staticmethod
    def _documents(project: Project) -> tuple[tuple[str, Mapping[str, object]], ...]:
        documents = project.to_documents()
        entries: list[tuple[str, Mapping[str, object]]] = [
            (PROJECT_DOCUMENT, documents.project),
            (TIMELINE_DOCUMENT, documents.timeline),
        ]
        entries.extend(
            (caption_document(document_id), document)
            for document_id, document in documents.captions
        )
        return tuple(entries)

    # -- asking ------------------------------------------------------------

    def audit(self, project: Project) -> ProjectAudit:
        """What a user would want to know about the state of this project."""
        return ProjectAudit(
            problem=validate_project(project),
            missing_assets=project.missing_assets(),
            unused_assets=project.unused_assets(),
            clip_count=project.clip_count,
            duration_frames=project.duration_frames,
        )

    def close(self) -> None:
        """Release the archive.  Staged work is *not* committed by this."""
        self._archive.close()
