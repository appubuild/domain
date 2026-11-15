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

import numpy as np
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
    AudioCodec,
    AudioEncodeSpec,
    ContainerFormat,
    OutputSpec,
    RateControl,
    RenderStats,
    VideoCodec,
    VideoEncodeSpec,
)
from nova_studio.domain.media import AssetKind, AudioBuffer, MediaAsset
from nova_studio.domain.project import FrameSize, Project, ProjectSettings
from nova_studio.domain.timeline import Clip, Timeline, Track, TrackKind
from nova_studio.services.render.export import (
    EXPORT_CHECKPOINT_EVERY,
    EXPORT_GRACE_PERIOD_MS,
    EXPORT_JOB_KIND,
    VIDEO_SHARE,
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


class FakeAudioSink:
    """An `AudioSink` that records every block, and can refuse one on cue."""

    def __init__(
        self,
        *,
        fail_at: int | None = None,
        cancel_after: int | None = None,
        context: Any = None,
    ) -> None:
        self.blocks: list[AudioBuffer] = []
        self.fail_at = fail_at
        self.cancel_after = cancel_after
        self.context = context
        self.finished = False
        self.aborted = False

    def write(self, buffer: AudioBuffer) -> Result[None]:
        if self.fail_at is not None and len(self.blocks) >= self.fail_at:
            return err(NovaError("NS-RENDER-4003", "the encoder rejected this block"))
        self.blocks.append(buffer)
        if self.cancel_after is not None and len(self.blocks) >= self.cancel_after:
            # A stop arrives from outside, which is why the mix polls rather
            # than being told.
            self.context.stop()
        return ok(None)

    def finish(self) -> Result[None]:
        self.finished = True
        return ok(None)

    def abort(self) -> None:
        self.aborted = True

    @property
    def samples(self) -> np.ndarray:
        """Every sample written, in order."""
        if not self.blocks:
            return np.zeros((0, 2), dtype=np.float32)
        return np.concatenate([block.samples for block in self.blocks], axis=0)


class IdentityResampler:
    """A resampler that changes the rate without touching the samples.

    What a test needs is a resampler that is *not* the thing under test: the
    mixer has to ask for a rate and then trim or pad to the sample count it
    computed, and a resampler that happens to return the right length would
    hide a mixer that did not.
    """

    def __init__(self) -> None:
        self.calls: list[tuple[int, int]] = []

    def resample(self, buffer: AudioBuffer, *, sample_rate: int, channels: int) -> AudioBuffer:
        self.calls.append((sample_rate, channels))
        return AudioBuffer(samples=buffer.samples, sample_rate=sample_rate)


class FakeTarget:
    """A `RenderTarget` around a video sink and, when there is one, an audio one."""

    def __init__(self, sink: FakeSink, audio: FakeAudioSink | None = None) -> None:
        self.sink = sink
        self.audio_sink = audio
        self.aborted = False
        self.finished = False

    def video(self) -> FrameSink:
        return self.sink

    def audio(self) -> Any:
        return self.audio_sink

    def finish(self) -> Result[RenderStats]:
        self.finished = True
        return self.sink.finish()

    def abort(self) -> None:
        self.aborted = True
        self.sink.abort()


class FakeRenderer:
    """A `Renderer` that hands out a sink the test can inspect."""

    def __init__(
        self,
        sink: FakeSink | None = None,
        *,
        error: NovaError | None = None,
        audio: FakeAudioSink | None = None,
    ) -> None:
        self.sink = sink if sink is not None else FakeSink()
        self.target = FakeTarget(self.sink, audio)
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


def _spec(
    width: int = WIDTH, height: int = HEIGHT, *, audio: bool = False, **over: Any
) -> OutputSpec:
    """An H.264/MP4 export of the test canvas, with AAC when asked."""
    video: dict[str, Any] = {
        "codec": VideoCodec.H264,
        "width": width,
        "height": height,
        "timebase": TIMEBASE,
        "rate_control": RateControl.for_crf(23),
        "preset": "veryfast",
    }
    video.update(over)
    return OutputSpec(
        container=ContainerFormat.MP4,
        video=VideoEncodeSpec(**video),
        audio=AudioEncodeSpec(codec=AudioCodec.AAC, sample_rate=48_000, channels=2)
        if audio
        else None,
    )


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
    decoder: Any = None,
    resampler: Any = IdentityResampler,
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
            decoder_factory=decoder or (lambda: _decoder("a1")),
            resampler_factory=resampler,
            clock_factory=lambda: clock if clock is not None else TickingClock(),
        ),
        made,
    )


