"""The project session (`services/projects/session.py`).

The rule this file exists to defend is ADR-0015 rule 3: **a damaged project
still opens.** A moved clip, a corrupt caption document, a dangling effect
binding — each is a warning on a project the user gets back, not a reason to
refuse. Only two things refuse: a file from a newer Nova Studio, and a file that
is not a project at all.

Everything here runs against an in-memory archive and a frozen clock, so opening
and saving a project is tested without a filesystem and without time passing.
"""

from __future__ import annotations

from typing import Any

import pytest

from nova_studio.core import NovaError, error_result, ok
from nova_studio.core.errors import ErrorDomain
from nova_studio.core.ident import EntityId
from nova_studio.domain.captions import CaptionDocument, CaptionSegment
from nova_studio.domain.media import AssetKind, MediaAsset
from nova_studio.domain.persistence import (
    PROJECT_DOCUMENT,
    TIMELINE_DOCUMENT,
    ProjectManifest,
    RevisionRef,
    caption_document,
)
from nova_studio.domain.project import CaptionDocumentRef, Project
from nova_studio.domain.timeline import Clip, Timeline, Track, TrackKind
from nova_studio.ports.persistence import PersistenceErrorCode
from nova_studio.services.projects import (
    NS_PROJECT_MISSING_DOCUMENT,
    NS_PROJECT_SAVE_FAILED,
    NS_PROJECT_UNSUPPORTED_VERSION,
    OpenedProject,
    ProjectAudit,
    ProjectSession,
)

pytestmark = pytest.mark.unit

T0 = 1_700_000_000_000
FORMAT_VERSION = 1
APP_VERSION = "1.0.0"


# -- doubles ------------------------------------------------------------------


class FrozenClock:
    """A clock that only moves when told to."""

    def __init__(self, now_ms: int = T0) -> None:
        self._now_ms = now_ms
        self.monotonic_value = 0.0

    def now_ms(self) -> int:
        return self._now_ms

    def monotonic(self) -> float:
        return self.monotonic_value

    def advance(self, seconds: float) -> None:
        self._now_ms += int(seconds * 1000)
        self.monotonic_value += seconds


class MemoryArchive:
    """A `.nova` container with a committed layer and a staged layer."""

    def __init__(
        self,
        *,
        manifest: ProjectManifest | None = None,
        documents: dict[str, Any] | None = None,
        fail_on_commit_with: PersistenceErrorCode | None = None,
    ) -> None:
        self.manifest = manifest or ProjectManifest(
            project_id="p1",
            format_version=FORMAT_VERSION,
            app_version=APP_VERSION,
            created_ms=T0,
            modified_ms=T0,
        )
        self.documents: dict[str, Any] = dict(documents or {})
        self.staged: dict[str, Any] = {}
        self.revisions: list[RevisionRef] = []
        self.commits = 0
        self.discards = 0
        self.closed = False
        self._fail_with = fail_on_commit_with

    # -- reads ------------------------------------------------------------

    def read_manifest(self) -> Any:
        return ok(self.manifest)

    def read_document(self, name: str) -> Any:
        if name in self.staged:
            return ok(self.staged[name])
        if name in self.documents:
            return ok(self.documents[name])
        return error_result(
            PersistenceErrorCode.NO_SUCH_REVISION,
            f"{name} is not in this project",
            domain=ErrorDomain.STORAGE,
        )

    def read_blob(self, name: str) -> Any:
        return ok(b"")

    def revisions(self) -> Any:
        return ok(tuple(self.revisions))

    def caption_document_ids(self) -> Any:
        prefix, suffix = "captions/", ".json"
        ids = [
            name[len(prefix) : -len(suffix)]
            for name in sorted({*self.documents, *self.staged})
            if name.startswith(prefix) and name.endswith(suffix)
        ]
        return ok(tuple(ids))

    # -- staged writes ----------------------------------------------------

    def write_manifest(self, manifest: ProjectManifest) -> Any:
        self.staged["__manifest__"] = manifest
        return ok(None)

    def write_document(self, name: str, document: Any) -> Any:
        self.staged[name] = dict(document)
        return ok(None)

    def write_blob(self, name: str, data: bytes) -> Any:
        return ok(None)

    def checkpoint(self, *, recorded_at_ms: int, label: str = "") -> Any:
        revision = RevisionRef(
            sequence=len(self.revisions) + 1, recorded_at_ms=recorded_at_ms, label=label
        )
        self.revisions.append(revision)
        return ok(revision)

    def restore(self, sequence: int) -> Any:
        return ok({})

    # -- lifecycle --------------------------------------------------------

    def commit(self) -> Any:
        if self._fail_with is not None:
            return error_result(self._fail_with, "the disk is full", domain=ErrorDomain.STORAGE)
        self.commits += 1
        manifest = self.staged.pop("__manifest__", None)
        if manifest is not None:
            self.manifest = manifest
        self.documents.update(self.staged)
        self.staged.clear()
        return ok(None)

    def discard(self) -> None:
        self.discards += 1
        self.staged.clear()

    def close(self) -> None:
        self.closed = True


