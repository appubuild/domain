"""`services/media/generation.py` — making the copies, and leaving nothing behind.

Two things are being pinned, and they are the two ways this kind of feature goes
wrong:

* **What gets made, and what does not.** A proxy is minutes of CPU and hundreds
  of megabytes; making one for the two hundred clips somebody imported but never
  cut is how a cache becomes forty gigabytes. So proxies are planned for the
  assets the *timeline* references, thumbnails for every asset, and neither is
  planned twice — a request for something already held is simply not made.
* **A job that fails leaves nothing.** The renderer stages beside its target and
  the still sink renames into place, but that only matters if the body aborts
  when it should and records only when the bytes are complete. A row for a file
  that does not exist is a promise eviction will collect on, and a half-written
  JPEG in a cache directory is served as if it were finished.

A third, smaller one: **the key names the frame the strip asked for**, even
though the picture is the nearest keyframe at or before it. That mapping is a
pure function of the file, which is what keeps the cache stable across a reopen
— a key derived from a snapped frame would depend on when the job happened to
run.

The doubles are small on purpose: a seek-counting fake decoder, a sink that
records what it was handed, a still sink that writes into a dictionary, and a
cache whose index is a dict and whose disk is a set. No FFmpeg, no SQLite, no
filesystem.
"""

from __future__ import annotations

import pickle
from dataclasses import replace
from fractions import Fraction
from functools import partial
from typing import TYPE_CHECKING, Any

import numpy as np
import pytest

from nova_studio.core.errors import NovaError, NovaInvariantError
from nova_studio.core.ident import EntityId
from nova_studio.core.result import Result, err, ok
from nova_studio.core.temporal import Timebase
from nova_studio.domain.export import ContainerFormat, RenderStats, VideoCodec
from nova_studio.domain.media import (
    AssetKind,
    AudioStreamInfo,
    MediaAsset,
    MediaInfo,
    VideoStreamInfo,
)
from nova_studio.domain.persistence import CacheBudget, CacheEntry, derived_path
from nova_studio.domain.project import Project
from nova_studio.domain.timeline import Clip, Timeline, Track, TrackKind
from nova_studio.ports.imaging import Interpolation
from nova_studio.ports.jobs import JobErrorCode
from nova_studio.ports.media import MediaErrorCode
from nova_studio.services.media import (
    DEFAULT_THUMBNAIL_WIDTH,
    GenerationStage,
    ProxyJob,
    ThumbnailJob,
    proxy_job_spec,
    proxy_output_spec,
    proxy_requests,
    thumbnail_geometry,
    thumbnail_job_spec,
    thumbnail_requests,
)
from nova_studio.services.media.cache import MediaCache
from nova_studio.services.media.keys import kind_of
from nova_studio.services.media.proxy import DEFAULT_PROXY_POLICY
from tests.media.fake_decoder import FakeDecoder

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path

    from nova_studio.domain.media import FrameBuffer

pytestmark = pytest.mark.unit

RATE = Timebase(num=30, den=1)


# -- what the pretend files contain ------------------------------------------


def _video(
    *,
    width: int = 3840,
    height: int = 2160,
    codec_name: str = "h264",
    frame_count: int = 300,
    **over: Any,
) -> MediaInfo:
    """A 4K long-GOP clip: bigger than the preview needs *and* hostile to
    seeking, so the policy earns it a proxy on both counts."""
    return MediaInfo(
        kind=AssetKind.VIDEO,
        duration_seconds=10.0,
        video=(
            VideoStreamInfo(
                codec_name=codec_name,
                width=width,
                height=height,
                timebase=RATE,
                frame_count=frame_count,
                **over,
            ),
        ),
    )


def _audio_only() -> MediaInfo:
    return MediaInfo(
        kind=AssetKind.AUDIO,
        duration_seconds=10.0,
        audio=(AudioStreamInfo(codec_name="aac", sample_rate=48_000, channels=2),),
    )


# -- doubles -----------------------------------------------------------------


class FakeClock:
    """A clock that only moves when a test moves it, so that progress
    throttling is observable rather than incidental."""

    def __init__(self, now_ms: int = 1_000) -> None:
        self.now = now_ms

    def now_ms(self) -> int:
        return self.now

    def monotonic(self) -> float:
        return self.now / 1_000.0

    def advance(self, by_ms: int) -> None:
        self.now += by_ms


