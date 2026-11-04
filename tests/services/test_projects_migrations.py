"""Project migrations (`services/projects/migrations.py`).

A project file outlives the build that wrote it, so "the model gained a field"
has to be a non-event for everyone who saved last week. The rule under test is
the one `docs/architecture/project-file-format.md` §7 promises: **an older
project is migrated on open, in memory, by a chain of pure functions — and a
chain with a missing link is reported, never guessed at.**

The last two tests are the ones that matter to a user: a project saved before a
cue had an emoji opens with its captions intact, and a project from a format
this build has no road to is skipped with a warning rather than opened half-read.
"""

from __future__ import annotations

from typing import Any

import pytest

from nova_studio.domain.captions import CaptionDocument, CaptionSegment
from nova_studio.domain.persistence import (
    PROJECT_DOCUMENT,
    TIMELINE_DOCUMENT,
    ProjectManifest,
    RevisionRef,
    caption_document,
)
from nova_studio.domain.project import CaptionDocumentRef, Project
from nova_studio.services.projects import ProjectSession
from nova_studio.services.projects.migrations import (
    MIGRATION_FAILED,
    DocumentKind,
    migrated,
    migrations_between,
)

pytestmark = pytest.mark.unit

T0 = 1_700_000_000_000
APP_VERSION = "1.0.0"
#: The version this build writes.
CURRENT = 2


# -- helpers -----------------------------------------------------------------


def _cue(text: str = "hi", index: int = 0, **over: Any) -> CaptionSegment:
    return CaptionSegment(index=index, start_ms=0, end_ms=500, text=text, **over)


def _caption_wire(emoji: bool = False) -> dict[str, object]:
    """A caption document as a build of the given era wrote it."""
    document = CaptionDocument(segments=(_cue(), _cue("there", index=1)))
    wire: dict[str, object] = dict(document.to_wire())
    if not emoji:
        wire["segments"] = [
            {key: value for key, value in segment.items() if key != "emoji"}
            for segment in wire["segments"]  # type: ignore[union-attr]
        ]
    return wire


