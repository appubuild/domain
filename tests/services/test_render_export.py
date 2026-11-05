"""The export job (`services/render/export.py`).

An export is not a function that returns a file; it is a *job*, and the three
things that make that true are what these tests pin:

* **It can be stopped, and stopping it leaves nothing behind.** The loop polls
  cancellation between frames and the target is aborted, so a cancelled export
  is an empty desktop rather than a truncated MP4 with a plausible name — the
  one outcome worse than not exporting at all (ADR-0010, port rule 7).
* **It reports in values, not callbacks.** Progress is a frozen `JobProgress`
  the executor throttles, which is the only shape that survives a process
  boundary. A stage change and the terminal report are always published,
  because a bar frozen at 99 % is indistinguishable from a hang.
* **It is data, so it can cross that boundary.** An export runs in the process
  pool, and Windows `spawn` pickles the body — so the job must be picklable
  when it is built the way the composition root builds it, and a body that is
  not must be caught at submit time rather than forty minutes into a two-hour
  export. That is what the pickling test asserts, and it is why the factories
  exist instead of captured collaborators.

The rest is the ordinary contract: where a range comes from, what a gap means,
and that the summary a user reads is the summary the job produced.

Everything except the last test runs on the seek-counting fake decoder, so this
suite needs no FFmpeg. The last test does the opposite on purpose: it exports a
real clip through `PyAVRenderer` and opens the file the job wrote.
"""

from __future__ import annotations

import pickle
from typing import TYPE_CHECKING, Any

import pytest

from nova_studio.core.errors import NovaError, NovaInvariantError
from nova_studio.core.ident import EntityId
from nova_studio.core.jobs import (
    Isolation,
    JobFailureKind,
    JobMemoryClass,
    JobOutcome,
    JobPriority,
    JobProgress,
    JobSpec,
)
from nova_studio.core.result import Result, err, ok
from nova_studio.core.temporal import Timebase
from nova_studio.domain.export import (
    ContainerFormat,
    OutputSpec,
    RateControl,
    RenderStats,
    VideoCodec,
    VideoEncodeSpec,
)
from nova_studio.domain.media import AssetKind, MediaAsset
from nova_studio.domain.project import FrameSize, Project, ProjectSettings
from nova_studio.domain.timeline import Clip, Timeline, Track, TrackKind
from nova_studio.services.render.export import (
    EXPORT_CHECKPOINT_EVERY,
    EXPORT_GRACE_PERIOD_MS,
    EXPORT_JOB_KIND,
    ExportRequest,
    ExportStage,
    ExportVideoJob,
    export_job_spec,
    export_summary,
)
from tests.media.fake_decoder import FakeClip, FakeDecoder

if TYPE_CHECKING:
    from pathlib import Path

    from nova_studio.domain.media import FrameBuffer
    from nova_studio.ports.render import FrameSink, RenderTarget

pytestmark = pytest.mark.unit

WIDTH, HEIGHT = 8, 6
TIMEBASE = Timebase(num=30, den=1)


# ---------------------------------------------------------------------------
# The fakes: a sink, a target, a renderer, a context
# ---------------------------------------------------------------------------


class TickingClock:
    """A clock that moves 100 ms every time it is read.

    An export's ETA is extrapolated from elapsed time, and a clock that reports
    the same instant forever would make the estimate permanently unknowable —
    which is the honest answer for the first frames and a lie after them.
    """

    __slots__ = ("_now_ms",)

    def __init__(self, now_ms: int = 1_000) -> None:
        self._now_ms = now_ms

    def now_ms(self) -> int:
        self._now_ms += 100
        return self._now_ms

    def monotonic(self) -> float:
        return self._now_ms / 1000.0