class FakeIndex:
    """The `CacheIndex` port, as a dictionary. Can refuse to write, on cue."""

    def __init__(self, *, fail_put: bool = False) -> None:
        self.rows: dict[str, CacheEntry] = {}
        self.removed: list[str] = []
        self.fail_put = fail_put

    def get(self, key: str) -> CacheEntry | None:
        return self.rows.get(key)

    def put(self, entry: CacheEntry) -> Result[None]:
        if self.fail_put:
            return err(NovaError("NS-PERSIST-5001", "the cache index is unavailable"))
        self.rows[entry.key] = entry
        return ok(None)

    def touch(self, key: str, *, at_ms: int) -> Result[None]:
        return ok(None)

    def remove(self, key: str) -> Result[None]:
        self.removed.append(key)
        self.rows.pop(key, None)
        return ok(None)

    def entries(self, kind: Any = None) -> tuple[CacheEntry, ...]:
        return tuple(self.rows.values())

    def total_bytes(self) -> int:
        return sum(entry.size_bytes for entry in self.rows.values())

    def close(self) -> None:
        return None


class FakeDisk:
    """The two answers the cache needs about a filesystem."""

    def __init__(self, *paths: str) -> None:
        self.there = set(paths)
        self.deleted: list[str] = []

    def exists(self, path: str) -> bool:
        return path in self.there

    def unlink(self, path: str) -> None:
        self.deleted.append(path)
        self.there.discard(path)


class FakeOps:
    """The imaging port, as a resizer that remembers what it was asked for.

    It returns `uint8`, which is what OpenCV does and what `FrameBuffer`
    demands: a resampler that changed the dtype would be a difference between
    the test double and the adapter it stands in for, and the point of a double
    is that there is none.
    """

    def __init__(self) -> None:
        self.sizes: list[tuple[int, int]] = []
        self.modes: list[Interpolation] = []

    def resize(
        self,
        pixels: Any,
        size: tuple[int, int],
        *,
        interpolation: Interpolation = Interpolation.LINEAR,
    ) -> Any:
        self.sizes.append(size)
        self.modes.append(interpolation)
        return np.zeros((size[1], size[0], 3), dtype=np.uint8)


class FakeSink:
    """A `FrameSink` that records what it was handed, and can fail on cue."""

    def __init__(self, *, fail_at: int | None = None) -> None:
        self.frames: list[FrameBuffer] = []
        self.fail_at = fail_at
        self.aborted = False

    def write(self, frame: FrameBuffer) -> Result[None]:
        if self.fail_at is not None and len(self.frames) >= self.fail_at:
            return err(NovaError("NS-RENDER-4003", "the encoder rejected this frame"))
        self.frames.append(frame)
        return ok(None)

    def finish(self) -> Result[RenderStats]:
        return ok(
            RenderStats(
                frames_written=len(self.frames),
                bytes_written=len(self.frames) * 4_096,
                elapsed_ms=10,
            )
        )

    def abort(self) -> None:
        self.aborted = True


class FakeTarget:
    """A `RenderTarget` around one sink. No audio: a proxy is video-only."""

    def __init__(self, sink: FakeSink) -> None:
        self.sink = sink
        self.aborted = False
        self.finished = False

    def video(self) -> Any:
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
        self.opened: list[tuple[Any, str]] = []

    def open(self, spec: Any, path: str) -> Result[Any]:
        self.opened.append((spec, path))
        if self.error is not None:
            return err(self.error)
        return ok(self.target)


class FakeContext:
    """A `JobContext` that records what a job said, and can be told to stop it."""

    def __init__(self, spec: Any = None) -> None:
        self.job_id = "j-1"
        self.spec = spec or proxy_job_spec()
        self.reports: list[Any] = []
        self.checkpoints: list[dict[str, object]] = []
        self.cancelled = False

    def is_cancelled(self) -> bool:
        return self.cancelled

    def report(self, progress: Any) -> None:
        self.reports.append(progress)

    def checkpoint(self, state: Any) -> None:
        self.checkpoints.append(dict(state))

    def heartbeat(self) -> None:
        return None

    def stop(self) -> None:
        """What an executor does when the user presses cancel."""
        self.cancelled = True

    @property
    def stages(self) -> list[str]:
        return [report.stage for report in self.reports]


class StillStore:
    """Where the fake still sink writes: a dictionary of path → width."""

    def __init__(self, *, fail_on: str | None = None) -> None:
        self.files: dict[str, int] = {}
        self.fail_on = fail_on

    def __call__(self, frame: FrameBuffer, path: str) -> Result[int]:
        if self.fail_on is not None and path == self.fail_on:
            return err(NovaError("NS-RENDER-4001", "the destination is read-only"))
        self.files[path] = int(frame.pixels.shape[1])
        return ok(1_024)


# -- building the things under test ------------------------------------------


def cache_in(
    root: Path,
    *,
    files: tuple[str, ...] = (),
    fail_put: bool = False,
) -> tuple[MediaCache, FakeIndex, FakeDisk]:
    """A real `MediaCache` over a dict, a set and a frozen clock."""
    index = FakeIndex(fail_put=fail_put)
    disk = FakeDisk(*files)
    cache = MediaCache(
        index=index,  # type: ignore[arg-type]
        root=root,
        clock=FakeClock(),  # type: ignore[arg-type]
        exists=disk.exists,
        unlink=disk.unlink,
        policy=DEFAULT_PROXY_POLICY,
    )
    return cache, index, disk


