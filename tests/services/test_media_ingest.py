"""Import (`services/media/ingest.py`).

A user selects forty files; three are a README, a truncated download and a path
that no longer exists. The rule under test is the one that decides whether the
editor is usable afterwards: **a batch never fails as a batch.** Thirty-seven
assets come back with three named failures, and the status bar can say so.
"""

from __future__ import annotations

from typing import Any

import pytest

from nova_studio.core import error_result, ok
from nova_studio.core.errors import ErrorDomain, NovaError
from nova_studio.core.ident import EntityId
from nova_studio.domain.media import (
    AssetKind,
    AudioStreamInfo,
    MediaAsset,
    MediaInfo,
    VideoStreamInfo,
)
from nova_studio.ports.media import MediaErrorCode
from nova_studio.services.media.ingest import IngestFailure, IngestReport, MediaIngestor

pytestmark = pytest.mark.unit

T0 = 1_700_000_000_000


class FakeProber:
    """A prober that answers from a dictionary and fails on everything else."""

    def __init__(
        self,
        *,
        results: dict[str, MediaInfo] | None = None,
        failing: dict[str, str] | None = None,
    ) -> None:
        self._results = results or {}
        self._failing = failing or {}
        self.calls: list[str] = []

    def probe(self, path: str) -> Any:
        self.calls.append(path)
        if path in self._failing:
            return error_result(
                MediaErrorCode(self._failing[path]),
                f"{path} could not be read",
                domain=ErrorDomain.MEDIA,
            )
        if path in self._results:
            return ok(self._results[path])
        return error_result(
            MediaErrorCode.UNREADABLE, f"{path} is not here", domain=ErrorDomain.MEDIA
        )


class CountingIds:
    """Deterministic, readable ids: ``asset-1``, ``asset-2`` …"""

    def __init__(self) -> None:
        self.issued = 0

    def new_entity_id(self) -> EntityId:
        self.issued += 1
        return EntityId(f"asset-{self.issued}")


def _video(**over: Any) -> MediaInfo:
    """A video with sound: the ordinary case, and the one with nothing to say."""
    audio = AudioStreamInfo(codec_name="aac", sample_rate=48_000, channels=2)
    stream = VideoStreamInfo(
        codec_name="h264",
        width=1920,
        height=1080,
        timebase=_timebase(30),
        frame_count=300,
    )
    defaults: dict[str, Any] = {
        "kind": AssetKind.VIDEO,
        "duration_seconds": 10.0,
        "video": (stream,),
        "audio": (audio,),
    }
    defaults.update(over)
    return MediaInfo(**defaults)


def _audio(**over: Any) -> MediaInfo:
    stream = AudioStreamInfo(codec_name="aac", sample_rate=48_000, channels=2)
    defaults: dict[str, Any] = {
        "kind": AssetKind.AUDIO,
        "duration_seconds": 10.0,
        "audio": (stream,),
    }
    defaults.update(over)
    return MediaInfo(**defaults)


def _timebase(rate: int) -> Any:
    from nova_studio.core.temporal import Timebase

    return Timebase(num=rate, den=1)


def _ingestor(
    *,
    results: dict[str, MediaInfo] | None = None,
    failing: dict[str, str] | None = None,
) -> tuple[MediaIngestor, FakeProber, CountingIds]:
    prober = FakeProber(results=results, failing=failing)
    ids = CountingIds()
    return MediaIngestor(prober=prober, ids=ids), prober, ids


class TestABatchNeverFailsAsABatch:
    def test_one_bad_file_does_not_stop_the_rest(self) -> None:
        ingestor, _, _ = _ingestor(
            results={"/a.mp4": _video(), "/c.mp4": _video()},
            failing={"/b.mp4": MediaErrorCode.UNREADABLE},
        )
        report = ingestor.ingest(("/a.mp4", "/b.mp4", "/c.mp4"))
        assert len(report.assets) == 2

    def test_the_failure_is_reported_next_to_the_assets(self) -> None:
        ingestor, _, _ = _ingestor(
            results={"/a.mp4": _video()}, failing={"/b.txt": MediaErrorCode.UNREADABLE}
        )
        report = ingestor.ingest(("/a.mp4", "/b.txt"))
        assert len(report.failures) == 1
        assert report.failures[0].path == "/b.txt"

    def test_the_failure_keeps_the_probes_code(self) -> None:
        """The frontend maps codes to local messages; it needs the code."""
        ingestor, _, _ = _ingestor(failing={"/x.mov": MediaErrorCode.UNSUPPORTED})
        report = ingestor.ingest(("/x.mov",))
        assert report.failures[0].code == MediaErrorCode.UNSUPPORTED

    def test_the_failure_is_a_structured_error(self) -> None:
        ingestor, _, _ = _ingestor(failing={"/x.mov": MediaErrorCode.UNSUPPORTED})
        assert isinstance(ingestor.ingest(("/x.mov",)).failures[0].error, NovaError)

    def test_every_path_is_accounted_for(self) -> None:
        ingestor, _, _ = _ingestor(
            results={"/a.mp4": _video()}, failing={"/b.mp4": MediaErrorCode.UNREADABLE}
        )
        report = ingestor.ingest(("/a.mp4", "/b.mp4"))
        assert len(report.assets) + len(report.failures) == 2

    def test_an_empty_selection_imports_nothing_and_complains_about_nothing(self) -> None:
        report = _ingestor()[0].ingest(())
        assert report.assets == ()
        assert report.failures == ()
        assert report.is_complete is True

    def test_the_order_the_user_selected_is_kept(self) -> None:
        ingestor, _, _ = _ingestor(
            results={"/b.mp4": _video(), "/a.mp4": _video(), "/c.mp4": _video()}
        )
        report = ingestor.ingest(("/c.mp4", "/a.mp4", "/b.mp4"))
        assert tuple(asset.path for asset in report.assets) == ("/c.mp4", "/a.mp4", "/b.mp4")