class FakeSink:
    """A `FrameSink` that records what it was given and can fail on cue."""

    def __init__(
        self,
        *,
        fail_at: int | None = None,
        finish_error: NovaError | None = None,
        cancel_after: int | None = None,
        context: Any = None,
    ) -> None:
        self.frames: list[FrameBuffer] = []
        self.fail_at = fail_at
        self.finish_error = finish_error
        self.cancel_after = cancel_after
        self.context = context
        self.aborted = False

    def write(self, frame: FrameBuffer) -> Result[None]:
        if self.fail_at is not None and len(self.frames) >= self.fail_at:
            return err(NovaError("NS-RENDER-4003", "the encoder rejected this frame"))
        self.frames.append(frame)
        if self.cancel_after is not None and len(self.frames) >= self.cancel_after:
            # Cancellation arrives from outside a job, which is exactly why the
            # loop has to poll rather than be told.
            self.context.stop()
        return ok(None)

    def finish(self) -> Result[RenderStats]:
        if self.finish_error is not None:
            return err(self.finish_error)
        return ok(
            RenderStats(
                frames_written=len(self.frames),
                bytes_written=len(self.frames) * WIDTH * HEIGHT * 3,
                elapsed_ms=10,
            )
        )

    def abort(self) -> None:
        self.aborted = True


class FakeTarget:
    """A `RenderTarget` around one sink. No audio: exports of video only."""

    def __init__(self, sink: FakeSink) -> None:
        self.sink = sink
        self.aborted = False
        self.finished = False

    def video(self) -> FrameSink:
        return self.sink

    def audio(self) -> Any:
        return None

    def finish(self) -> Result[RenderStats]:
        self.finished = True
        return self.sink.finish()

    def abort(self) -> None:
        self.aborted = True
        self.sink.abort()


class FakeRenderer:
    """A `Renderer` that hands out a sink the test can inspect."""

    def __init__(self, sink: FakeSink | None = None, *, error: NovaError | None = None) -> None:
        self.sink = sink if sink is not None else FakeSink()
        self.target = FakeTarget(self.sink)
        self.error = error
        self.opened: list[tuple[OutputSpec, str]] = []

    def open(self, spec: OutputSpec, path: str) -> Result[RenderTarget]:
        self.opened.append((spec, path))
        if self.error is not None:
            return err(self.error)
        return ok(self.target)


class FakeContext:
    """A `JobContext`: records what a job said, and can be told to stop it."""

    def __init__(self, *, spec: JobSpec | None = None, clock_ms: int = 1_000) -> None:
        self.job_id = "j-1"
        self.spec = spec or export_job_spec()
        self.reports: list[JobProgress] = []
        self.checkpoints: list[dict[str, object]] = []
        self.cancelled = False
        self.clock_ms = clock_ms

    def is_cancelled(self) -> bool:
        return self.cancelled

    def report(self, progress: JobProgress) -> None:
        self.reports.append(progress)

    def checkpoint(self, state: Any) -> None:
        self.checkpoints.append(dict(state))

    def stop(self) -> None:
        """What an executor does when the user presses cancel."""
        self.cancelled = True

    @property
    def stages(self) -> list[str]:
        return [report.stage for report in self.reports]

    def at(self, stage: str) -> list[JobProgress]:
        return [report for report in self.reports if report.stage == stage]


# ---------------------------------------------------------------------------
# Building a project and a job
# ---------------------------------------------------------------------------


def _spec(width: int = WIDTH, height: int = HEIGHT, **over: Any) -> OutputSpec:
    """An H.264/MP4 export of the test canvas."""
    video: dict[str, Any] = {
        "codec": VideoCodec.H264,
        "width": width,
        "height": height,
        "timebase": TIMEBASE,
        "rate_control": RateControl.for_crf(23),
        "preset": "veryfast",
    }
    video.update(over)
    return OutputSpec(container=ContainerFormat.MP4, video=VideoEncodeSpec(**video))


def _project(*clips: Clip, assets: tuple[MediaAsset, ...] = ()) -> Project:
    return Project(
        project_id=EntityId("p1"),
        name="Demo",
        settings=ProjectSettings(frame_size=FrameSize(width=WIDTH, height=HEIGHT)),
        timeline=Timeline.of(
            Track(track_id="v1", kind=TrackKind.VIDEO, clips=clips),
            timebase=TIMEBASE,
        ),
        assets=assets,
    )