class MemoryArchive:
    """A `.nova` container that only has to answer reads."""

    def __init__(
        self,
        *,
        manifest: ProjectManifest | None = None,
        documents: dict[str, Any] | None = None,
    ) -> None:
        self.manifest = manifest or ProjectManifest(
            project_id="p1",
            format_version=1,
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

    def read_manifest(self) -> Any:
        from nova_studio.core.result import ok

        return ok(self.manifest)

    def read_document(self, name: str) -> Any:
        from nova_studio.core.result import ok
        from nova_studio.ports.persistence import PersistenceErrorCode

        if name in self.staged:
            return ok(self.staged[name])
        if name in self.documents:
            return ok(self.documents[name])
        from nova_studio.core import error_result
        from nova_studio.core.errors import ErrorDomain

        return error_result(
            PersistenceErrorCode.NO_SUCH_REVISION,
            f"{name} is not in this project",
            domain=ErrorDomain.STORAGE,
        )

    def read_blob(self, name: str) -> Any:
        from nova_studio.core.result import ok

        return ok(b"")

    def stage_document(self, name: str, document: Any) -> Any:
        self.staged[name] = document
        from nova_studio.core.result import ok

        return ok(None)

    def stage_blob(self, name: str, data: bytes) -> Any:
        from nova_studio.core.result import ok

        return ok(None)

    def revisions(self) -> Any:
        from nova_studio.core.result import ok

        return ok(tuple(self.revisions))

    def caption_document_ids(self) -> Any:
        from nova_studio.core.result import ok

        prefix, suffix = "captions/", ".json"
        ids = [
            name[len(prefix) : -len(suffix)]
            for name in (*self.documents, *self.staged)
            if name.startswith(prefix) and name.endswith(suffix)
        ]
        return ok(tuple(sorted(set(ids))))

    def commit(self, manifest: ProjectManifest) -> Any:
        from nova_studio.core.result import ok

        self.commits += 1
        self.documents.update(self.staged)
        self.staged.clear()
        self.manifest = manifest
        return ok(None)

    def discard(self) -> Any:
        from nova_studio.core.result import ok

        self.discards += 1
        self.staged.clear()
        return ok(None)

    def close(self) -> None:
        self.closed = True


class FrozenClock:
    def __init__(self, now_ms: int = T0) -> None:
        self._now_ms = now_ms
        self.monotonic_value = 0.0

    def now_ms(self) -> int:
        return self._now_ms

    def monotonic(self) -> float:
        return self.monotonic_value


def _project_with_captions() -> Project:
    from nova_studio.core.ident import EntityId
    from nova_studio.domain.timeline import Clip, Timeline, Track, TrackKind

    project = Project(
        project_id=EntityId("p1"),
        name="Demo",
        assets=(),
        timeline=Timeline.of(
            Track(
                track_id="v1",
                kind=TrackKind.VIDEO,
                clips=(Clip.of("c1", "a1", start_frame=0, source_frames=100),),
            )
        ),
    )
    return project.with_caption(
        CaptionDocumentRef(
            document_id="doc-1",
            document=CaptionDocument(segments=(_cue(),)),
        )
    )


# -- the chain ---------------------------------------------------------------


class TestTheChain:
    def test_one_step_from_the_version_before(self) -> None:
        steps = migrations_between(DocumentKind.CAPTIONS, 1, 2).unwrap()
        assert len(steps) == 1

    def test_a_step_names_what_it_does(self) -> None:
        step = migrations_between(DocumentKind.CAPTIONS, 1, 2).unwrap()[0]
        assert "emoji" in step.description

    def test_a_document_already_current_needs_nothing(self) -> None:
        assert migrations_between(DocumentKind.CAPTIONS, 2, 2).unwrap() == ()

    def test_a_gap_in_the_chain_is_reported(self) -> None:
        result = migrations_between(DocumentKind.CAPTIONS, 2, 4)
        assert result.is_err() is True

    def test_the_gap_says_which_link_is_missing(self) -> None:
        error = migrations_between(DocumentKind.CAPTIONS, 2, 4).unwrap_err()
        assert "v2 to v3" in error.message
        assert error.code == MIGRATION_FAILED

    def test_a_project_is_never_taken_backwards(self) -> None:
        result = migrations_between(DocumentKind.CAPTIONS, 2, 1)
        assert result.is_err() is True
        assert "backwards" in result.unwrap_err().message

    def test_a_kind_with_no_migrations_is_left_alone(self) -> None:
        assert migrations_between(DocumentKind.TIMELINE, 1, 1).unwrap() == ()


# -- the v1 to v2 step -------------------------------------------------------


class TestCuesGainAnEmoji:
    def test_every_cue_gains_an_empty_emoji(self) -> None:
        upgraded = migrated(DocumentKind.CAPTIONS, _caption_wire(), from_version=1, to_version=2)
        segments = upgraded.unwrap()["segments"]
        assert [segment["emoji"] for segment in segments] == ["", ""]  # type: ignore[index]

    def test_the_result_decodes(self) -> None:
        upgraded = migrated(
            DocumentKind.CAPTIONS, _caption_wire(), from_version=1, to_version=2
        ).unwrap()
        document = CaptionDocument.from_wire(upgraded)
        assert len(document.segments) == 2

    def test_a_v1_document_would_not_decode_without_it(self) -> None:
        with pytest.raises(Exception, match="fields must be exactly"):
            CaptionDocument.from_wire(_caption_wire())

    def test_what_was_there_is_still_there(self) -> None:
        before = _caption_wire()
        after = migrated(DocumentKind.CAPTIONS, before, from_version=1, to_version=2).unwrap()
        assert [segment["text"] for segment in after["segments"]] == ["hi", "there"]  # type: ignore[index]

    def test_an_emoji_already_there_is_kept(self) -> None:
        wire = CaptionDocument(segments=(_cue().with_emoji("☕"),)).to_wire()
        upgraded = migrated(DocumentKind.CAPTIONS, wire, from_version=1, to_version=2).unwrap()
        assert upgraded["segments"][0]["emoji"] == "☕"  # type: ignore[index]

    def test_a_document_with_no_segments_is_untouched(self) -> None:
        wire: dict[str, object] = {"version": 1, "segments": "not-a-list"}
        assert migrated(DocumentKind.CAPTIONS, wire, from_version=1, to_version=2).unwrap() == wire

    def test_a_current_document_is_returned_as_it_was(self) -> None:
        wire = _caption_wire(emoji=True)
        assert migrated(DocumentKind.CAPTIONS, wire, from_version=2, to_version=2).unwrap() is wire

    def test_the_original_is_never_written_to(self) -> None:
        """A migration is a function, not an edit."""
        wire = _caption_wire()
        migrated(DocumentKind.CAPTIONS, wire, from_version=1, to_version=2)
        assert all("emoji" not in segment for segment in wire["segments"])  # type: ignore[union-attr]


# -- opening an old project --------------------------------------------------


def _session_with(manifest_version: int, caption_wire: dict[str, object]) -> ProjectSession:
    project = _project_with_captions()
    documents = project.to_documents()
    entries: dict[str, Any] = {
        PROJECT_DOCUMENT: dict(documents.project),
        TIMELINE_DOCUMENT: dict(documents.timeline),
        caption_document("doc-1"): caption_wire,
    }
    return ProjectSession(
        archive=MemoryArchive(
            manifest=ProjectManifest(
                project_id="p1",
                format_version=manifest_version,
                app_version=APP_VERSION,
                created_ms=T0,
                modified_ms=T0,
            ),
            documents=entries,
        ),
        clock=FrozenClock(),
        supported_format_version=CURRENT,
        app_version=APP_VERSION,
    )


class TestAnOldProjectStillOpens:
    def test_a_project_saved_before_cues_had_emoji_keeps_its_captions(self) -> None:
        opened = _session_with(1, _caption_wire()).open().unwrap()
        assert opened.project.caption("doc-1") is not None

    def test_the_captions_are_the_ones_that_were_saved(self) -> None:
        opened = _session_with(1, _caption_wire()).open().unwrap()
        document = opened.project.caption("doc-1")
        assert document is not None
        assert document.segments[0].text == "hi"

    def test_the_migrated_cues_have_no_emoji(self) -> None:
        """The default is exactly what those projects had: none."""
        opened = _session_with(1, _caption_wire()).open().unwrap()
        document = opened.project.caption("doc-1")
        assert document is not None
        assert document.segments[0].emoji == ""

    def test_opening_an_old_project_says_nothing_is_wrong(self) -> None:
        opened = _session_with(1, _caption_wire()).open().unwrap()
        assert not any("doc-1" in warning for warning in opened.warnings)

    def test_a_project_from_a_format_with_no_road_here_is_skipped(self) -> None:
        """Half a migration is a corrupted project, so the document is named
        and left out rather than opened half-read."""
        session = _session_with(1, _caption_wire())
        session._supported_format_version = 4  # no v2 → v4 chain exists
        result = session.open()
        assert result.is_ok() is True
        assert any("doc-1" in warning for warning in result.unwrap().warnings)