def project_with(*assets: MediaAsset, clips: tuple[Clip, ...] = ()) -> Project:
    return Project(
        project_id=EntityId("p1"),
        name="Demo",
        assets=assets,
        timeline=Timeline.of(
            Track(track_id="v1", kind=TrackKind.VIDEO, clips=clips),
            timebase=RATE,
        ),
    )


def asset(asset_id: str, probe: MediaInfo | None = None) -> MediaAsset:
    return MediaAsset(
        EntityId(asset_id),
        f"/media/{asset_id}.mp4",
        AssetKind.VIDEO,
        probe=_video() if probe is None else probe,
    )


def cut(*assets: MediaAsset, asset_ids: tuple[str, ...] = ("a1",)) -> Project:
    """A project whose one video track holds one clip of each named asset."""
    clips = tuple(
        Clip.of(f"c{index}", asset_id, source_frames=300)
        for index, asset_id in enumerate(asset_ids, start=1)
    )
    return project_with(*assets, clips=clips)


def row_for(key: str, *, size_bytes: int = 4_096) -> CacheEntry:
    return CacheEntry(
        key=key,
        kind=kind_of(key),
        size_bytes=size_bytes,
        created_ms=1_000,
        last_used_ms=1_000,
    )


# -- module-level factories, so a job body stays picklable -------------------


def _decoder_with(path: str, **over: Any) -> FakeDecoder:
    return FakeDecoder().with_file(path, **over)


def _renderer_with(sink: FakeSink) -> FakeRenderer:
    return FakeRenderer(sink)


def _renderer_refusing(error: NovaError) -> FakeRenderer:
    return FakeRenderer(error=error)


def _still(store: StillStore) -> Callable[[FrameBuffer, str], Result[int]]:
    return store


def _cache(cache: MediaCache) -> MediaCache:
    return cache


def _nothing_is_there(_path: str) -> bool:
    return False


def _nothing_to_delete(_path: str) -> None:
    return None


# -- planning: proxies -------------------------------------------------------


class TestProxyPlanning:
    """Which proxies are worth making, and which are already made."""

    def test_a_4k_clip_on_the_timeline_earns_one(self, tmp_path: Path) -> None:
        cache, _index, _disk = cache_in(tmp_path)
        request = proxy_requests(cut(asset("a1")), cache=cache)[0]
        assert request.asset_id == "a1"
        assert request.source == "/media/a1.mp4"
        assert request.size == (1280, 720)

    def test_the_destination_is_where_the_cache_says_it_is(self, tmp_path: Path) -> None:
        cache, _index, _disk = cache_in(tmp_path)
        request = proxy_requests(cut(asset("a1")), cache=cache)[0]
        assert request.destination == str(cache.path_for(request.key))

    def test_a_clip_that_is_not_on_the_timeline_earns_none(self, tmp_path: Path) -> None:
        """Importing two hundred files must not queue two hundred transcodes."""
        cache, _index, _disk = cache_in(tmp_path)
        assert proxy_requests(project_with(asset("a1")), cache=cache) == ()

    def test_a_proxy_we_already_hold_is_not_planned_again(self, tmp_path: Path) -> None:
        """Idempotence, which is what makes a retry after a lost worker safe."""
        cache, index, disk = cache_in(tmp_path)
        project = cut(asset("a1"))
        first = proxy_requests(project, cache=cache)[0]
        index.put(row_for(first.key))
        disk.there.add(first.destination)
        assert proxy_requests(project, cache=cache) == ()

    def test_an_unprobed_asset_is_left_alone(self, tmp_path: Path) -> None:
        """No probe, no target size, therefore no key — asking anyway would
        create a cache entry nobody could ever find again."""
        cache, _index, _disk = cache_in(tmp_path)
        unprobed = MediaAsset(EntityId("a1"), "/media/a1.mp4", AssetKind.VIDEO)
        assert proxy_requests(cut(unprobed), cache=cache) == ()

    def test_an_audio_only_asset_earns_none(self, tmp_path: Path) -> None:
        cache, _index, _disk = cache_in(tmp_path)
        project = cut(asset("a1", probe=_audio_only()))
        assert proxy_requests(project, cache=cache) == ()

    def test_a_small_edit_friendly_clip_earns_none(self, tmp_path: Path) -> None:
        """ProRes at 720p is already what a proxy would be."""
        cache, _index, _disk = cache_in(tmp_path)
        project = cut(asset("a1", probe=_video(width=1280, height=720, codec_name="prores")))
        assert proxy_requests(project, cache=cache) == ()

    def test_a_clip_whose_asset_is_not_in_the_project_is_skipped(self, tmp_path: Path) -> None:
        cache, _index, _disk = cache_in(tmp_path)
        assert proxy_requests(cut(asset("a1"), asset_ids=("ghost",)), cache=cache) == ()

    def test_two_clips_of_one_asset_earn_one_proxy(self, tmp_path: Path) -> None:
        cache, _index, _disk = cache_in(tmp_path)
        project = project_with(
            asset("a1"),
            clips=(
                Clip.of("c1", "a1", source_frames=100),
                Clip.of("c2", "a1", start_frame=100, source_frames=100),
            ),
        )
        assert len(proxy_requests(project, cache=cache)) == 1

    def test_two_assets_earn_two(self, tmp_path: Path) -> None:
        cache, _index, _disk = cache_in(tmp_path)
        project = cut(asset("a1"), asset("a2"), asset_ids=("a1", "a2"))
        assert len(proxy_requests(project, cache=cache)) == 2