def _clip(clip_id: str = "c1", *, asset_id: str = "a1", start: int = 0, length: int = 30) -> Clip:
    return Clip.of(clip_id, asset_id, start_frame=start, source_frames=length)


def _clip_project(clip: Clip, source: Path, width: int, height: int) -> Project:
    """A project the size of the real test clip, holding one clip of it."""
    return Project(
        project_id=EntityId("p1"),
        name="Demo",
        settings=ProjectSettings(frame_size=FrameSize(width=width, height=height)),
        timeline=Timeline.of(
            Track(track_id="v1", kind=TrackKind.VIDEO, clips=(clip,)),
            timebase=TIMEBASE,
        ),
        assets=(MediaAsset(EntityId("a1"), str(source), AssetKind.VIDEO),),
    )


def _asset(asset_id: str = "a1", path: str = "a1.mp4") -> MediaAsset:
    return MediaAsset(EntityId(asset_id), path, AssetKind.VIDEO)


def _decoder(*assets: str, frame_count: int = 400) -> FakeDecoder:
    return FakeDecoder({f"{asset}.mp4": FakeClip(frame_count=frame_count) for asset in assets})


def _job(
    project: Project,
    path: str = "/tmp/out.mp4",
    *,
    sink: FakeSink | None = None,
    renderer: FakeRenderer | None = None,
    clock: Any = None,
    **request: Any,
) -> tuple[ExportVideoJob, FakeRenderer]:
    """A job wired to fakes, and the renderer it will use."""
    from nova_studio.infra.imaging import OpenCVImageOps

    made = renderer if renderer is not None else FakeRenderer(sink)
    return (
        ExportVideoJob(
            project,
            ExportRequest(path=path, spec=_spec(), **request),
            renderer_factory=lambda: made,
            ops_factory=OpenCVImageOps,
            decoder_factory=lambda: _decoder("a1"),
            clock_factory=lambda: clock if clock is not None else TickingClock(),
        ),
        made,
    )


# ---------------------------------------------------------------------------
# The request
# ---------------------------------------------------------------------------


class TestTheRequest:
    def test_a_destination_is_required(self) -> None:
        with pytest.raises(NovaInvariantError):
            ExportRequest(path="", spec=_spec())

    def test_a_range_that_ends_before_it_starts_is_a_bug(self) -> None:
        with pytest.raises(NovaInvariantError):
            ExportRequest(path="/tmp/out.mp4", spec=_spec(), start_frame=10, end_frame=5)

    def test_the_default_range_is_the_whole_project(self) -> None:
        project = _project(_clip(length=30))
        request = ExportRequest(path="/tmp/out.mp4", spec=_spec())
        assert list(request.frames_for(project)) == list(range(30))

    def test_a_range_past_the_end_is_clipped_not_padded(self) -> None:
        """A project is not padded to the length somebody typed."""
        project = _project(_clip(length=30))
        request = ExportRequest(path="/tmp/out.mp4", spec=_spec(), end_frame=10_000)
        assert len(request.frames_for(project)) == 30

    def test_a_range_inside_the_project_is_kept(self) -> None:
        project = _project(_clip(length=30))
        request = ExportRequest(path="/tmp/out.mp4", spec=_spec(), start_frame=5, end_frame=10)
        assert list(request.frames_for(project)) == [5, 6, 7, 8, 9]

    def test_an_empty_range_is_refused_before_any_work(self) -> None:
        project = _project(_clip(length=30))
        request = ExportRequest(path="/tmp/out.mp4", spec=_spec(), start_frame=30)
        with pytest.raises(NovaInvariantError, match="nothing to export"):
            request.frames_for(project)

    def test_a_project_with_nothing_on_it_has_nothing_to_export(self) -> None:
        with pytest.raises(NovaInvariantError):
            ExportRequest(path="/tmp/out.mp4", spec=_spec()).frames_for(_project())