# -- builders -----------------------------------------------------------------


def _asset(asset_id: str = "a1", path: str = "/media/clip.mp4") -> MediaAsset:
    return MediaAsset(asset_id=EntityId(asset_id), path=path, kind=AssetKind.VIDEO)


def _project(**over: Any) -> Project:
    defaults: dict[str, Any] = {
        "project_id": EntityId("p1"),
        "name": "Demo",
        "assets": (_asset(),),
        "timeline": Timeline.of(
            Track(
                track_id="v1",
                kind=TrackKind.VIDEO,
                clips=(Clip.of("c1", "a1", start_frame=0, source_frames=100),),
            )
        ),
    }
    return Project(**{**defaults, **over})


def _documents(project: Project) -> dict[str, Any]:
    documents = project.to_documents()
    entries: dict[str, Any] = {
        PROJECT_DOCUMENT: dict(documents.project),
        TIMELINE_DOCUMENT: dict(documents.timeline),
    }
    for document_id, document in documents.captions:
        entries[caption_document(document_id)] = dict(document)
    return entries


def _session(
    project: Project | None = None,
    *,
    clock: FrozenClock | None = None,
    manifest: ProjectManifest | None = None,
    archive: MemoryArchive | None = None,
) -> ProjectSession:
    documents = _documents(project) if project is not None else {}
    return ProjectSession(
        archive=archive or MemoryArchive(manifest=manifest, documents=documents),
        clock=clock or FrozenClock(),
        supported_format_version=FORMAT_VERSION,
        app_version=APP_VERSION,
    )


