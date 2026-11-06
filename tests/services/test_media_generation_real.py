"""`services/media/generation.py` against a real encoder.

The suite in `test_media_generation.py` is deliberately full of doubles, because
every interesting property of these two jobs is a decision and a decision is
testable without a disk. What a double cannot tell you is the one thing that
makes a proxy worth having: **that the file it wrote can be opened and decoded
again, frame for frame, by something that is not us.**

So this file runs the two jobs over a clip PyAV actually encoded, with the real
decoder, the real renderer and the real still sink — and then opens what came
out. Everything else about the jobs lives in the other suite; this one only
answers "is the artefact real".
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import pytest

from nova_studio.core.result import ok
from nova_studio.core.temporal import Timebase
from nova_studio.domain.media import AssetKind, MediaAsset, MediaInfo, VideoStreamInfo
from nova_studio.domain.project import Project
from nova_studio.domain.timeline import Clip, Timeline, Track, TrackKind

if TYPE_CHECKING:
    from pathlib import Path

pytestmark = pytest.mark.unit

RATE = Timebase(num=30, den=1)


def _project(source: Path, width: int, height: int, frame_count: int = 10) -> Project:
    """One clip of one asset, probed with the geometry we encoded."""
    probe = MediaInfo(
        kind=AssetKind.VIDEO,
        container_format="mp4",
        duration_seconds=frame_count / 30.0,
        video=(
            VideoStreamInfo(
                codec_name="h264",
                width=width,
                height=height,
                timebase=RATE,
                frame_count=frame_count,
            ),
        ),
    )
    return Project(
        project_id="p1",
        name="Demo",
        assets=(MediaAsset("a1", str(source), AssetKind.VIDEO, probe=probe),),
        timeline=Timeline.of(
            Track(
                track_id="v1",
                kind=TrackKind.VIDEO,
                clips=(Clip.of("c1", "a1", source_frames=frame_count),),
            ),
            timebase=RATE,
        ),
    )


class _Context:
    """A `JobContext` that keeps the reports so a failure can be read."""

    def __init__(self) -> None:
        self.job_id = "j-1"
        self.spec: Any = None
        self.reports: list[Any] = []

    def is_cancelled(self) -> bool:
        return False

    def report(self, progress: Any) -> None:
        self.reports.append(progress)

    def checkpoint(self, state: Any) -> None:
        return None

    def heartbeat(self) -> None:
        return None


class TestARealProxy:
    """The file a `ProxyJob` wrote, opened by PyAV."""

    def test_it_decodes_back_at_the_size_that_was_asked_for(self, tmp_path: Path) -> None:
        av = pytest.importorskip("av", reason="a real proxy needs a real encoder")
        from nova_studio.infra.imaging import OpenCVImageOps
        from nova_studio.infra.media import PyAVDecoder
        from nova_studio.infra.render import PyAVRenderer
        from nova_studio.services.media import ProxyJob, proxy_requests
        from nova_studio.services.media.cache import MediaCache
        from nova_studio.services.media.proxy import DEFAULT_PROXY_POLICY
        from tests.media.encoding import HEIGHT, WIDTH, write_video

        source = write_video(tmp_path / "clip.mp4")
        project = _project(source, WIDTH, HEIGHT)
        cache = MediaCache(
            index=_EmptyIndex(),
            root=tmp_path / "cache",
            clock=_Clock(),
            exists=lambda path: False,
            unlink=lambda path: None,
            policy=DEFAULT_PROXY_POLICY,
        )
        # The source is 4K and long-GOP in every build but the smallest; if the
        # policy says no, the test has nothing to prove, so it says so.
        requests = proxy_requests(project, cache=cache)
        if not requests:
            pytest.skip(f"the policy does not want a proxy for {WIDTH}x{HEIGHT}")

        request = requests[0]
        destination = tmp_path / "cache" / "proxy" / f"{request.key}"
        destination.parent.mkdir(parents=True, exist_ok=True)
        request = _retarget(request, str(destination))

        outcome = ProxyJob(
            request=request,
            renderer_factory=PyAVRenderer,
            ops_factory=OpenCVImageOps,
            decoder_factory=PyAVDecoder,
            cache_factory=lambda: cache,
        )(_Context())

        assert outcome.is_ok(), outcome.unwrap_err()
        assert destination.exists()
        assert destination.stat().st_size > 0

        with av.open(str(destination)) as container:
            stream = container.streams.video[0]
            assert (stream.codec_context.width, stream.codec_context.height) == request.size
            decoded = sum(1 for _ in container.decode(stream))
        assert decoded >= 5, f"only {decoded} frames came back out"


class TestRealThumbnails:
    """The stills a `ThumbnailJob` wrote, opened by OpenCV."""

    def test_every_still_is_a_readable_jpeg(self, tmp_path: Path) -> None:
        pytest.importorskip("cv2", reason="a real still needs a real encoder")
        import cv2

        from nova_studio.infra.imaging import OpenCVImageOps
        from nova_studio.infra.media import PyAVDecoder
        from nova_studio.infra.preview import still_sink
        from nova_studio.services.media import ThumbnailJob, thumbnail_requests
        from nova_studio.services.media.cache import MediaCache
        from tests.media.encoding import HEIGHT, WIDTH, write_video

        source = write_video(tmp_path / "clip.mp4")
        project = _project(source, WIDTH, HEIGHT)
        root = tmp_path / "cache"
        cache = MediaCache(
            index=_EmptyIndex(),
            root=root,
            clock=_Clock(),
            exists=lambda path: False,
            unlink=lambda path: None,
        )
        requests = tuple(
            _retarget_still(request, str(root / "thumbnail" / f"{request.key}"))
            for request in thumbnail_requests(project, cache=cache, count=3)
        )
        assert requests, "a ten-frame clip must ask for at least one thumbnail"

        outcome = ThumbnailJob(
            asset_id="a1",
            source=str(source),
            requests=requests,
            decoder_factory=PyAVDecoder,
            ops_factory=OpenCVImageOps,
            still_factory=lambda: still_sink(quality=80),
            cache_factory=lambda: cache,
        )(_Context())

        assert outcome.is_ok(), outcome.unwrap_err()
        for request in requests:
            path = request.destination
            assert _exists(path), f"{path} was not written"
            picture = cv2.imread(path)
            assert picture is not None, f"{path} is not a readable image"
            assert picture.shape[1] == request.width


# -- doubles -----------------------------------------------------------------


class _Clock:
    def now_ms(self) -> int:
        return 1_000

    def monotonic(self) -> float:
        return 1.0


class _EmptyIndex:
    """A `CacheIndex` that starts empty, so `has` is false and `record` is
    observable — which is what makes "the job recorded what it wrote" checkable
    without a database."""

    def __init__(self) -> None:
        self.rows: dict[str, Any] = {}

    def get(self, key: str) -> Any:
        return self.rows.get(key)

    def put(self, entry: Any) -> Any:
        self.rows[entry.key] = entry
        return ok(None)

    def touch(self, key: str, *, at_ms: int) -> Any:
        return ok(None)

    def remove(self, key: str) -> Any:
        return ok(None)

    def entries(self, kind: Any = None) -> tuple[Any, ...]:
        return ()

    def total_bytes(self) -> int:
        return 0

    def close(self) -> None:
        return None


def _retarget(request: Any, destination: str) -> Any:
    from dataclasses import replace

    return replace(request, destination=destination)


def _retarget_still(request: Any, destination: str) -> Any:
    from dataclasses import replace

    return replace(request, destination=destination)


def _exists(path: str) -> bool:
    from pathlib import Path

    return Path(path).exists()