class TestProbing:
    def test_every_file_is_probed_exactly_once(self) -> None:
        ingestor, prober, _ = _ingestor(results={"/a.mp4": _video()})
        ingestor.ingest(("/a.mp4",))
        assert prober.calls == ["/a.mp4"]

    def test_a_failed_file_is_still_probed(self) -> None:
        """There is no cheaper way to know a file is broken."""
        ingestor, prober, _ = _ingestor(failing={"/x.mp4": MediaErrorCode.UNREADABLE})
        ingestor.ingest(("/x.mp4",))
        assert prober.calls == ["/x.mp4"]

    def test_the_probe_decides_what_the_file_is(self) -> None:
        """Never the suffix: a .mov carrying only audio is an audio asset."""
        ingestor, _, _ = _ingestor(results={"/interview.mov": _audio()})
        report = ingestor.ingest(("/interview.mov",))
        assert report.assets[0].kind is AssetKind.AUDIO

    def test_the_probe_summary_travels_with_the_asset(self) -> None:
        ingestor, _, _ = _ingestor(results={"/a.mp4": _video()})
        assert ingestor.ingest(("/a.mp4",)).assets[0].is_probed is True

    def test_each_asset_gets_its_own_id(self) -> None:
        ingestor, _, ids = _ingestor(results={"/a.mp4": _video(), "/b.mp4": _video()})
        ingestor.ingest(("/a.mp4", "/b.mp4"))
        assert ids.issued == 2

    def test_no_id_is_minted_for_a_file_that_failed(self) -> None:
        ingestor, _, ids = _ingestor(failing={"/x.mp4": MediaErrorCode.UNREADABLE})
        ingestor.ingest(("/x.mp4",))
        assert ids.issued == 0


class TestDuplicates:
    def test_the_same_path_twice_in_one_selection_is_imported_once(self) -> None:
        ingestor, _, _ = _ingestor(results={"/a.mp4": _video()})
        report = ingestor.ingest(("/a.mp4", "/a.mp4"))
        assert len(report.assets) == 1
        assert report.duplicates == ("/a.mp4",)

    def test_a_duplicate_is_not_probed_twice(self) -> None:
        ingestor, prober, _ = _ingestor(results={"/a.mp4": _video()})
        ingestor.ingest(("/a.mp4", "/a.mp4"))
        assert prober.calls == ["/a.mp4"]

    def test_a_path_already_in_the_project_is_skipped(self) -> None:
        existing = (MediaAsset(asset_id=EntityId("a1"), path="/a.mp4"),)
        ingestor, _, _ = _ingestor(results={"/a.mp4": _video(), "/b.mp4": _video()})
        report = ingestor.ingest(("/a.mp4", "/b.mp4"), existing=existing)
        assert tuple(asset.path for asset in report.assets) == ("/b.mp4",)
        assert report.duplicates == ("/a.mp4",)

    def test_written_two_ways_one_path_is_still_one_file(self) -> None:
        """/media/./a.mp4 and /media/a.mp4 are the same file."""
        ingestor, _, _ = _ingestor(results={"/media/a.mp4": _video()})
        report = ingestor.ingest(("/media/a.mp4", "/media/./a.mp4"))
        assert len(report.assets) == 1

    def test_case_alone_does_not_make_two_files(self) -> None:
        """Windows-first: CLIP.MOV and clip.mov are one file."""
        ingestor, _, _ = _ingestor(results={"/clip.MOV": _video()})
        report = ingestor.ingest(("/clip.MOV", "/clip.mov"))
        assert len(report.assets) == 1

    def test_a_duplicate_is_not_a_failure(self) -> None:
        """Nothing went wrong; the file is simply already here."""
        ingestor, _, _ = _ingestor(results={"/a.mp4": _video()})
        report = ingestor.ingest(("/a.mp4", "/a.mp4"))
        assert report.failures == ()
        assert report.succeeded is True

    def test_an_empty_path_is_refused_without_probing(self) -> None:
        ingestor, prober, _ = _ingestor(results={"/a.mp4": _video()})
        report = ingestor.ingest(("",))
        assert report.failures[0].code == MediaErrorCode.UNREADABLE
        assert prober.calls == []