class TestOpen:
    def test_a_project_opens(self) -> None:
        result = _session(_project()).open()
        assert result.is_ok() is True

    def test_the_opened_project_is_the_one_that_was_saved(self) -> None:
        project = _project(name="Launch teaser")
        opened = _session(project).open().unwrap()
        assert opened.project.name == "Launch teaser"

    def test_the_manifest_comes_back_with_it(self) -> None:
        assert _session(_project()).open().unwrap().manifest.project_id == "p1"

    def test_a_clean_project_has_no_warnings(self) -> None:
        opened = _session(_project()).open().unwrap()
        assert opened.warnings == ()
        assert opened.is_clean is True

    def test_a_project_with_missing_media_still_opens(self) -> None:
        """ADR-0015 rule 3: missing media is a state, not an exception."""
        project = _project(assets=(_asset().mark_missing(),))
        opened = _session(project).open().unwrap()
        assert opened.project.asset_count == 1

    def test_a_dangling_clip_is_reported_and_not_refused(self) -> None:
        project = _project(
            timeline=Timeline.of(
                Track(track_id="v1", clips=(Clip.of("c1", "ghost", source_frames=100),))
            )
        )
        opened = _session(project).open().unwrap()
        assert opened.is_clean is False
        assert any("ghost" in warning for warning in opened.warnings)

    def test_a_newer_format_is_refused_whole(self) -> None:
        """ADR-0015 rule 5: never a partial parse."""
        manifest = ProjectManifest(
            project_id="p1",
            format_version=FORMAT_VERSION + 1,
            app_version="2.0.0",
            created_ms=T0,
            modified_ms=T0,
        )
        result = _session(_project(), manifest=manifest).open()
        assert result.unwrap_err().code == NS_PROJECT_UNSUPPORTED_VERSION

    def test_the_refusal_names_both_versions(self) -> None:
        manifest = ProjectManifest(
            project_id="p1",
            format_version=3,
            app_version="2.0.0",
            created_ms=T0,
            modified_ms=T0,
        )
        error = _session(_project(), manifest=manifest).open().unwrap_err()
        assert error.details["format_version"] == 3
        assert error.details["supported_format_version"] == FORMAT_VERSION

    def test_the_refusal_says_to_update(self) -> None:
        manifest = ProjectManifest(
            project_id="p1", format_version=2, app_version="2.0.0", created_ms=T0, modified_ms=T0
        )
        error = _session(_project(), manifest=manifest).open().unwrap_err()
        assert error.remedy
        assert error.retryable is False

    def test_a_missing_timeline_is_refused(self) -> None:
        documents = _documents(_project())
        del documents[TIMELINE_DOCUMENT]
        archive = MemoryArchive(documents=documents)
        result = _session(archive=archive).open()
        assert result.unwrap_err().code == NS_PROJECT_MISSING_DOCUMENT

    def test_a_missing_project_document_is_refused(self) -> None:
        documents = _documents(_project())
        del documents[PROJECT_DOCUMENT]
        archive = MemoryArchive(documents=documents)
        result = _session(archive=archive).open()
        assert result.unwrap_err().code == NS_PROJECT_MISSING_DOCUMENT

    def test_a_document_with_unknown_fields_is_refused(self) -> None:
        documents = _documents(_project())
        documents[PROJECT_DOCUMENT] = dict(documents[PROJECT_DOCUMENT], invented=1)
        archive = MemoryArchive(documents=documents)
        result = _session(archive=archive).open()
        assert result.unwrap_err().code == "NS-PROJECT-4003"

    def test_the_unreadable_failure_carries_the_cause(self) -> None:
        documents = _documents(_project())
        documents[PROJECT_DOCUMENT] = dict(documents[PROJECT_DOCUMENT], invented=1)
        error = _session(archive=MemoryArchive(documents=documents)).open().unwrap_err()
        assert error.cause

    def test_a_caption_document_is_read_from_its_own_entry(self) -> None:
        project = _project().with_caption(
            CaptionDocumentRef(
                document_id="doc-1",
                document=CaptionDocument(
                    segments=(CaptionSegment(index=0, start_ms=0, end_ms=500, text="hi"),)
                ),
            )
        )
        opened = _session(project).open().unwrap()
        assert opened.project.caption("doc-1") is not None

    def test_a_damaged_caption_is_a_warning_not_a_refusal(self) -> None:
        """One corrupt caption is not worth a timeline (ADR-0015 rule 7)."""
        documents = _documents(_project())
        documents[caption_document("doc-9")] = {"segments": "not-a-list"}
        result = _session(archive=MemoryArchive(documents=documents)).open()
        assert result.is_ok() is True
        assert any("doc-9" in warning for warning in result.unwrap().warnings)