class TestTheProxySpec:
    """What a proxy is encoded as."""

    def test_it_is_matroska_h264_at_the_planned_size(self) -> None:
        plan = DEFAULT_PROXY_POLICY.plan(_video())
        spec = proxy_output_spec(_video(), plan)
        assert spec.container is ContainerFormat.MKV
        assert spec.video.codec is VideoCodec.H264
        assert (spec.video.width, spec.video.height) == (plan.target_width, plan.target_height)

    def test_the_timebase_is_the_sources(self) -> None:
        """A proxy is frame-for-frame the same clip; a different rate is a
        retime nobody asked for."""
        info = _video()
        assert proxy_output_spec(info, plan=DEFAULT_PROXY_POLICY.plan(info)).video.timebase == RATE

    def test_the_gop_is_half_a_second_of_the_source(self) -> None:
        """Not all-intra: an all-intra proxy is larger than its source."""
        info = _video()
        assert proxy_output_spec(info, DEFAULT_PROXY_POLICY.plan(info)).video.gop_size == 15

    def test_a_file_with_no_video_stream_is_refused(self) -> None:
        info = _audio_only()
        with pytest.raises(NovaInvariantError, match="no video stream"):
            proxy_output_spec(info, DEFAULT_PROXY_POLICY.plan(info))

    def test_the_job_declaration_says_process_and_idempotent(self) -> None:
        spec = proxy_job_spec()
        assert spec.kind == "media.proxy"
        assert spec.isolation.value == "process"
        assert spec.idempotent
        assert spec.cancellable

    def test_a_dedupe_key_collapses_identical_requests(self) -> None:
        """Twenty panels asking for the same clip share one transcode."""
        assert proxy_job_spec(dedupe_key="proxy:a1").dedupe_key == "proxy:a1"


# -- planning: thumbnails ----------------------------------------------------


class TestThumbnailPlanning:
    """Which stills the project needs."""

    def test_a_clip_asks_for_a_strip(self, tmp_path: Path) -> None:
        cache, _index, _disk = cache_in(tmp_path)
        requests = thumbnail_requests(project_with(asset("a1")), cache=cache)
        assert [request.frame for request in requests] == [0, 37, 75, 112, 150, 187, 225, 262]

    def test_the_key_names_the_requested_frame(self, tmp_path: Path) -> None:
        """Not the snapped one: the snap is a property of the file, and the key
        must be a pure function of what the strip asked for."""
        cache, _index, _disk = cache_in(tmp_path)
        request = thumbnail_requests(project_with(asset("a1")), cache=cache)[1]
        assert request.key.endswith(f"-f{request.frame}-w{request.width}.jpg")

    def test_the_geometry_follows_the_source(self, tmp_path: Path) -> None:
        cache, _index, _disk = cache_in(tmp_path)
        request = thumbnail_requests(project_with(asset("a1")), cache=cache)[0]
        assert (request.width, request.height) == (DEFAULT_THUMBNAIL_WIDTH, 180)

    def test_a_thumbnail_we_hold_is_not_planned_again(self, tmp_path: Path) -> None:
        cache, index, disk = cache_in(tmp_path)
        project = project_with(asset("a1"))
        for request in thumbnail_requests(project, cache=cache):
            index.put(row_for(request.key, size_bytes=1_024))
            disk.there.add(request.destination)
        assert thumbnail_requests(project, cache=cache) == ()

    def test_an_asset_with_no_probe_is_skipped(self, tmp_path: Path) -> None:
        cache, _index, _disk = cache_in(tmp_path)
        unprobed = MediaAsset(EntityId("a1"), "/media/a1.mp4", AssetKind.VIDEO)
        assert thumbnail_requests(project_with(unprobed), cache=cache) == ()

    def test_an_asset_with_no_video_stream_is_skipped(self, tmp_path: Path) -> None:
        cache, _index, _disk = cache_in(tmp_path)
        project = project_with(asset("a1", probe=_audio_only()))
        assert thumbnail_requests(project, cache=cache) == ()

    def test_a_file_that_does_not_report_a_length_is_skipped(self, tmp_path: Path) -> None:
        """An unknown frame count stays unknown rather than being guessed from a
        bitrate (§7.5), so there is nothing to spread a strip over."""
        cache, _index, _disk = cache_in(tmp_path)
        project = project_with(asset("a1", probe=_video(frame_count=0)))
        assert thumbnail_requests(project, cache=cache) == ()

    def test_a_strip_longer_than_the_clip_is_shortened(self, tmp_path: Path) -> None:
        cache, _index, _disk = cache_in(tmp_path)
        project = project_with(asset("a1", probe=_video(frame_count=3)))
        assert len(thumbnail_requests(project, cache=cache)) == 3

    def test_thumbnails_are_planned_for_assets_off_the_timeline(self, tmp_path: Path) -> None:
        """The media bin lists everything, and eight decodes of a file that is
        never cut cost less than the probe that found it."""
        cache, _index, _disk = cache_in(tmp_path)
        assert len(thumbnail_requests(project_with(asset("a1")), cache=cache)) == 8

    def test_a_narrower_strip_asks_for_fewer(self, tmp_path: Path) -> None:
        cache, _index, _disk = cache_in(tmp_path)
        requests = thumbnail_requests(project_with(asset("a1")), cache=cache, count=3)
        assert [request.frame for request in requests] == [0, 100, 200]


