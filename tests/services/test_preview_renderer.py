"""The preview renderer (`PreviewRenderer`, `services/render/preview.py`).

The *geometry* — fit, contain, even dimensions — is pinned next door in
`test_render_preview.py`; what is tested here is the object that uses it to put
a frame on a wire.

§7.2 promises that **preview and export use the same code path**, and this
module is where that promise is held to: the renderer composites with
:func:`~nova_studio.services.render.composite.composite_frame`, which is the
function :func:`~nova_studio.services.render.loop.render_frames` drives. A
preview that took a shortcut would eventually disagree with the exported file,
and the disagreement would be found by a user, on a deadline, in the render.

What is pinned here is the half that is *not* the composite:

* **A preview is scaled down, never up.** Pixels above 1:1 are not information,
  and a panel that asked for more of them would pay for interpolation while
  telling the user something false about the sharpness of their timeline.
* **A missing asset is a gap, not a failure.** The frame is drawn without the
  layer and the asset id is reported, because a panel that returned an error
  would hide the nineteen clips that are fine. This is ADR-0015 rule 3 at the
  point where it costs something.
* **Warming is a batch, and the batch costs one seek.** Ten warmed frames of one
  clip is one seek, not ten. It is the same invariant the loop asserts, and it
  is the only way to catch a renderer that plans out of order.
* **Invalidation drops pictures and keeps decoders.** An edit changes the
  timeline, not the files; clearing both would reopen every clip on the first
  frame after every keystroke.

The decoder is the seek-counting fake from ``tests/media/``, and the encoder is
the real OpenCV one: together they pin the seam without needing FFmpeg.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import cv2
import numpy as np
import pytest

from nova_studio.core.ident import EntityId
from nova_studio.core.temporal import Timebase
from nova_studio.domain.media import AssetKind, MediaAsset
from nova_studio.domain.project import FrameSize, Project, ProjectSettings
from nova_studio.domain.timeline import Clip, Timeline, Track, TrackKind
from nova_studio.infra.imaging import OpenCVImageOps
from nova_studio.infra.preview import FrameFormat, encode_frame, encoder_for
from nova_studio.services.render import (
    PreviewRenderer,
    Viewport,
    resolve_asset,
)

if TYPE_CHECKING:
    from nova_studio.core.result import Result
    from nova_studio.domain.media import FrameBuffer

pytestmark = pytest.mark.unit

WIDTH, HEIGHT = 8, 6
OPS = OpenCVImageOps()
JPEG = encoder_for(FrameFormat.JPEG, quality=95)


def _project(*clips: Clip, assets: tuple[MediaAsset, ...] = ()) -> Project:
    """A project holding the given clips on one video track."""
    return Project(
        project_id=EntityId("p1"),
        name="Demo",
        settings=ProjectSettings(frame_size=FrameSize(width=WIDTH, height=HEIGHT)),
        timeline=Timeline.of(
            Track(track_id="v1", kind=TrackKind.VIDEO, clips=clips),
            timebase=Timebase(num=30, den=1),
        ),
        assets=assets,
    )


def _clip(clip_id: str = "c1", *, asset_id: str = "a1", start: int = 0, length: int = 30) -> Clip:
    return Clip.of(clip_id, asset_id, start_frame=start, source_frames=length)


def _asset(asset_id: str = "a1", path: str = "a1.mp4") -> MediaAsset:
    return MediaAsset(EntityId(asset_id), path, AssetKind.VIDEO)


def _resolver(*assets: str) -> Any:
    """``(asset_id, source) -> path`` for the assets that "exist"."""

    def resolve(asset_id: str, source: str) -> str | None:
        del source
        return f"{asset_id}.mp4" if asset_id in assets else None

    return resolve


def _decoder() -> Any:
    from tests.media.fake_decoder import FakeClip, FakeDecoder

    return FakeDecoder({"a1.mp4": FakeClip(frame_count=30)})


def _renderer(*assets: str, **kwargs: Any) -> PreviewRenderer:
    """A renderer whose bin holds the given assets, and only those."""
    return PreviewRenderer(
        decoder=_decoder(),
        resolve=_resolver(*assets),
        ops=OPS,
        encode=JPEG,
        **kwargs,
    )


def _decode(image: bytes) -> Any:
    """An encoded preview frame back into an array, the way a browser would."""
    pixels = cv2.imdecode(np.frombuffer(image, dtype=np.uint8), cv2.IMREAD_COLOR)
    assert pixels is not None, "the preview did not encode a decodable image"
    return pixels


class TestTheGeometry:
    """What the picture is sized to, and where it goes."""

    def test_a_frame_that_fits_exactly_is_untouched(self) -> None:
        with _renderer("a1") as renderer:
            framed = renderer.frame(
                _project(_clip()), 0, viewport=Viewport(width=WIDTH, height=HEIGHT)
            )
        assert framed.is_ok() is True
        picture = framed.unwrap()
        assert (picture.width, picture.height) == (WIDTH, HEIGHT)
        assert _decode(picture.image).shape == (HEIGHT, WIDTH, 3)

    def test_a_large_panel_gets_the_project_size_not_more(self) -> None:
        """Never upscaled: pixels above 1:1 are not information."""
        with _renderer("a1") as renderer:
            framed = renderer.frame(
                _project(_clip()), 0, viewport=Viewport(width=1920, height=1080)
            )
        assert framed.is_ok() is True
        picture = framed.unwrap()
        assert (picture.width, picture.height) == (WIDTH, HEIGHT)
        assert _decode(picture.image).shape == (HEIGHT, WIDTH, 3)

    def test_a_panel_larger_than_the_frame_still_gets_a_fitted_plan(self) -> None:
        """The plan scales the *blit*, not the pixels the server sends."""
        with _renderer("a1") as renderer:
            framed = renderer.frame(_project(_clip()), 0, viewport=Viewport(width=16, height=9))
        plan = framed.unwrap().plan
        assert plan.scale == 1.0
        assert plan.offset == (4, 1)  # the frame, centred in a 16x9 panel

    def test_a_small_panel_gets_a_smaller_picture(self) -> None:
        """Downscaled, and in even numbers: chroma subsampling needs pairs."""
        with _renderer("a1") as renderer:
            framed = renderer.frame(_project(_clip()), 0, viewport=Viewport(width=4, height=3))
        assert framed.is_ok() is True
        picture = framed.unwrap()
        assert (picture.width, picture.height) == (4, 2)
        assert _decode(picture.image).shape == (2, 4, 3)

    def test_zoom_buys_pixels_up_to_the_project_size(self) -> None:
        """A zoomed panel is asking for detail, and there is detail to give."""
        with _renderer("a1") as renderer:
            flat = renderer.frame(_project(_clip()), 0, viewport=Viewport(width=4, height=3))
            zoomed = renderer.frame(
                _project(_clip()), 0, viewport=Viewport(width=4, height=3), zoom=2.0
            )
        assert flat.unwrap().plan.scale == 0.5
        assert zoomed.unwrap().plan.scale == 1.0
        assert (flat.unwrap().width, flat.unwrap().height) == (4, 2)
        assert (zoomed.unwrap().width, zoomed.unwrap().height) == (WIDTH, HEIGHT)

    def test_zoom_past_native_size_does_not_invent_pixels(self) -> None:
        """The cap: a 4x zoom on an 8x6 project is still eight pixels wide."""
        with _renderer("a1") as renderer:
            framed = renderer.frame(
                _project(_clip()), 0, viewport=Viewport(width=4, height=3), zoom=4.0
            )
        picture = framed.unwrap()
        assert picture.plan.scale == 2.0  # the blit is twice the panel
        assert (picture.width, picture.height) == (WIDTH, HEIGHT)
        assert _decode(picture.image).shape == (HEIGHT, WIDTH, 3)


class TestThePicture:
    """That the frame drawn is the frame asked for."""

    def test_frame_n_carries_frame_n(self) -> None:
        with _renderer("a1") as renderer:
            framed = renderer.frame(
                _project(_clip()), 7, viewport=Viewport(width=WIDTH, height=HEIGHT)
            )
        assert framed.is_ok() is True
        # The fake paints frame n as a flat grey of n, and JPEG at q95 keeps a
        # flat field flat — so the centre pixel still identifies the frame.
        pixels = _decode(framed.unwrap().image)
        assert int(pixels[HEIGHT // 2, WIDTH // 2, 0]) in range(5, 10)

    def test_a_frame_before_the_first_clip_is_black(self) -> None:
        with _renderer("a1") as renderer:
            framed = renderer.frame(
                _project(_clip(start=10)),
                0,
                viewport=Viewport(width=WIDTH, height=HEIGHT),
            )
        assert framed.is_ok() is True
        assert int(_decode(framed.unwrap().image).max()) == 0

    def test_the_media_type_matches_the_bytes(self) -> None:
        with _renderer("a1") as renderer:
            framed = renderer.frame(
                _project(_clip()), 0, viewport=Viewport(width=WIDTH, height=HEIGHT)
            )
        picture = framed.unwrap()
        assert picture.media_type == "image/jpeg"
        assert picture.image[:2] == b"\xff\xd8"

    def test_an_empty_project_still_answers(self) -> None:
        """A new project has frames; they are black, and they are not errors."""
        with _renderer() as renderer:
            framed = renderer.frame(_project(), 0, viewport=Viewport(width=WIDTH, height=HEIGHT))
        assert framed.is_ok() is True
        assert framed.unwrap().is_complete is True


class TestGaps:
    """An offline asset is a hole in the frame, not a failure of the request."""

    def test_a_missing_asset_is_a_gap_and_the_frame_is_still_drawn(self) -> None:
        with _renderer() as renderer:  # nothing resolves
            framed = renderer.frame(
                _project(_clip()), 0, viewport=Viewport(width=WIDTH, height=HEIGHT)
            )
        assert framed.is_ok() is True
        picture = framed.unwrap()
        assert picture.gaps == ("a1",)
        assert picture.is_complete is False
        assert int(_decode(picture.image).max()) == 0

    def test_a_gap_is_reported_once_per_asset(self) -> None:
        """Two clips of one offline asset are one thing for the user to fix."""
        project = _project(_clip("c1"), _clip("c2", start=30))
        with _renderer() as renderer:
            framed = renderer.frame(project, 0, viewport=Viewport(width=WIDTH, height=HEIGHT))
        assert framed.unwrap().gaps == ("a1",)

    def test_a_complete_frame_has_no_gaps(self) -> None:
        with _renderer("a1") as renderer:
            framed = renderer.frame(
                _project(_clip()), 0, viewport=Viewport(width=WIDTH, height=HEIGHT)
            )
        assert framed.unwrap().gaps == ()
        assert framed.unwrap().is_complete is True

    def test_the_pool_says_which_assets_could_not_be_opened(self) -> None:
        with _renderer() as renderer:
            renderer.frame(_project(_clip()), 0, viewport=Viewport(width=WIDTH, height=HEIGHT))
            problems = renderer.errors()
        assert len(problems) == 1
        assert problems[0].details.get("asset_id") == "a1"


class TestWarming:
    def test_ten_frames_of_one_clip_cost_one_seek(self) -> None:
        """The invariant the pool exists for, seen through the renderer."""
        with _renderer("a1") as renderer:
            warmed = renderer.warm(_project(_clip()), 0, count=10, last_frame=30)
            seeks = renderer.stats.seeks
        assert warmed == 10
        assert seeks == 1

    def test_warming_at_the_end_of_a_timeline_does_nothing(self) -> None:
        with _renderer("a1") as renderer:
            assert renderer.warm(_project(_clip()), 30, count=10, last_frame=30) == 0
            assert renderer.warm(_project(_clip()), 31, count=10, last_frame=30) == 0

    def test_warming_without_a_last_frame_reads_the_count(self) -> None:
        with _renderer("a1") as renderer:
            assert renderer.warm(_project(_clip()), 0, count=4) == 4

    def test_count_defaults_to_the_renderers(self) -> None:
        with _renderer("a1", warm_count=3) as renderer:
            assert renderer.warm(_project(_clip()), 0, last_frame=30) == 3

    def test_warming_puts_pictures_in_the_cache(self) -> None:
        with _renderer("a1") as renderer:
            assert renderer.cached_bytes == 0
            renderer.warm(_project(_clip()), 0, count=5, last_frame=30)
            assert renderer.cached_bytes > 0


class TestInvalidation:
    def test_an_invalidated_cache_holds_nothing(self) -> None:
        with _renderer("a1") as renderer:
            renderer.warm(_project(_clip()), 0, count=5, last_frame=30)
            assert renderer.cached_bytes > 0
            renderer.invalidate()
            assert renderer.cached_bytes == 0

    def test_invalidation_keeps_the_decoders(self) -> None:
        """The files did not change; only the timeline did."""
        with _renderer("a1") as renderer:
            renderer.warm(_project(_clip()), 0, count=5, last_frame=30)
            open_before = renderer.open_sources
            renderer.invalidate()
            assert renderer.open_sources == open_before == 1

    def test_a_frame_after_invalidation_is_still_drawn(self) -> None:
        with _renderer("a1") as renderer:
            renderer.warm(_project(_clip()), 0, count=5, last_frame=30)
            renderer.invalidate()
            framed = renderer.frame(
                _project(_clip()), 3, viewport=Viewport(width=WIDTH, height=HEIGHT)
            )
        assert framed.is_ok() is True
        assert framed.unwrap().is_complete is True


class TestClosing:
    def test_the_context_manager_closes_the_pool(self) -> None:
        renderer = _renderer("a1")
        renderer.warm(_project(_clip()), 0, count=5, last_frame=30)
        assert renderer.open_sources == 1
        renderer.close()
        assert renderer.open_sources == 0
        assert renderer.cached_bytes == 0


class TestResolvingAssets:
    """Which file is decoded for one asset and one copy of it."""

    def test_the_original_is_the_path_on_the_asset(self) -> None:
        project = _project(_clip(), assets=(_asset("a1", "/media/clip.mp4"),))
        assert resolve_asset(project, "a1", "original") == "/media/clip.mp4"

    def test_a_proxy_is_not_there_yet(self) -> None:
        """Generating one is the media layer's job, not this feature's."""
        project = _project(_clip(), assets=(_asset("a1", "/media/clip.mp4"),))
        assert resolve_asset(project, "a1", "proxy") is None
        assert resolve_asset(project, "a1", "thumbnail") is None

    def test_an_unknown_asset_resolves_to_nothing(self) -> None:
        assert resolve_asset(_project(), "nope", "original") is None

    def test_an_empty_project_resolves_to_nothing(self) -> None:
        assert resolve_asset(_project(), "a1", "original") is None


class TestTheEncoder:
    """The contract the renderer depends on, at the bottom of the stack."""

    def test_a_frame_is_encoded(self) -> None:
        from nova_studio.domain.media import ColourMeta, FrameBuffer

        buffer = FrameBuffer(pixels=np.zeros((4, 4, 3), dtype=np.uint8), colour=ColourMeta())
        encoded: Result[bytes] = encode_frame(buffer)
        assert encoded.is_ok() is True
        assert encoded.unwrap()[:2] == b"\xff\xd8"

    def test_the_renderer_reports_an_encoder_failure(self) -> None:
        from nova_studio.core.errors import NovaError
        from nova_studio.core.result import err

        def refuse(buffer: FrameBuffer) -> Result[bytes]:
            del buffer
            return err(NovaError("NS-RENDER-4003", "the encoder refused"))

        renderer = PreviewRenderer(
            decoder=_decoder(), resolve=_resolver("a1"), ops=OPS, encode=refuse
        )
        framed = renderer.frame(_project(_clip()), 0, viewport=Viewport(width=WIDTH, height=HEIGHT))
        assert framed.is_err() is True
        assert framed.unwrap_err().code == "NS-RENDER-4003"