class TestWarnings:
    def test_a_clean_video_import_has_nothing_to_say(self) -> None:
        ingestor, _, _ = _ingestor(results={"/a.mp4": _video()})
        assert ingestor.ingest(("/a.mp4",)).entries[0].warnings == ()

    def test_a_file_with_no_usable_stream_still_imports(self) -> None:
        """The panel shows it greyed with a reason; dropping it silently is worse."""
        unknown = MediaInfo(kind=AssetKind.UNKNOWN, duration_seconds=1.0)
        ingestor, _, _ = _ingestor(results={"/readme.txt": unknown})
        entry = ingestor.ingest(("/readme.txt",)).entries[0]
        assert len(entry.warnings) == 1
        assert "no video or audio stream" in entry.warnings[0]

    def test_a_video_without_audio_says_so(self) -> None:
        ingestor, _, _ = _ingestor(results={"/silent.mp4": _video(audio=())})
        entry = ingestor.ingest(("/silent.mp4",)).entries[0]
        assert any("no audio track" in warning for warning in entry.warnings)

    def test_a_file_that_reports_no_duration_says_so(self) -> None:
        ingestor, _, _ = _ingestor(results={"/broken.mp4": _video(duration_seconds=0.0)})
        entry = ingestor.ingest(("/broken.mp4",)).entries[0]
        assert any("no duration" in warning for warning in entry.warnings)

    def test_warnings_can_be_read_back_by_path(self) -> None:
        ingestor, _, _ = _ingestor(results={"/silent.mp4": _video(audio=())})
        report = ingestor.ingest(("/silent.mp4",))
        assert report.warnings_for("/silent.mp4") == ("this video has no audio track",)

    def test_an_unknown_path_has_no_warnings(self) -> None:
        assert _ingestor()[0].ingest(()).warnings_for("/nope.mp4") == ()


class TestTheReport:
    def test_the_assets_are_there_for_the_caller_that_adds_them(self) -> None:
        ingestor, _, _ = _ingestor(results={"/a.mp4": _video()})
        report = ingestor.ingest(("/a.mp4",))
        assert isinstance(report.assets[0], MediaAsset)

    def test_a_complete_import_says_so(self) -> None:
        ingestor, _, _ = _ingestor(results={"/a.mp4": _video()})
        assert ingestor.ingest(("/a.mp4",)).is_complete is True

    def test_an_import_with_a_failure_is_not_complete(self) -> None:
        ingestor, _, _ = _ingestor(failing={"/x.mp4": MediaErrorCode.UNREADABLE})
        assert ingestor.ingest(("/x.mp4",)).is_complete is False

    def test_a_failed_import_imported_nothing(self) -> None:
        ingestor, _, _ = _ingestor(failing={"/x.mp4": MediaErrorCode.UNREADABLE})
        assert ingestor.ingest(("/x.mp4",)).succeeded is False

    def test_the_summary_counts_one_file_as_singular(self) -> None:
        ingestor, _, _ = _ingestor(results={"/a.mp4": _video()})
        assert ingestor.ingest(("/a.mp4",)).summary() == "1 file imported"

    def test_the_summary_counts_everything_it_should(self) -> None:
        ingestor, _, _ = _ingestor(
            results={"/a.mp4": _video(), "/b.mp4": _video(), "/c.mp4": _video()},
            failing={"/d.mp4": MediaErrorCode.UNREADABLE, "/e.mp4": MediaErrorCode.UNREADABLE},
        )
        report = ingestor.ingest(("/a.mp4", "/b.mp4", "/c.mp4", "/d.mp4", "/e.mp4", "/a.mp4"))
        assert (
            report.summary() == "3 files imported, 1 duplicate skipped, 2 files could not be read"
        )

    def test_the_summary_never_repeats_a_noun_it_does_not_need(self) -> None:
        ingestor, _, _ = _ingestor(results={"/a.mp4": _video()})
        assert "duplicate" not in ingestor.ingest(("/a.mp4",)).summary()

    def test_the_failure_reports_its_path(self) -> None:
        ingestor, _, _ = _ingestor(failing={"/x.mp4": MediaErrorCode.UNREADABLE})
        failure: IngestFailure = ingestor.ingest(("/x.mp4",)).failures[0]
        assert failure.path == "/x.mp4"

    def test_the_report_is_a_value(self) -> None:
        assert isinstance(_ingestor()[0].ingest(()), IngestReport)

    def test_importing_twice_gives_two_independent_reports(self) -> None:
        ingestor, _, _ = _ingestor(results={"/a.mp4": _video()})
        first = ingestor.ingest(("/a.mp4",))
        second = ingestor.ingest(("/a.mp4",))
        assert first.assets[0] != second.assets[0]