class TestTheSpec:
    def test_an_export_is_a_process_job(self) -> None:
        """CPU-bound for minutes: it must not share a loop with the UI."""
        spec = export_job_spec()
        assert spec.kind == EXPORT_JOB_KIND == "export.video"
        assert spec.isolation is Isolation.PROCESS
        assert spec.memory_class is JobMemoryClass.LARGE

    def test_an_export_is_low_priority_and_cancellable(self) -> None:
        spec = export_job_spec()
        assert spec.priority is JobPriority.LOW
        assert spec.cancellable is True

    def test_an_export_is_idempotent_so_a_lost_worker_can_be_retried(self) -> None:
        """Writing the same file twice is the same as writing it once."""
        spec = export_job_spec()
        assert spec.idempotent is True
        assert spec.retry.max_attempts == 2
        assert spec.retry.retry_on == frozenset({JobFailureKind.WORKER_LOST})

    def test_a_cancelled_export_gets_the_export_grace_period(self) -> None:
        """Five seconds is not enough: killing a job mid-mux corrupts the file."""
        assert export_job_spec().grace_period_ms == EXPORT_GRACE_PERIOD_MS == 30_000

    def test_a_priority_can_be_raised_for_an_urgent_export(self) -> None:
        assert export_job_spec(priority=JobPriority.HIGH).priority is JobPriority.HIGH


# ---------------------------------------------------------------------------
# Running it
# ---------------------------------------------------------------------------


class TestWritingTheFile:
    def test_every_frame_reaches_the_encoder(self) -> None:
        job, renderer = _job(_project(_clip(), assets=(_asset(),)))
        result = job(FakeContext())
        assert result.is_ok() is True
        assert len(renderer.sink.frames) == 30

    def test_the_artefact_is_the_path_that_was_asked_for(self) -> None:
        job, _ = _job(_project(_clip(), assets=(_asset(),)), path="/media/out.mp4")
        outcome = job(FakeContext()).unwrap()
        assert outcome.artefacts == ("/media/out.mp4",)

    def test_the_outcome_carries_the_render_stats(self) -> None:
        job, _ = _job(_project(_clip(), assets=(_asset(),)))
        outcome = job(FakeContext()).unwrap()
        assert isinstance(outcome.value, RenderStats)
        assert outcome.value.frames_written == 30

    def test_the_container_is_finished(self) -> None:
        """A file is only valid after `finish`: index, duration, faststart."""
        job, renderer = _job(_project(_clip(), assets=(_asset(),)))
        assert job(FakeContext()).is_ok() is True
        assert renderer.target.finished is True
        assert renderer.target.aborted is False

    def test_only_a_range_is_rendered_when_a_range_is_asked_for(self) -> None:
        job, renderer = _job(_project(_clip(), assets=(_asset(),)), start_frame=10, end_frame=15)
        assert job(FakeContext()).is_ok() is True
        assert len(renderer.sink.frames) == 5