class TestSave:
    def test_a_save_writes_the_project_document(self) -> None:
        archive = MemoryArchive()
        _session(archive=archive).save(_project()).unwrap()
        assert PROJECT_DOCUMENT in archive.documents

    def test_a_save_writes_the_timeline_to_its_own_entry(self) -> None:
        archive = MemoryArchive()
        _session(archive=archive).save(_project()).unwrap()
        assert TIMELINE_DOCUMENT in archive.documents

    def test_a_save_writes_each_caption_to_its_own_entry(self) -> None:
        archive = MemoryArchive()
        project = _project().with_caption(
            CaptionDocumentRef(
                document_id="doc-1",
                document=CaptionDocument(
                    segments=(CaptionSegment(index=0, start_ms=0, end_ms=500, text="hi"),)
                ),
            )
        )
        _session(archive=archive).save(project).unwrap()
        assert caption_document("doc-1") in archive.documents

    def test_a_save_is_committed(self) -> None:
        archive = MemoryArchive()
        _session(archive=archive).save(_project()).unwrap()
        assert archive.commits == 1

    def test_a_saved_project_round_trips(self) -> None:
        archive = MemoryArchive()
        session = _session(archive=archive)
        session.save(_project(name="Round trip")).unwrap()
        assert session.open().unwrap().project.name == "Round trip"

    def test_saving_stamps_the_manifest(self) -> None:
        clock = FrozenClock(T0 + 60_000)
        archive = MemoryArchive()
        manifest = _session(archive=archive, clock=clock).save(_project()).unwrap()
        assert manifest.modified_ms == T0 + 60_000

    def test_saving_keeps_the_creation_time(self) -> None:
        """'Created' is when the user made it, not when this session started."""
        session = _session(_project(), clock=FrozenClock(T0 + 60_000))
        session.open()
        manifest = session.save(_project()).unwrap()
        assert manifest.created_ms == T0
        assert manifest.modified_ms == T0 + 60_000

    def test_a_project_saved_for_the_first_time_gets_a_manifest(self) -> None:
        manifest = _session().save(_project()).unwrap()
        assert manifest.project_id == "p1"
        assert manifest.app_version == APP_VERSION
        assert manifest.created_ms == T0

    def test_a_failed_commit_leaves_the_previous_file_and_stages_nothing(self) -> None:
        archive = MemoryArchive(fail_on_commit_with=PersistenceErrorCode.UNWRITABLE)
        result = _session(archive=archive).save(_project())
        assert result.unwrap_err().code == NS_PROJECT_SAVE_FAILED
        assert archive.documents == {}
        assert archive.discards == 1

    def test_a_failed_save_is_retryable(self) -> None:
        """The old file is intact, so trying again is the right advice."""
        archive = MemoryArchive(fail_on_commit_with=PersistenceErrorCode.IO_FAILED)
        error = _session(archive=archive).save(_project()).unwrap_err()
        assert error.retryable is True

    def test_a_failed_save_names_the_underlying_cause(self) -> None:
        archive = MemoryArchive(fail_on_commit_with=PersistenceErrorCode.UNWRITABLE)
        error = _session(archive=archive).save(_project()).unwrap_err()
        assert error.cause

    def test_saving_does_not_mutate_the_project(self) -> None:
        project = _project()
        _session().save(project)
        assert project.name == "Demo"

    def test_the_second_save_moves_the_timestamp_forward(self) -> None:
        clock = FrozenClock(T0)
        archive = MemoryArchive()
        session = _session(archive=archive, clock=clock)
        session.save(_project()).unwrap()
        assert archive.manifest.created_ms == T0
        clock.advance(30)
        manifest = session.save(_project()).unwrap()
        assert manifest.modified_ms == T0 + 30_000

    def test_saving_backwards_in_time_is_reported_not_raised(self) -> None:
        """A clock that jumps back is a bug, but it must not corrupt a save."""
        clock = FrozenClock(T0 + 60_000)
        session = _session(clock=clock)
        session.save(_project()).unwrap()
        clock._now_ms = T0
        result = session.save(_project())
        assert result.is_err() is True