class TestThumbnailGeometry:
    """The shape of one still."""

    def test_the_display_aspect_is_what_is_preserved(self) -> None:
        """Anamorphic footage: 1440x1080 with a 4:3 sample aspect is 1920x1080
        on screen, and a thumbnail that came out stretched is worse than none —
        the user reads it as the truth about the frame."""
        stream = VideoStreamInfo(
            codec_name="h264",
            width=1440,
            height=1080,
            timebase=RATE,
            sample_aspect_ratio=Fraction(4, 3),
        )
        assert thumbnail_geometry(stream, 320) == (320, 180)

    @pytest.mark.parametrize("width", [2, 3, 319, 320, 321])
    def test_both_dimensions_come_out_even(self, width: int) -> None:
        geometry = thumbnail_geometry(_video().primary_video(), width)
        assert geometry[0] % 2 == 0
        assert geometry[1] % 2 == 0

    def test_a_tiny_geometry_is_still_two_pixels(self) -> None:
        assert thumbnail_geometry(_video().primary_video(), 2) == (2, 2)

    def test_a_width_below_two_is_a_bug_not_a_size(self) -> None:
        with pytest.raises(NovaInvariantError):
            thumbnail_geometry(_video().primary_video(), 1)


# -- the proxy job -----------------------------------------------------------


