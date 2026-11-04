"""`infra/persistence` — the adapters against the ports that declared them.

Two promises are pinned here, and neither is visible from inside the package.

The first is **conformance**: each adapter satisfies the protocol it was written
for, checked with `isinstance` on the `runtime_checkable` port. That sounds
circular until you remember what it catches — a method renamed in one place and
not the other, a signature that drifted, a capability the port promises and the
adapter quietly stopped providing.

The second is **substitutability, for real**: `services/projects/session.py` was
tested against in-memory fakes. Here it is handed the actual `ZipProjectArchive`
and asked to open, save and checkpoint a project on a real filesystem. A
project that round-trips through the real container and the real service — with
no fake in the middle — is the only proof that the seam is where we said it was.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import pytest

from nova_studio.core.ident import EntityId
from nova_studio.domain.captions import CaptionDocument, CaptionLayer, CaptionSegment
from nova_studio.domain.media import AssetKind, MediaAsset
from nova_studio.domain.persistence import (
    PROJECT_DOCUMENT,
    TIMELINE_DOCUMENT,
    ProjectManifest,
    caption_document,
)
from nova_studio.domain.project import CaptionDocumentRef, Project
from nova_studio.domain.timeline import Clip, Timeline, Track, TrackKind
from nova_studio.infra.persistence import (
    SUPPORTED_FORMAT_VERSION,
    PersistenceUnitOfWork,
    ZipProjectArchive,
    open_cache_index,
    open_journal,
)
from nova_studio.ports.persistence import CacheIndex, Journal, ProjectArchive, UnitOfWork
from nova_studio.services.projects import ProjectSession

if TYPE_CHECKING:
    from pathlib import Path

pytestmark = pytest.mark.unit

T0 = 1_700_000_000_000
PROJECT_ID = "p1"


class FrozenClock:
    """A clock that only moves when told to."""

    def __init__(self, now_ms: int = T0) -> None:
        self._now_ms = now_ms

    def now_ms(self) -> int:
        return self._now_ms

    def advance(self, ms: int) -> None:
        self._now_ms += ms


# -- protocol conformance ----------------------------------------------------


class TestConformance:
    def test_the_archive_is_a_project_archive(self, tmp_path: Path) -> None:
        assert isinstance(ZipProjectArchive(tmp_path / "a.nova"), ProjectArchive)

    def test_the_journal_is_a_journal(self, tmp_path: Path) -> None:
        assert isinstance(open_journal(tmp_path, PROJECT_ID, started_ms=T0), Journal)

    def test_the_cache_is_a_cache_index(self, tmp_path: Path) -> None:
        assert isinstance(open_cache_index(tmp_path / "cache.sqlite3"), CacheIndex)

    def test_the_unit_of_work_is_a_unit_of_work(self, tmp_path: Path) -> None:
        archive = ZipProjectArchive(tmp_path / "a.nova")
        assert isinstance(PersistenceUnitOfWork(archive=archive), UnitOfWork)

    def test_an_archive_is_not_a_journal(self, tmp_path: Path) -> None:
        assert not isinstance(ZipProjectArchive(tmp_path / "a.nova"), Journal)

    def test_the_version_the_archive_writes_is_the_version_migrations_end_at(
        self, tmp_path: Path
    ) -> None:
        """Two modules state the current format version; a test is the third opinion.

        `infra/persistence` does not import `services` — the outer ring does not
        depend on the inner one — so nothing but this test can notice the day the
        migration chain and the adapter disagree about what "current" means.
        """
        from nova_studio.services.projects.migrations import MIGRATIONS

        latest = max(
            (migration.to_version for migration in MIGRATIONS),
            default=SUPPORTED_FORMAT_VERSION,
        )
        assert latest == SUPPORTED_FORMAT_VERSION


# -- the session, on the real container --------------------------------------


def _project(**over: Any) -> Project:
    defaults: dict[str, Any] = {
        "project_id": EntityId(PROJECT_ID),
        "name": "Launch teaser",
        "assets": (
            MediaAsset(
                asset_id=EntityId("a1"),
                kind=AssetKind.VIDEO,
                path="/media/clip_001.mp4",
            ),
        ),
        "timeline": Timeline.of(
            Track(
                track_id="v1",
                kind=TrackKind.VIDEO,
                clips=(Clip.of("c1", "a1", start_frame=0, source_frames=100),),
            )
        ),
    }
    return Project(**{**defaults, **over})


def _captions() -> CaptionDocument:
    return CaptionDocument(
        layers=(CaptionLayer.primary("en"),),
        segments=(CaptionSegment(index=0, start_ms=0, end_ms=2_000, text="hello"),),
    ).reindexed()


def _write(archive: ZipProjectArchive, project: Project, *, at_ms: int = T0) -> None:
    """Stage a whole project the way a save does."""
    documents = project.to_documents()
    archive.write_manifest(
        ProjectManifest(
            project_id=str(project.project_id),
            format_version=2,
            app_version="1.0.0",
            created_ms=at_ms,
            modified_ms=at_ms,
        )
    )
    archive.write_document(PROJECT_DOCUMENT, documents.project)
    archive.write_document(TIMELINE_DOCUMENT, documents.timeline)
    for document_id, document in documents.captions:
        archive.write_document(caption_document(document_id), document)


def _session(archive: ProjectArchive, *, supported: int = 2) -> ProjectSession:
    return ProjectSession(
        archive=archive,
        clock=FrozenClock(),  # type: ignore[arg-type]
        supported_format_version=supported,
        app_version="1.0.0",
    )


class TestTheSessionOnARealContainer:
    def test_a_saved_project_opens(self, tmp_path: Path) -> None:
        path = tmp_path / "launch.nova"
        archive = ZipProjectArchive(path)
        _write(archive, _project())
        archive.commit()
        opened = _session(ZipProjectArchive(path)).open().unwrap()
        assert opened.project.name == "Launch teaser"

    def test_the_timeline_comes_back(self, tmp_path: Path) -> None:
        path = tmp_path / "launch.nova"
        archive = ZipProjectArchive(path)
        _write(archive, _project())
        archive.commit()
        opened = _session(ZipProjectArchive(path)).open().unwrap()
        assert opened.project.timeline.clip_count == 1

    def test_the_captions_come_back(self, tmp_path: Path) -> None:
        path = tmp_path / "launch.nova"
        archive = ZipProjectArchive(path)
        project = _project(captions=(CaptionDocumentRef(document_id="main", document=_captions()),))
        _write(archive, project)
        archive.commit()
        opened = _session(ZipProjectArchive(path)).open().unwrap()
        assert tuple(ref.document_id for ref in opened.project.captions) == ("main",)

    def test_a_project_with_nothing_wrong_opens_cleanly(self, tmp_path: Path) -> None:
        path = tmp_path / "launch.nova"
        archive = ZipProjectArchive(path)
        _write(archive, _project())
        archive.commit()
        assert _session(ZipProjectArchive(path)).open().unwrap().is_clean

    def test_a_damaged_project_still_opens(self, tmp_path: Path) -> None:
        """ADR-0015 rule 3, now with a real file behind it."""
        path = tmp_path / "launch.nova"
        archive = ZipProjectArchive(path)
        _write(archive, _project())
        archive.commit()
        broken = ZipProjectArchive(path)
        broken.write_document(caption_document("main"), {"segments": "not a list"})
        broken.commit()
        opened = _session(ZipProjectArchive(path)).open().unwrap()
        assert opened.project.name == "Launch teaser"

    def test_a_project_from_the_future_is_refused(self, tmp_path: Path) -> None:
        path = tmp_path / "launch.nova"
        archive = ZipProjectArchive(path)
        _write(archive, _project())
        archive.commit()
        result = _session(ZipProjectArchive(path), supported=1).open()
        assert result.is_err()

    def test_a_file_that_is_not_a_project_is_refused(self, tmp_path: Path) -> None:
        path = tmp_path / "launch.nova"
        path.write_bytes(b"a holiday photo, really")
        assert _session(ZipProjectArchive(path)).open().is_err()

    def test_a_save_is_durable(self, tmp_path: Path) -> None:
        path = tmp_path / "launch.nova"
        archive = ZipProjectArchive(path)
        _write(archive, _project())
        archive.commit()
        session = _session(ZipProjectArchive(path))
        session.save(_project(name="renamed"))
        reopened = _session(ZipProjectArchive(path)).open().unwrap()
        assert reopened.project.name == "renamed"

    def test_a_checkpoint_can_be_restored(self, tmp_path: Path) -> None:
        """A revision restores the edit, which is the part that lives in the timeline."""
        before = _project(
            name="before",
            timeline=Timeline.of(
                Track(
                    track_id="v1",
                    kind=TrackKind.VIDEO,
                    clips=(Clip.of("c1", "a1", start_frame=0, source_frames=100),),
                )
            ),
        )
        after = _project(
            name="after",
            timeline=Timeline.of(
                Track(
                    track_id="v1",
                    kind=TrackKind.VIDEO,
                    clips=(
                        Clip.of("c1", "a1", start_frame=0, source_frames=100),
                        Clip.of("c2", "a1", start_frame=100, source_frames=100),
                    ),
                )
            ),
        )
        path = tmp_path / "launch.nova"
        archive = ZipProjectArchive(path)
        _write(archive, before)
        archive.commit()
        session = _session(ZipProjectArchive(path))
        session.checkpoint(before)
        session.save(after)
        assert _session(ZipProjectArchive(path)).open().unwrap().project.timeline.clip_count == 2

        restoring = ZipProjectArchive(path)
        assert restoring.restore(1).is_ok()
        restoring.commit()
        opened = _session(ZipProjectArchive(path)).open().unwrap()
        assert opened.project.timeline.clip_count == 1

    def test_the_journal_sits_outside_the_project(self, tmp_path: Path) -> None:
        """A shared project must not carry the author's unsaved work."""
        path = tmp_path / "launch.nova"
        archive = ZipProjectArchive(path)
        _write(archive, _project())
        archive.commit()
        journal = open_journal(tmp_path, PROJECT_ID, started_ms=T0)
        journal.append(
            __import__("nova_studio.domain.persistence", fromlist=["JournalEntry"]).JournalEntry(
                sequence=1, recorded_at_ms=T0, name="MoveClip"
            )
        )
        journal.close()
        assert path.parent / "autosave" != path.parent
        assert (tmp_path / "autosave" / PROJECT_ID).is_dir()