class TestCheckpoint:
    def test_a_checkpoint_is_numbered(self) -> None:
        archive = MemoryArchive()
        revision = _session(archive=archive).checkpoint(_project(), label="before relink").unwrap()
        assert revision.sequence == 1
        assert revision.label == "before relink"

    def test_a_checkpoint_is_committed(self) -> None:
        """A checkpoint that is not durable is no use to a process that dies."""
        archive = MemoryArchive()
        _session(archive=archive).checkpoint(_project()).unwrap()
        assert archive.commits == 1

    def test_a_checkpoint_stages_the_timeline(self) -> None:
        archive = MemoryArchive()
        _session(archive=archive).checkpoint(_project()).unwrap()
        assert TIMELINE_DOCUMENT in archive.documents

    def test_checkpoints_accumulate(self) -> None:
        archive = MemoryArchive()
        session = _session(archive=archive)
        session.checkpoint(_project()).unwrap()
        second = session.checkpoint(_project()).unwrap()
        assert second.sequence == 2


class TestAudit:
    def test_a_clean_project_audits_clean(self) -> None:
        audit = _session().audit(_project())
        assert audit.is_clean is True
        assert audit.summary() == ()

    def test_a_problem_is_reported_as_a_sentence(self) -> None:
        project = _project(
            timeline=Timeline.of(
                Track(track_id="v1", clips=(Clip.of("c1", "ghost", source_frames=100),))
            )
        )
        audit = _session().audit(project)
        assert "ghost" in audit.problem

    def test_missing_media_is_listed(self) -> None:
        audit = _session().audit(_project(assets=(_asset().mark_missing(),)))
        assert len(audit.missing_assets) == 1

    def test_unused_media_is_listed(self) -> None:
        audit = _session().audit(_project(assets=(_asset(), _asset("a2", "/other.mp4"))))
        assert [str(a.asset_id) for a in audit.unused_assets] == ["a2"]

    def test_the_summary_orders_problems_before_housekeeping(self) -> None:
        project = _project(
            assets=(_asset("a1").mark_missing(), _asset("a2", "/other.mp4")),
            timeline=Timeline.of(
                Track(track_id="v1", clips=(Clip.of("c1", "a1", source_frames=100),))
            ),
        )
        summary = _session().audit(project).summary()
        assert len(summary) == 2
        assert "not where this project expects it" in summary[0]

    def test_the_audit_carries_the_shape_of_the_edit(self) -> None:
        audit = _session().audit(_project())
        assert (audit.clip_count, audit.duration_frames) == (1, 100)

    def test_an_audit_does_not_touch_the_archive(self) -> None:
        archive = MemoryArchive()
        _session(archive=archive).audit(_project())
        assert archive.commits == 0
        assert archive.staged == {}


class TestSessionHousekeeping:
    def test_closing_releases_the_archive(self) -> None:
        archive = MemoryArchive()
        _session(archive=archive).close()
        assert archive.closed is True

    def test_closing_does_not_commit_staged_work(self) -> None:
        archive = MemoryArchive()
        session = _session(archive=archive)
        session.save(_project())
        session.close()
        assert archive.commits == 1

    def test_opening_twice_reads_the_same_project(self) -> None:
        session = _session(_project())
        assert session.open().unwrap().project == session.open().unwrap().project

    def test_the_opened_project_is_a_value(self) -> None:
        opened: OpenedProject = _session(_project()).open().unwrap()
        assert isinstance(opened, OpenedProject)

    def test_an_audit_is_a_value(self) -> None:
        assert isinstance(_session().audit(_project()), ProjectAudit)

    def test_the_failure_is_a_structured_error(self) -> None:
        manifest = ProjectManifest(
            project_id="p1", format_version=9, app_version="9", created_ms=T0, modified_ms=T0
        )
        error: NovaError = _session(_project(), manifest=manifest).open().unwrap_err()
        assert error.domain is ErrorDomain.PROJECT