class TestTheProxyJob:
    """Transcoding one asset, and how it fails."""

    def _job(
        self,
        request: Any,
        *,
        cache: MediaCache,
        sink: FakeSink | None = None,
        decoder: FakeDecoder | None = None,
        renderer_error: NovaError | None = None,
        clock: FakeClock | None = None,
    ) -> ProxyJob:
        sink = sink or FakeSink()
        return ProxyJob(
            request=request,
            renderer_factory=partial(
                _renderer_refusing if renderer_error else _renderer_with,
                renderer_error or sink,
            ),
            ops_factory=FakeOps,
            decoder_factory=partial(_decoder_with, request.source)
            if decoder is None
            else lambda: decoder,
            cache_factory=partial(_cache, cache),
            clock_factory=(lambda: clock) if clock else FakeClock,
        )

    def test_every_frame_is_decoded_scaled_and_written(self, tmp_path: Path) -> None:
        cache, _index, _disk = cache_in(tmp_path)
        request = proxy_requests(cut(asset("a1")), cache=cache)[0]
        sink = FakeSink()

        outcome = self._job(request, cache=cache, sink=sink)(FakeContext())

        assert outcome.is_ok()
        assert len(sink.frames) == 30
        height, width, _channels = sink.frames[0].pixels.shape
        assert (width, height) == request.size
        assert outcome.unwrap().artefacts == (request.destination,)

    def test_the_transcode_shrinks_with_area_averaging(self, tmp_path: Path) -> None:
        """Bilinear on a 3x reduction aliases, and aliasing on a proxy is
        shimmer — a lie about the picture the user is judging."""
        cache, _index, _disk = cache_in(tmp_path)
        request = proxy_requests(cut(asset("a1")), cache=cache)[0]
        ops = FakeOps()

        ProxyJob(
            request=request,
            renderer_factory=partial(_renderer_with, FakeSink()),
            ops_factory=lambda: ops,
            decoder_factory=partial(_decoder_with, request.source),
            cache_factory=partial(_cache, cache),
            clock_factory=FakeClock,
        )(FakeContext())

        assert ops.modes == [Interpolation.AREA] * 30
        assert ops.sizes == [request.size] * 30

    def test_the_finished_file_is_recorded_in_the_cache(self, tmp_path: Path) -> None:
        """Only after `finish` promoted it: a row is a promise."""
        cache, index, _disk = cache_in(tmp_path)
        request = proxy_requests(cut(asset("a1")), cache=cache)[0]
        self._job(request, cache=cache)(FakeContext())
        assert index.rows[request.key].size_bytes == 30 * 4_096

    def test_the_job_reports_what_it_is_doing(self, tmp_path: Path) -> None:
        cache, _index, _disk = cache_in(tmp_path)
        request = proxy_requests(cut(asset("a1")), cache=cache)[0]
        context = FakeContext()
        self._job(request, cache=cache)(context)
        assert context.stages[0] == GenerationStage.PREPARING
        assert GenerationStage.TRANSCODING in context.stages
        assert context.stages[-1] == GenerationStage.DONE
        assert context.reports[-1].fraction == 1.0

    def test_progress_is_throttled(self, tmp_path: Path) -> None:
        """Thirty frames must not mean thirty reports: a transcode that spends
        itself formatting strings is a transcode that took longer."""
        cache, _index, _disk = cache_in(tmp_path)
        request = proxy_requests(cut(asset("a1")), cache=cache)[0]
        context = FakeContext()
        self._job(request, cache=cache)(context)
        assert len(context.reports) < 10

    def test_a_full_cache_is_trimmed_and_never_of_what_was_just_made(self, tmp_path: Path) -> None:
        """Admission is the moment to enforce the budget — and the artefact
        being admitted is exempt, or a job would delete its own work."""
        cache, index, disk = cache_in(tmp_path)
        request = proxy_requests(cut(asset("a1")), cache=cache)[0]
        stale = row_for("thumb-a9-f0-w320.jpg")
        index.put(stale)
        disk.there.add(str(derived_path(tmp_path, stale.kind, stale.key)))

        job = replace(self._job(request, cache=cache), budget=CacheBudget(max_bytes=1))
        outcome = job(FakeContext())

        assert outcome.is_ok(), outcome.unwrap_err()
        assert stale.key not in index.rows
        assert request.key in index.rows

    def test_a_file_that_will_not_open_leaves_nothing(self, tmp_path: Path) -> None:
        cache, index, _disk = cache_in(tmp_path)
        request = proxy_requests(cut(asset("a1")), cache=cache)[0]
        decoder = FakeDecoder()  # a file it does not have

        outcome = self._job(request, cache=cache, decoder=decoder)(FakeContext())

        assert outcome.is_err()
        assert outcome.unwrap_err().code == MediaErrorCode.UNREADABLE
        assert index.rows == {}

    def test_a_file_with_no_video_stream_is_refused(self, tmp_path: Path) -> None:
        cache, index, _disk = cache_in(tmp_path)
        request = proxy_requests(cut(asset("a1")), cache=cache)[0]
        decoder = FakeDecoder().with_file(request.source, video_streams=0)

        outcome = self._job(request, cache=cache, decoder=decoder)(FakeContext())

        assert outcome.is_err()
        assert outcome.unwrap_err().code == MediaErrorCode.UNSUPPORTED
        assert index.rows == {}

    def test_an_encoder_that_will_not_open_leaves_nothing(self, tmp_path: Path) -> None:
        cache, index, _disk = cache_in(tmp_path)
        request = proxy_requests(cut(asset("a1")), cache=cache)[0]

        outcome = self._job(
            request,
            cache=cache,
            renderer_error=NovaError("NS-MEDIA-4002", "no encoder for h264"),
        )(FakeContext())

        assert outcome.is_err()
        assert index.rows == {}

    def test_a_frame_the_encoder_rejects_aborts_the_target(self, tmp_path: Path) -> None:
        """The point of staging: a half-written proxy is not a proxy."""
        cache, index, _disk = cache_in(tmp_path)
        request = proxy_requests(cut(asset("a1")), cache=cache)[0]
        sink = FakeSink(fail_at=3)

        outcome = self._job(request, cache=cache, sink=sink)(FakeContext())

        assert outcome.is_err()
        assert sink.aborted
        assert index.rows == {}

    def test_a_stream_that_fails_midway_is_reported_as_a_decode_failure(
        self, tmp_path: Path
    ) -> None:
        """An iterator has no `Result` channel, so the failure is latched on the
        source and read once, after the loop."""
        cache, index, _disk = cache_in(tmp_path)
        request = proxy_requests(cut(asset("a1")), cache=cache)[0]
        decoder = FakeDecoder().with_file(request.source, frame_count=30, damaged_from=10)

        outcome = self._job(request, cache=cache, decoder=decoder)(FakeContext())

        assert outcome.is_err()
        assert outcome.unwrap_err().code == MediaErrorCode.DECODE_FAILED
        assert index.rows == {}

    def test_cancelling_stops_between_frames_and_aborts(self, tmp_path: Path) -> None:
        cache, index, _disk = cache_in(tmp_path)
        request = proxy_requests(cut(asset("a1")), cache=cache)[0]
        sink = FakeSink()
        context = FakeContext()
        context.stop()

        outcome = self._job(request, cache=cache, sink=sink)(context)

        assert outcome.is_err()
        assert outcome.unwrap_err().code == JobErrorCode.CANCELLED
        assert sink.aborted
        assert index.rows == {}

    def test_a_cache_that_will_not_record_takes_the_bytes_with_it(self, tmp_path: Path) -> None:
        """A complete file no row names is disk eviction will never reclaim, so
        a failed job deletes what it made."""
        planning, _index, _disk = cache_in(tmp_path)
        request = proxy_requests(cut(asset("a1")), cache=planning)[0]
        failing, index, disk = cache_in(tmp_path, fail_put=True)

        outcome = self._job(request, cache=failing)(FakeContext())

        assert outcome.is_err()
        assert disk.deleted == [request.destination]
        assert index.rows == {}

    def test_the_decoder_is_closed_even_when_the_encode_fails(self, tmp_path: Path) -> None:
        """A decoder holds memory the OS will not reclaim for us."""
        cache, _index, _disk = cache_in(tmp_path)
        request = proxy_requests(cut(asset("a1")), cache=cache)[0]
        decoder = FakeDecoder().with_file(request.source)

        self._job(request, cache=cache, sink=FakeSink(fail_at=1), decoder=decoder)(FakeContext())

        assert decoder.opened
        assert all(media.is_closed for media in decoder.opened)

    def test_the_body_is_picklable(self, tmp_path: Path) -> None:
        """A proxy runs in a worker process, and Windows `spawn` pickles the
        body — so every collaborator is a factory, and nothing is a closure."""
        cache, _index, _disk = cache_in(tmp_path)
        request = proxy_requests(cut(asset("a1")), cache=cache)[0]
        job = ProxyJob(
            request=request,
            renderer_factory=partial(_renderer_with, FakeSink()),
            ops_factory=FakeOps,
            decoder_factory=partial(_decoder_with, request.source),
            cache_factory=partial(_cache, cache),
            clock_factory=FakeClock,
        )
        assert pickle.loads(pickle.dumps(job)).request == request