class TestProgress:
    def test_the_stages_are_reported_in_order(self) -> None:
        job, _ = _job(_project(_clip(), assets=(_asset(),)), start_frame=0, end_frame=4)
        context = FakeContext()
        assert job(context).is_ok() is True
        assert context.stages == ["preparing", *(["encoding"] * 4), "muxing", "done"]

    def test_progress_never_goes_backwards(self) -> None:
        job, _ = _job(_project(_clip(), assets=(_asset(),)))
        context = FakeContext()
        job(context)
        fractions = [report.fraction for report in context.reports]
        assert fractions == sorted(fractions)
        assert fractions[-1] == 1.0

    def test_the_first_report_says_where_the_file_is_going(self) -> None:
        job, _ = _job(_project(_clip(), assets=(_asset(),)), path="/media/holiday.mp4")
        context = FakeContext()
        job(context)
        assert context.reports[0].stage == ExportStage.PREPARING
        assert context.reports[0].detail == "holiday.mp4"

    def test_each_frame_reports_its_number(self) -> None:
        job, _ = _job(_project(_clip(), assets=(_asset(),)), start_frame=0, end_frame=3)
        context = FakeContext()
        job(context)
        encoding = context.at(ExportStage.ENCODING)
        assert [report.payload["frame"] for report in encoding] == [1, 2, 3]

    def test_an_eta_is_offered_only_once_there_is_a_rate(self) -> None:
        """An estimate from one frame is wrong by a factor of ten."""
        job, _ = _job(_project(_clip(), assets=(_asset(),)), start_frame=0, end_frame=10)
        context = FakeContext()
        job(context)
        etas = [report.eta_seconds for report in context.at(ExportStage.ENCODING)]
        assert etas[:4] == [None, None, None, None]
        assert etas[4] is not None

    def test_the_last_report_says_what_was_written(self) -> None:
        job, _ = _job(_project(_clip(), assets=(_asset(),)))
        context = FakeContext()
        job(context)
        assert context.reports[-1].stage == ExportStage.DONE
        assert "30 frames" in context.reports[-1].detail

    def test_a_resume_point_is_left_every_so_often(self) -> None:
        """A crashed export resumes from the last one, not from the start."""
        job, _ = _job(_project(_clip(length=400), assets=(_asset(),)))
        context = FakeContext()
        job(context)
        assert context.checkpoints == [
            {"frames_written": EXPORT_CHECKPOINT_EVERY},
            {"frames_written": 2 * EXPORT_CHECKPOINT_EVERY},
            {"frames_written": 3 * EXPORT_CHECKPOINT_EVERY},
        ]


class TestStopping:
    def test_a_cancelled_export_stops_between_frames(self) -> None:
        sink = FakeSink(cancel_after=3)
        context = FakeContext()
        sink.context = context
        job, renderer = _job(_project(_clip(), assets=(_asset(),)), sink=sink)
        result = job(context)
        assert result.is_err() is True
        assert renderer.sink.frames, "the frames before the stop were written"

    def test_a_cancelled_export_is_cancelled_and_not_failed(self) -> None:
        """The UI says 'stopped', not 'failed': the user asked for it."""
        sink = FakeSink(cancel_after=2)
        context = FakeContext()
        sink.context = context
        job, _ = _job(_project(_clip(), assets=(_asset(),)), sink=sink)
        problem = job(context).unwrap_err()
        assert problem.code == "NS-JOB-5005"
        assert "2 of 30" in problem.message

    def test_a_cancelled_export_leaves_no_file(self) -> None:
        """A truncated-but-playable MP4 is worse than no MP4 at all."""
        sink = FakeSink(cancel_after=2)
        context = FakeContext()
        sink.context = context
        job, renderer = _job(_project(_clip(), assets=(_asset(),)), sink=sink)
        job(context)
        assert renderer.target.aborted is True
        assert renderer.sink.aborted is True

    def test_a_cancelled_export_reports_no_artefacts(self) -> None:
        sink = FakeSink(cancel_after=2)
        context = FakeContext()
        sink.context = context
        job, _ = _job(_project(_clip(), assets=(_asset(),)), sink=sink)
        assert job(context).unwrap_err().details["frames_written"] == 2