class Soundbank:
    """A decoder factory whose one file has a soundtrack, and that remembers it.

    One decoder, handed out on every call: a factory that built a new one each
    time would leave the test with nothing to inspect afterwards, because the
    job's pool is closed by the time the job returns.
    """

    def __init__(self, **over: Any) -> None:
        self.decoder = FakeDecoder(
            {"a1.mp4": FakeClip(frame_count=400, sample_rate=48_000, **over)}
        )

    def __call__(self) -> Any:
        return self.decoder

    @property
    def media(self) -> Any:
        """The file the job opened, if it opened one."""
        return self.decoder.opened[0] if self.decoder.opened else None

    @property
    def reads(self) -> list[tuple[int, int]]:
        """Every ``(start, count)`` the soundtrack was asked for."""
        media = self.media
        audio = media._audio if media is not None else None
        return audio.reads if audio is not None else []


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


class TestTheSoundtrack:
    """A video-only export is a render that is half finished.

    What is pinned here is that the sound is mixed *at all*, that it covers the
    whole range, and that it lands on the sample the arithmetic says it should
    — because all three ways of getting this wrong fail silently: no audio
    stream in the output, a stream short by a block, and a stream whose every
    sound arrives a beat after its picture.
    """

    def _run(
        self,
        project: Project,
        *,
        decoder: Any = None,
        context: FakeContext | None = None,
        with_resampler: bool = True,
        audio: FakeAudioSink | None = None,
        **request: Any,
    ) -> tuple[Result[JobOutcome], FakeRenderer, FakeContext, Soundbank]:
        """Run one export of a project whose single clip has a soundtrack."""
        used_context = context if context is not None else FakeContext()
        used_audio = audio if audio is not None else FakeAudioSink()
        renderer = FakeRenderer(audio=used_audio)
        bank = decoder if isinstance(decoder, Soundbank) else Soundbank()
        job, made = _job(
            project,
            renderer=renderer,
            decoder=bank,
            resampler=IdentityResampler if with_resampler else None,
            **request,
        )
        return job(used_context), made, used_context, bank

    def test_a_project_with_sound_produces_a_file_with_sound(self) -> None:
        """The hole this whole slice exists to close."""
        result, renderer, _, _ = self._run(_project(_clip(), assets=(_asset(),)))
        assert result.is_ok() is True
        assert renderer.target.audio_sink.samples.shape[0] > 0

    def test_the_soundtrack_covers_every_frame_of_the_export(self) -> None:
        """Thirty frames at 48 kHz is 48 000 samples, not 47 900 of them."""
        _, renderer, _, _ = self._run(_project(_clip(length=30), assets=(_asset(),)))
        samples = renderer.target.audio_sink.samples
        assert samples.shape == (30 * 1600, 2)

    def test_the_soundtrack_is_not_silent_when_the_source_is_not(self) -> None:
        _, renderer, _, _ = self._run(_project(_clip(), assets=(_asset(),)))
        assert renderer.target.audio_sink.samples.any()

    def test_an_output_with_no_audio_stream_is_left_alone(self) -> None:
        """A picture sequence is a real thing to ask for, and silence is what
        it should get — not an error, and not a mix into nowhere."""
        audio = FakeAudioSink()
        renderer = FakeRenderer(audio=None)  # no audio stream declared
        job, made = _job(
            _project(_clip(), assets=(_asset(),)),
            renderer=renderer,
            decoder=Soundbank(),
            resampler=IdentityResampler,
        )
        assert job(FakeContext()).is_ok() is True
        assert made.target.audio_sink is None
        assert audio.blocks == []

    def test_without_a_resampler_an_export_is_silent_but_still_succeeds(self) -> None:
        """A missing adapter is not a corrupt file — but it is a quiet one.

        This is the failure the composition root's comment is about: the field
        defaults to no resampler at all, so a factory left out by accident
        would cost an afternoon. It fails quietly, which is exactly why it is
        pinned here rather than merely documented.
        """
        result, renderer, _, _ = self._run(
            _project(_clip(), assets=(_asset(),)), with_resampler=False
        )
        assert result.is_ok() is True
        assert renderer.target.audio_sink.samples.shape[0] == 0

    def test_an_export_of_the_middle_third_reads_the_middle_of_the_source(
        self,
    ) -> None:
        """An export that starts at frame 30 must not begin at sample zero.

        Placed by the frame rather than by adding up block lengths, which is
        what keeps a two-hour export from being a fraction of a sample late
        per block and visibly out of sync by the end.
        """
        project = _project(_clip(length=90), assets=(_asset(),))
        _, _, _, bank = self._run(project, start_frame=30, end_frame=60)
        assert bank.reads, "the soundtrack was decoded"
        assert bank.reads[0][0] == 30 * 1600

    def test_one_clip_is_one_contiguous_read_per_block(self) -> None:
        """A clip is read once per block, not once per frame: the difference
        between a seek per two seconds and a seek per frame."""
        project = _project(_clip(length=300), assets=(_asset(),))
        _, renderer, _, bank = self._run(project)
        assert len(bank.reads) == 5  # 300 frames in blocks of 60
        assert sum(count for _, count in bank.reads) == renderer.target.audio_sink.samples.shape[0]

    def test_the_mix_starts_at_the_first_sample_of_the_first_source_frame(self) -> None:
        _, _, _, bank = self._run(_project(_clip(length=30), assets=(_asset(),)))
        assert bank.reads and bank.reads[0][0] == 0

    def test_the_soundtrack_is_reported_under_its_own_stage(self) -> None:
        """A bar that sits at 100 % while two hours of audio are mixed looks
        exactly like the hang the bar exists to rule out."""
        _, _, context, _ = self._run(_project(_clip(), assets=(_asset(),)))
        assert ExportStage.AUDIO in context.stages

    def test_no_report_ever_claims_more_than_the_whole(self) -> None:
        _, _, context, _ = self._run(_project(_clip(), assets=(_asset(),)))
        assert all(report.fraction <= 1.0 for report in context.reports)

    def test_the_pictures_own_the_first_part_of_the_bar(self) -> None:
        """So the mix has somewhere left to go."""
        _, _, context, _ = self._run(_project(_clip(), assets=(_asset(),)))
        encoding = context.at(ExportStage.ENCODING)
        assert encoding
        assert max(report.fraction for report in encoding) <= VIDEO_SHARE + 1e-9

    def test_the_last_report_is_the_one_that_names_the_artefact(self) -> None:
        _, _, context, _ = self._run(_project(_clip(), assets=(_asset(),)))
        assert context.reports[-1].stage == ExportStage.DONE

    def test_an_offline_asset_is_a_quiet_passage_not_a_failed_export(self) -> None:
        """The same rule the pictures follow (ADR-0015 rule 3)."""
        result, renderer, _, _ = self._run(_project(_clip()))  # no assets
        assert result.is_ok() is True
        assert not renderer.target.audio_sink.samples.any()

    def test_a_silent_gap_still_occupies_its_samples(self) -> None:
        """A block omitted is every later sound arriving early by a block."""
        _, renderer, _, _ = self._run(_project(_clip()))
        assert renderer.target.audio_sink.samples.shape == (30 * 1600, 2)

    def test_a_muted_track_is_not_heard(self) -> None:
        from nova_studio.domain.timeline import Timeline, Track, TrackKind

        muted = Track(track_id="v1", kind=TrackKind.VIDEO, clips=(_clip(),), muted=True)
        project = _project(assets=(_asset(),)).with_timeline(Timeline.of(muted, timebase=TIMEBASE))
        _, renderer, _, _ = self._run(project)
        assert not renderer.target.audio_sink.samples.any()

    def test_a_hidden_track_still_is(self) -> None:
        """Hiding is about the picture. A hidden track's sound is still there,
        which is what 'hidden' means in every editor."""
        from nova_studio.domain.timeline import Timeline, Track, TrackKind

        hidden = Track(track_id="v1", kind=TrackKind.VIDEO, clips=(_clip(),), hidden=True)
        project = _project(assets=(_asset(),)).with_timeline(Timeline.of(hidden, timebase=TIMEBASE))
        _, renderer, _, _ = self._run(project)
        assert renderer.target.audio_sink.samples.any()

    def test_a_block_the_encoder_refuses_does_not_fail_the_export(self) -> None:
        """A mix that cannot be written is bad luck, not a lost render: the
        pictures are already in the container, and the file still closes."""
        result, renderer, _, _ = self._run(
            _project(_clip(), assets=(_asset(),)), audio=FakeAudioSink(fail_at=0)
        )
        assert result.is_ok() is True
        assert renderer.target.audio_sink.samples.shape[0] == 0

    def test_a_stop_during_the_mix_leaves_no_file(self) -> None:
        """Otherwise the export commits with all its pictures and half its
        sound, which is a silent way to publish a half-finished file."""
        context = FakeContext()
        result, renderer, _, _ = self._run(
            _project(_clip(), assets=(_asset(),)),
            context=context,
            audio=FakeAudioSink(cancel_after=1, context=context),
        )
        assert result.is_err() is True
        assert renderer.target.aborted is True

    def test_a_stop_during_the_mix_is_a_stop_and_not_a_failure(self) -> None:
        context = FakeContext()
        result, _, _, _ = self._run(
            _project(_clip(), assets=(_asset(),)),
            context=context,
            audio=FakeAudioSink(cancel_after=1, context=context),
        )
        assert result.unwrap_err().code == "NS-JOB-5005"

    def test_the_open_file_is_closed_whether_or_not_the_mix_succeeded(self) -> None:
        """A leaked decoder is a leaked file handle, and an export holds one
        per asset for the whole job."""
        _, _, _, bank = self._run(_project(_clip(), assets=(_asset(),)))
        assert bank.media is not None
        assert bank.media.is_closed


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

    def test_an_export_of_a_clip_with_sound_carries_that_sound(self, tmp_path: Path) -> None:
        """The whole chain, with a real encoder, a real decoder and a real file.

        Everything else in this suite proves the mixer right against a
        synthesiser. This one proves the plumbing: that the pool hands the
        mixer a real PyAV sample source, that the resampler reaches 48 kHz, and
        that what lands in the container decodes back as roughly a second of
        stereo — because the one way this can be wrong is silently, and the
        file that comes out is still a playable MP4 with no sound in it.
        """
        av = pytest.importorskip("av", reason="a real export needs a real encoder")
        from nova_studio.infra.imaging import OpenCVImageOps
        from nova_studio.infra.media import PyAVDecoder, PyAVResampler
        from nova_studio.infra.render import PyAVRenderer
        from tests.media.encoding import HEIGHT as CLIP_HEIGHT, WIDTH as CLIP_WIDTH, write_video

        source = write_video(tmp_path / "clip.mp4", with_audio=True)
        project = _clip_project(_clip(length=24), source, CLIP_WIDTH, CLIP_HEIGHT)
        destination = tmp_path / "out.mp4"
        job = ExportVideoJob(
            project,
            ExportRequest(path=str(destination), spec=_spec(CLIP_WIDTH, CLIP_HEIGHT, audio=True)),
            renderer_factory=PyAVRenderer,
            ops_factory=OpenCVImageOps,
            decoder_factory=PyAVDecoder,
            resampler_factory=PyAVResampler,
        )
        result = job(FakeContext())
        assert result.is_ok() is True, result.unwrap_err()

        with av.open(str(destination)) as container:
            streams = container.streams.audio
            assert streams, "the file the job wrote has no audio stream"
            samples = sum(frame.samples for frame in container.decode(streams[0]))
        # 24 frames at 29.97 fps is 0.8 s: 38 400 samples, and an AAC stream
        # carries a little padding, so what matters is that it is the right
        # order of magnitude and not zero and not ten seconds.
        assert 30_000 <= samples <= 60_000, f"{samples} samples came back out"

    def test_an_export_without_an_audio_stream_in_the_spec_is_a_picture(
        self, tmp_path: Path
    ) -> None:
        """Silence is an answer, not an accident: no stream was asked for."""
        av = pytest.importorskip("av", reason="a real export needs a real encoder")
        from nova_studio.infra.imaging import OpenCVImageOps
        from nova_studio.infra.media import PyAVDecoder, PyAVResampler
        from nova_studio.infra.render import PyAVRenderer
        from tests.media.encoding import HEIGHT as CLIP_HEIGHT, WIDTH as CLIP_WIDTH, write_video

        source = write_video(tmp_path / "clip.mp4", with_audio=True)
        project = _clip_project(_clip(length=12), source, CLIP_WIDTH, CLIP_HEIGHT)
        destination = tmp_path / "out.mp4"
        job = ExportVideoJob(
            project,
            ExportRequest(path=str(destination), spec=_spec(CLIP_WIDTH, CLIP_HEIGHT)),
            renderer_factory=PyAVRenderer,
            ops_factory=OpenCVImageOps,
            decoder_factory=PyAVDecoder,
            resampler_factory=PyAVResampler,
        )
        assert job(FakeContext()).is_ok() is True
        with av.open(str(destination)) as container:
            assert not container.streams.audio
