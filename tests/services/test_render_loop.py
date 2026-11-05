"""The render loop (`services/render/loop.py`).

The loop is the seam §7.2 is arranged around: **preview and export use the same
code path.** This module is where that claim is tested, by driving the loop into
a fake sink and checking what came out the other end.

What is being pinned is the difference between a process and a function. A
function returns a frame; a render produces a file, and it can partly fail. So
the loop reports three counts — written, empty, and *wrong* — and the tests
here are mostly about which of those a given situation lands in:

* **An empty frame is normal.** A project has frames before and after its
  clips; they render, and they are counted separately, because an export
  measured only by its frame count would report a two-hour timeline as a
  two-hour render when a third of it was nothing.
* **A gap is not a failure.** An offline asset means a layer is missing; the
  frame is still written, and the caller decides whether the export tolerates
  it. That is the whole of ADR-0015 rule 3, at the point where it costs
  something.
* **A cancelled or failed render stops between frames, never in one.** The sink
  is aborted, so no half-written file is left behind, which is worth more than
  the frames that would have been written.

And one performance invariant, because it is the reason the pool exists and the
only way to catch it is end to end: **thirty frames of one clip cost one seek**,
not thirty. A loop that planned or decoded out of order would still produce
correct pictures and take thirty times as long, which is exactly the bug a
correctness-only test suite never finds.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import numpy as np
import pytest

from nova_studio.core.errors import NovaError
from nova_studio.core.ident import EntityId
from nova_studio.core.result import err, ok
from nova_studio.core.temporal import Timebase
from nova_studio.domain.export import RenderStats
from nova_studio.domain.project import FrameSize, Project, ProjectSettings
from nova_studio.domain.timeline import Clip, Timeline, Track, TrackKind
from nova_studio.infra.imaging import OpenCVImageOps
from nova_studio.services.render.loop import render_frames, render_preview_frame
from nova_studio.services.render.pool import FrameSourcePool
from tests.media.fake_decoder import FakeClip, FakeDecoder

if TYPE_CHECKING:
    from nova_studio.domain.media import FrameBuffer

pytestmark = pytest.mark.unit

WIDTH, HEIGHT = 8, 6
OPS = OpenCVImageOps()


class FakeSink:
    """A `FrameSink` that keeps what it was given and can fail on cue."""

    def __init__(
        self,
        *,
        fail_at: int | None = None,
        finish_error: NovaError | None = None,
    ) -> None:
        self.frames: list[FrameBuffer] = []
        self.fail_at = fail_at
        self.finish_error = finish_error
        self.finished = False
        self.aborted = False

    def write(self, frame: FrameBuffer) -> Any:
        if self.fail_at is not None and len(self.frames) >= self.fail_at:
            return err(NovaError("NS-RENDER-4003", "the encoder rejected this frame"))
        self.frames.append(frame)
        return ok(None)

    def finish(self) -> Any:
        if self.finish_error is not None:
            return err(self.finish_error)
        self.finished = True
        return ok(
            RenderStats(
                frames_written=len(self.frames),
                bytes_written=len(self.frames) * WIDTH * HEIGHT * 3,
                elapsed_ms=10,
            )
        )

    def abort(self) -> None:
        self.aborted = True


def _project(*clips: Clip, frame_count: int = 0) -> Project:
    """A project holding the given clips on one video track."""
    return Project(
        project_id=EntityId("p1"),
        name="Demo",
        settings=ProjectSettings(frame_size=FrameSize(width=WIDTH, height=HEIGHT)),
        timeline=Timeline.of(
            Track(track_id="v1", kind=TrackKind.VIDEO, clips=clips),
            timebase=Timebase(num=30, den=1),
        ),
    )


def _clip(clip_id: str = "c1", *, asset_id: str = "a1", start: int = 0, length: int = 30) -> Clip:
    return Clip.of(clip_id, asset_id, start_frame=start, source_frames=length)


def _pool(decoder: FakeDecoder, *assets: str) -> FrameSourcePool:
    def resolve(asset_id: str, source: str) -> str | None:
        del source
        return f"{asset_id}.mp4" if asset_id in assets else None

    return FrameSourcePool(decoder, resolve)


def _grey(frame: FrameBuffer) -> int:
    return int(frame.pixels[0, 0, 0])


class TestRenderingARange:
    def test_every_frame_reaches_the_sink(self) -> None:
        decoder = FakeDecoder({"a1.mp4": FakeClip(frame_count=30)})
        sink = FakeSink()
        with _pool(decoder, "a1") as pool:
            outcome = render_frames(_project(_clip()), range(10), pool=pool, ops=OPS, sink=sink)
        assert outcome.ok is True
        assert outcome.written == 10
        assert len(sink.frames) == 10
        assert sink.finished is True

    def test_frame_n_carries_frame_n(self) -> None:
        """The picture that comes out is the picture the plan asked for."""
        decoder = FakeDecoder({"a1.mp4": FakeClip(frame_count=30)})
        sink = FakeSink()
        with _pool(decoder, "a1") as pool:
            render_frames(_project(_clip()), range(5), pool=pool, ops=OPS, sink=sink)
        assert [_grey(frame) for frame in sink.frames] == [0, 1, 2, 3, 4]

    def test_the_sink_counts_are_reported(self) -> None:
        decoder = FakeDecoder({"a1.mp4": FakeClip(frame_count=30)})
        sink = FakeSink()
        with _pool(decoder, "a1") as pool:
            outcome = render_frames(_project(_clip()), range(4), pool=pool, ops=OPS, sink=sink)
        assert outcome.stats is not None
        assert outcome.stats.frames_written == 4

    def test_the_same_frames_twice_are_the_same_bytes(self) -> None:
        """ADR-0002 rule 1, at the point where it is most easily broken."""
        decoder = FakeDecoder({"a1.mp4": FakeClip(frame_count=30)})
        first, second = FakeSink(), FakeSink()
        with _pool(decoder, "a1") as pool:
            render_frames(_project(_clip()), range(3), pool=pool, ops=OPS, sink=first)
            pool.clear_cache()
            render_frames(_project(_clip()), range(3), pool=pool, ops=OPS, sink=second)
        assert all(
            np.array_equal(a.pixels, b.pixels)
            for a, b in zip(first.frames, second.frames, strict=True)
        )

    def test_a_sequential_render_costs_one_seek_not_one_a_frame(self) -> None:
        """The reason the pool exists, checked end to end (ADR-0016: budgets)."""
        decoder = FakeDecoder({"a1.mp4": FakeClip(frame_count=60)})
        with _pool(decoder, "a1") as pool:
            render_frames(_project(_clip()), range(30), pool=pool, ops=OPS, sink=FakeSink())
        assert decoder.total_seeks == 1


class TestEmptyFrames:
    def test_a_frame_with_nothing_on_it_is_written_but_counted(self) -> None:
        """A timeline has frames before and after its clips; they still render."""
        decoder = FakeDecoder({"a1.mp4": FakeClip(frame_count=30)})
        sink = FakeSink()
        project = _project(_clip(start=10, length=5))
        with _pool(decoder, "a1") as pool:
            outcome = render_frames(project, range(20), pool=pool, ops=OPS, sink=sink)
        assert outcome.written == 20
        assert outcome.empty == 15
        assert sink.frames[0].pixels.max() == 0


class TestGaps:
    def test_an_offline_asset_is_a_gap_not_a_failure(self) -> None:
        """The frame is still rendered; the caller decides what a gap means."""
        sink = FakeSink()
        with _pool(FakeDecoder()) as pool:  # nothing resolves
            outcome = render_frames(_project(_clip()), range(3), pool=pool, ops=OPS, sink=sink)
        assert outcome.ok is True
        assert outcome.written == 3
        assert outcome.gap_frames == 3
        assert outcome.missing == ("a1",)
        assert sink.finished is True

    def test_an_offline_asset_is_reported_once_however_many_frames_it_cost(self) -> None:
        """A clip that is missing for five thousand frames is one sentence."""
        with _pool(FakeDecoder()) as pool:
            outcome = render_frames(
                _project(_clip()), range(5), pool=pool, ops=OPS, sink=FakeSink()
            )
        assert outcome.missing == ("a1",)
        assert outcome.gap_frames == 5

    def test_one_offline_asset_does_not_stop_another(self) -> None:
        """Two clips, one of them missing: the frame is half a frame, not none."""
        decoder = FakeDecoder({"a1.mp4": FakeClip(frame_count=30)})
        project = _project(_clip("c1", asset_id="a1"), _clip("c2", asset_id="a9"))
        sink = FakeSink()
        with _pool(decoder, "a1") as pool:
            outcome = render_frames(project, range(2), pool=pool, ops=OPS, sink=sink)
        assert outcome.gap_frames == 2
        assert outcome.written == 2
        assert _grey(sink.frames[0]) == 0  # the asset that resolved is on top

    def test_the_pool_warnings_come_back_with_the_outcome(self) -> None:
        with _pool(FakeDecoder()) as pool:
            outcome = render_frames(
                _project(_clip()), range(1), pool=pool, ops=OPS, sink=FakeSink()
            )
        assert outcome.warnings[0].code == "NS-MEDIA-4001"


class TestStopping:
    def test_cancelling_stops_between_frames_and_abandons_the_file(self) -> None:
        """A half-written file on the user's desktop is worse than none."""
        decoder = FakeDecoder({"a1.mp4": FakeClip(frame_count=30)})
        sink = FakeSink()
        calls = iter(range(10))

        def cancel() -> bool:
            return next(calls) >= 2

        with _pool(decoder, "a1") as pool:
            outcome = render_frames(
                _project(_clip()), range(10), pool=pool, ops=OPS, sink=sink, cancel=cancel
            )
        assert outcome.cancelled is True
        assert outcome.written == 2
        assert sink.aborted is True
        assert sink.finished is False

    def test_an_encoder_failure_stops_the_render(self) -> None:
        decoder = FakeDecoder({"a1.mp4": FakeClip(frame_count=30)})
        sink = FakeSink(fail_at=3)
        with _pool(decoder, "a1") as pool:
            outcome = render_frames(_project(_clip()), range(10), pool=pool, ops=OPS, sink=sink)
        assert outcome.ok is False
        assert outcome.written == 3
        assert outcome.error is not None
        assert sink.aborted is True

    def test_a_failure_to_finish_is_reported_too(self) -> None:
        """The tail of a render is in the flush, and losing it is losing frames."""
        decoder = FakeDecoder({"a1.mp4": FakeClip(frame_count=30)})
        sink = FakeSink(finish_error=NovaError("NS-RENDER-4003", "the flush failed"))
        with _pool(decoder, "a1") as pool:
            outcome = render_frames(_project(_clip()), range(2), pool=pool, ops=OPS, sink=sink)
        assert outcome.written == 2
        assert outcome.ok is False
        assert outcome.error is not None