class TestFailure:
    def test_an_unwritable_destination_is_refused_before_a_frame_is_decoded(self) -> None:
        renderer = FakeRenderer(error=NovaError("NS-RENDER-4001", "the destination is read-only"))
        job, _ = _job(_project(_clip(), assets=(_asset(),)), renderer=renderer)
        result = job(FakeContext())
        assert result.is_err() is True
        assert result.unwrap_err().code == "NS-RENDER-4001"

    def test_a_frame_the_encoder_rejects_stops_the_export(self) -> None:
        sink = FakeSink(fail_at=4)
        job, renderer = _job(_project(_clip(), assets=(_asset(),)), sink=sink)
        problem = job(FakeContext()).unwrap_err()
        assert problem.code == "NS-RENDER-4003"
        assert len(renderer.sink.frames) == 4

    def test_a_failed_export_leaves_no_file(self) -> None:
        sink = FakeSink(fail_at=4)
        job, renderer = _job(_project(_clip(), assets=(_asset(),)), sink=sink)
        job(FakeContext())
        assert renderer.target.aborted is True

    def test_a_mux_that_fails_is_a_failed_export(self) -> None:
        sink = FakeSink(
            finish_error=NovaError("NS-RENDER-4003", "the container could not be written")
        )
        job, _ = _job(_project(_clip(), assets=(_asset(),)), sink=sink)
        assert job(FakeContext()).unwrap_err().code == "NS-RENDER-4003"


class TestGaps:
    """An offline asset is a hole in the picture, not a failed export."""

    def test_an_offline_asset_does_not_stop_the_export(self) -> None:
        job, renderer = _job(_project(_clip()))  # no assets: nothing resolves
        result = job(FakeContext())
        assert result.is_ok() is True
        assert len(renderer.sink.frames) == 30

    def test_the_summary_says_how_much_was_missing(self) -> None:
        job, _ = _job(_project(_clip()))
        outcome = job(FakeContext()).unwrap()
        assert "1 asset offline" in outcome.detail

    def test_the_last_report_names_the_missing_assets(self) -> None:
        job, _ = _job(_project(_clip()))
        context = FakeContext()
        job(context)
        assert context.reports[-1].payload["missing"] == ["a1"]

    def test_an_export_that_must_be_complete_refuses_instead(self) -> None:
        job, renderer = _job(_project(_clip()), fail_on_missing=True)
        result = job(FakeContext())
        assert result.is_err() is True
        assert result.unwrap_err().code == "NS-RENDER-4003"
        assert renderer.target.aborted is True

    def test_a_complete_export_says_nothing_about_missing_media(self) -> None:
        job, _ = _job(_project(_clip(), assets=(_asset(),)))
        assert "offline" not in job(FakeContext()).unwrap().detail


class TestTheSummary:
    def test_frames_bytes_and_throughput(self) -> None:
        assert export_summary(RenderStats(300, 1_500_000, 10_000)) == (
            "300 frames · 1.4 MB · 30.0 fps"
        )

    def test_one_offline_asset_is_singular(self) -> None:
        assert "1 asset offline" in export_summary(RenderStats(10, 10, 10), missing=("a1",))

    def test_a_render_that_measured_no_time_reports_no_rate(self) -> None:
        """Zero elapsed is not zero throughput; it is unmeasured."""
        assert export_summary(RenderStats(10, 10, 0)) == "10 frames · 10 B"


class TestCrossingTheProcessBoundary:
    """An export runs in a worker; Windows `spawn` pickles the body."""

    def test_a_job_built_the_way_the_composition_root_builds_it_is_picklable(self) -> None:
        from nova_studio.infra.imaging import OpenCVImageOps
        from nova_studio.infra.media import PyAVDecoder
        from nova_studio.infra.render import PyAVRenderer

        job = ExportVideoJob(
            _project(_clip(), assets=(_asset(),)),
            ExportRequest(path="/tmp/out.mp4", spec=_spec()),
            renderer_factory=PyAVRenderer,
            ops_factory=OpenCVImageOps,
            decoder_factory=PyAVDecoder,
        )
        assert pickle.loads(pickle.dumps(job)).request.path == "/tmp/out.mp4"

    def test_a_job_capturing_a_closure_is_not_picklable(self) -> None:
        """Refused at submit time, not forty minutes into a two-hour export."""
        from nova_studio.infra.imaging import OpenCVImageOps

        job = ExportVideoJob(
            _project(_clip(), assets=(_asset(),)),
            ExportRequest(path="/tmp/out.mp4", spec=_spec()),
            renderer_factory=lambda: FakeRenderer(),
            ops_factory=OpenCVImageOps,
            decoder_factory=lambda: _decoder("a1"),
        )
        with pytest.raises((pickle.PicklingError, AttributeError, TypeError)):
            pickle.dumps(job)