# -- the thumbnail job -------------------------------------------------------


class TestTheThumbnailJob:
    """Decoding stills, and how that fails."""

    def _job(
        self,
        requests: tuple[Any, ...],
        *,
        cache: MediaCache,
        store: StillStore | None = None,
        decoder: FakeDecoder | None = None,
        clock: FakeClock | None = None,
    ) -> ThumbnailJob:
        source = requests[0].source
        return ThumbnailJob(
            asset_id=requests[0].asset_id,
            source=source,
            requests=requests,
            decoder_factory=(lambda: decoder)
            if decoder is not None
            else partial(_decoder_with, source, frame_count=300, keyframes=(0, 10, 20)),
            ops_factory=FakeOps,
            still_factory=partial(_still, store if store is not None else StillStore()),
            cache_factory=partial(_cache, cache),
            clock_factory=(lambda: clock) if clock else FakeClock,
        )

    def test_every_request_is_written_and_recorded(self, tmp_path: Path) -> None:
        cache, index, _disk = cache_in(tmp_path)
        requests = thumbnail_requests(project_with(asset("a1")), cache=cache)
        store = StillStore()
        outcome = self._job(requests, cache=cache, store=store)(FakeContext())

        assert outcome.is_ok()
        assert len(store.files) == 8
        assert set(index.rows) == {request.key for request in requests}
        assert outcome.unwrap().artefacts == tuple(request.destination for request in requests)

    def test_a_full_cache_is_trimmed_once_the_last_still_lands(self, tmp_path: Path) -> None:
        """Once per strip, not once per picture: eight passes to admit eight
        JPEGs would be eight times the work for the same outcome."""
        cache, index, disk = cache_in(tmp_path)
        requests = thumbnail_requests(project_with(asset("a1")), cache=cache)
        stale = row_for("proxy-a9-h720.mkv", size_bytes=8 * 1_048_576)
        index.put(stale)
        disk.there.add(str(derived_path(tmp_path, stale.kind, stale.key)))

        job = replace(self._job(requests, cache=cache), budget=CacheBudget(max_bytes=1))
        outcome = job(FakeContext())

        assert outcome.is_ok(), outcome.unwrap_err()
        assert stale.key not in index.rows
        assert set(index.rows) == {request.key for request in requests}

    def test_a_still_is_snapped_back_to_a_keyframe(self, tmp_path: Path) -> None:
        """A sparse seek into long-GOP footage costs a whole group of pictures;
        at thumbnail scale frame 20 stands in for frame 37 exactly."""
        cache, _index, _disk = cache_in(tmp_path)
        requests = tuple(
            request
            for request in thumbnail_requests(project_with(asset("a1")), cache=cache)
            if request.frame == 37
        )
        decoder = FakeDecoder().with_file(
            requests[0].source, frame_count=300, keyframes=(0, 10, 20, 40)
        )
        store = StillStore()

        self._job(requests, cache=cache, store=store, decoder=decoder)(FakeContext())

        # One seek, and the picture is the keyframe it landed on.
        assert decoder.total_seeks == 1
        assert store.files[requests[0].destination] == requests[0].width

    def test_the_key_still_names_the_frame_the_strip_asked_for(self, tmp_path: Path) -> None:
        """The snap is an optimisation, not a rename: the same strip asks for the
        same names after a reopen, whatever the decoder found."""
        cache, _index, _disk = cache_in(tmp_path)
        request = thumbnail_requests(project_with(asset("a1")), cache=cache)[1]
        assert request.frame == 37
        assert request.key.endswith("-f37-w320.jpg")

    def test_a_frame_that_will_not_decode_is_reported(self, tmp_path: Path) -> None:
        cache, index, _disk = cache_in(tmp_path)
        requests = thumbnail_requests(project_with(asset("a1")), cache=cache)
        decoder = FakeDecoder().with_file(requests[0].source, frame_count=300, damaged_from=0)

        outcome = self._job(requests, cache=cache, decoder=decoder)(FakeContext())

        assert outcome.is_err()
        assert outcome.unwrap_err().code == MediaErrorCode.DECODE_FAILED
        assert index.rows == {}

    def test_a_destination_that_cannot_be_written_stops_the_job(self, tmp_path: Path) -> None:
        """The still sink renames into place, so nothing was half-written; the
        job simply stops where it stopped."""
        cache, index, _disk = cache_in(tmp_path)
        requests = thumbnail_requests(project_with(asset("a1")), cache=cache)
        store = StillStore(fail_on=requests[0].destination)

        outcome = self._job(requests, cache=cache, store=store)(FakeContext())

        assert outcome.is_err()
        assert index.rows == {}

    def test_cancelling_stops_between_stills(self, tmp_path: Path) -> None:
        cache, index, _disk = cache_in(tmp_path)
        requests = thumbnail_requests(project_with(asset("a1")), cache=cache)
        context = FakeContext()
        context.stop()

        outcome = self._job(requests, cache=cache)(context)

        assert outcome.is_err()
        assert outcome.unwrap_err().code == JobErrorCode.CANCELLED
        assert index.rows == {}

    def test_five_stills_that_landed_before_a_failure_are_five_the_panel_can_show(
        self, tmp_path: Path
    ) -> None:
        """Recording as we go is the whole argument for it."""
        cache, index, _disk = cache_in(tmp_path)
        requests = thumbnail_requests(project_with(asset("a1")), cache=cache)
        store = StillStore(fail_on=requests[5].destination)

        self._job(requests, cache=cache, store=store)(FakeContext())

        assert len(index.rows) == 5

    def test_a_cache_that_will_not_record_deletes_the_still(self, tmp_path: Path) -> None:
        cache, index, disk = cache_in(tmp_path, fail_put=True)
        requests = thumbnail_requests(project_with(asset("a1")), cache=cache)

        outcome = self._job(requests, cache=cache)(FakeContext())

        assert outcome.is_err()
        assert disk.deleted == [requests[0].destination]
        assert index.rows == {}

    def test_the_decoder_is_closed_even_when_a_still_fails(self, tmp_path: Path) -> None:
        cache, _index, _disk = cache_in(tmp_path)
        requests = thumbnail_requests(project_with(asset("a1")), cache=cache)
        decoder = FakeDecoder().with_file(requests[0].source, frame_count=300)
        store = StillStore(fail_on=requests[0].destination)

        self._job(requests, cache=cache, store=store, decoder=decoder)(FakeContext())

        assert all(media.is_closed for media in decoder.opened)

    def test_the_job_declaration_says_thread(self) -> None:
        """Eight seeks and eight JPEGs is milliseconds; a process would cost
        more than the job."""
        spec = thumbnail_job_spec()
        assert spec.kind == "media.thumbnail"
        assert spec.isolation.value == "thread"
        assert spec.idempotent

    def test_the_body_is_picklable(self, tmp_path: Path) -> None:
        cache, _index, _disk = cache_in(tmp_path)
        requests = thumbnail_requests(project_with(asset("a1")), cache=cache)
        job = ThumbnailJob(
            asset_id="a1",
            source=requests[0].source,
            requests=requests,
            decoder_factory=partial(_decoder_with, requests[0].source, frame_count=300),
            ops_factory=FakeOps,
            still_factory=partial(_still, StillStore()),
            cache_factory=partial(_cache, cache),
            clock_factory=FakeClock,
        )
        assert pickle.loads(pickle.dumps(job)).requests == requests