class TestPreview:
    def test_one_frame_without_a_sink(self) -> None:
        decoder = FakeDecoder({"a1.mp4": FakeClip(frame_count=30)})
        with _pool(decoder, "a1") as pool:
            frame, gaps = render_preview_frame(_project(_clip()), 7, pool=pool, ops=OPS)
        assert _grey(frame) == 7
        assert gaps == ()

    def test_a_preview_reports_what_is_missing(self) -> None:
        with _pool(FakeDecoder()) as pool:
            frame, gaps = render_preview_frame(_project(_clip()), 0, pool=pool, ops=OPS)
        assert len(gaps) == 1
        assert frame.pixels.max() == 0

    def test_a_negative_frame_is_a_caller_bug(self) -> None:
        with _pool(FakeDecoder(), "a1") as pool, pytest.raises(Exception, match="negative"):
            render_preview_frame(_project(_clip()), -1, pool=pool, ops=OPS)

    def test_the_preview_and_the_export_agree(self) -> None:
        """The promise, in one test: same compositor, one code path."""
        decoder = FakeDecoder({"a1.mp4": FakeClip(frame_count=30)})
        sink = FakeSink()
        with _pool(decoder, "a1") as pool:
            render_frames(_project(_clip()), range(1), pool=pool, ops=OPS, sink=sink)
            pool.clear_cache()
            preview, _ = render_preview_frame(_project(_clip()), 0, pool=pool, ops=OPS)
        assert np.array_equal(preview.pixels, sink.frames[0].pixels)