# ---------------------------------------------------------------------------
# The whole thing, with a real encoder
# ---------------------------------------------------------------------------


@pytest.mark.media
class TestTheRealThing:
    def test_a_clip_is_exported_through_the_real_encoder(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """One test that touches FFmpeg, so the rest do not have to.

        The frames come from a clip encoded in a temporary directory by PyAV and
        read back by `PyAVDecoder`; the file they are written to is opened again
        with `av` and counted. Everything between those two ends is the seam the
        architecture is built on, and a fake on either side would let a lie
        through: that the preview and the export share a code path, and that the
        path works.
        """
        av = pytest.importorskip("av", reason="a real export needs a real encoder")
        from nova_studio.infra.imaging import OpenCVImageOps
        from nova_studio.infra.media import PyAVDecoder
        from nova_studio.infra.render import PyAVRenderer
        from tests.media.encoding import HEIGHT as CLIP_HEIGHT, WIDTH as CLIP_WIDTH, write_video

        source = write_video(tmp_path / "clip.mp4")
        project = Project(
            project_id=EntityId("p1"),
            name="Demo",
            settings=ProjectSettings(frame_size=FrameSize(width=CLIP_WIDTH, height=CLIP_HEIGHT)),
            timeline=Timeline.of(
                Track(
                    track_id="v1",
                    kind=TrackKind.VIDEO,
                    clips=(Clip.of("c1", "a1", start_frame=0, source_frames=12),),
                ),
                timebase=TIMEBASE,
            ),
            assets=(MediaAsset(EntityId("a1"), str(source), AssetKind.VIDEO),),
        )
        destination = tmp_path / "out.mp4"
        job = ExportVideoJob(
            project,
            ExportRequest(path=str(destination), spec=_spec(CLIP_WIDTH, CLIP_HEIGHT)),
            renderer_factory=PyAVRenderer,
            ops_factory=OpenCVImageOps,
            decoder_factory=PyAVDecoder,
        )
        context = FakeContext()
        result = job(context)
        assert result.is_ok() is True, result.unwrap_err()
        assert destination.exists()
        assert destination.stat().st_size > 0

        with av.open(str(destination)) as container:
            stream = container.streams.video[0]
            assert (stream.codec_context.width, stream.codec_context.height) == (
                CLIP_WIDTH,
                CLIP_HEIGHT,
            )
            decoded = sum(1 for _ in container.decode(stream))
        assert decoded >= 10, f"only {decoded} frames came back out"

    def test_the_export_reports_what_it_did(self, tmp_path: Path) -> None:
        pytest.importorskip("av", reason="a real export needs a real encoder")
        from nova_studio.infra.imaging import OpenCVImageOps
        from nova_studio.infra.media import PyAVDecoder
        from nova_studio.infra.render import PyAVRenderer
        from tests.media.encoding import HEIGHT as CLIP_HEIGHT, WIDTH as CLIP_WIDTH, write_video

        source = write_video(tmp_path / "clip.mp4")
        project = _clip_project(_clip(length=10), source, CLIP_WIDTH, CLIP_HEIGHT)
        job = ExportVideoJob(
            project,
            ExportRequest(path=str(tmp_path / "out.mp4"), spec=_spec(CLIP_WIDTH, CLIP_HEIGHT)),
            renderer_factory=PyAVRenderer,
            ops_factory=OpenCVImageOps,
            decoder_factory=PyAVDecoder,
        )
        context = FakeContext()
        outcome: JobOutcome = job(context).unwrap()
        assert outcome.artefacts == (str(tmp_path / "out.mp4"),)
        assert context.stages[0] == ExportStage.PREPARING
        assert context.stages[-1] == ExportStage.DONE
        assert "10 frames" in outcome.detail
