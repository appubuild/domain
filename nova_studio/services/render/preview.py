"""L3 — the preview: how big to draw it, and what to have ready.

A preview is the same recipe as an export (``frames.py``) drawn at a different
size, and the two facts this module exists to establish are the ones a preview
gets wrong when they are left to a UI widget:

1. **The size is derived, never guessed.**  :func:`fit_scale` is "contain" —
   the largest scale at which the whole frame fits the viewport — and it is
   capped at native, because rendering above 1:1 costs decode time and shows
   nothing the source has.  Zoom is a deliberate multiplier on top, so a user
   who asks for 200 % gets 200 % of *native*, not of whatever the panel happens
   to be this week.
2. **Both dimensions come out even.**  Every 4:2:0 encoder we ship requires it,
   and a preview that renders at 961×541 is a preview that cannot be recorded
   or scrubbing-cached without a second conversion.

The third thing here is the warm-up plan: :func:`warm_frames` answers "which
frames should already be decoded when the user presses play".  Prerendering
*forward* only is the rule — the user is moving forward, and frames behind the
playhead are the one kind of work that is guaranteed to have been wasted by the
time it finishes.

What is not here: **which file to decode.**  The scale this module computes is
exactly the input the media layer's proxy policy needs (§5), but features do not
import each other, so the caller takes :attr:`PreviewPlan.scale` and asks.  The
plan also carries the letterbox offset, because "fitted" means there are bars,
and a canvas widget that guesses where they go will be wrong by a pixel on
every odd-sized viewport.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Final, TypeAlias

from nova_studio.core.errors import NovaInvariantError
from nova_studio.core.result import err, ok
from nova_studio.domain.media import FrameBuffer
from nova_studio.services.render.frames import DECODE_FROM_ORIGINAL, plan_frame
from nova_studio.services.render.loop import SourcePlan, render_preview_frame
from nova_studio.services.render.pool import (
    DEFAULT_CACHE_BYTES,
    DEFAULT_OPEN_SOURCES,
    FrameSourcePool,
    PoolStats,
    SourceResolver,
)

if TYPE_CHECKING:
    from collections.abc import Callable

    from nova_studio.core.errors import NovaError
    from nova_studio.core.result import Result
    from nova_studio.domain.project import Project
    from nova_studio.ports.imaging import ImageOps
    from nova_studio.ports.media import MediaDecoder
    from nova_studio.services.render.kernels import KernelRegistry
    from nova_studio.services.render.loop import LutReader

__all__ = [
    "DEFAULT_WARM_COUNT",
    "FrameEncoder",
    "PreviewFrame",
    "PreviewPlan",
    "PreviewRenderer",
    "Viewport",
    "fit_scale",
    "plan_preview",
    "preview_size",
    "resolve_asset",
    "warm_frames",
]

#: How many frames to have decoded ahead of the playhead by default.  Chosen so
#: that a 60 fps playhead has a quarter second in hand at a plausible decode
#: rate, and small enough that a scrub does not queue a second of work it will
#: throw away.
DEFAULT_WARM_COUNT: Final[int] = 15


@dataclass(frozen=True, slots=True, kw_only=True)
class Viewport:
    """The pixels the preview panel has, in device pixels."""

    width: int
    height: int

    def __post_init__(self) -> None:
        if self.width <= 0 or self.height <= 0:
            raise NovaInvariantError(f"a viewport must be positive, got {self.width}x{self.height}")

    @property
    def aspect_ratio(self) -> float:
        """Width over height."""
        return self.width / self.height


@dataclass(frozen=True, slots=True, kw_only=True)
class PreviewPlan:
    """How to draw one frame of a preview."""

    frame: int
    #: The size to composite at, in preview pixels: ``(width, height)``.
    size: tuple[int, int]
    #: The scale factor that produced it: ``1.0`` is native.
    scale: float
    #: Where to blit the result, from the top-left of the viewport.  Positive
    #: means there are bars; **negative means the frame is bigger than the
    #: panel** — a zoomed-in preview is cropped, and the caller scrolls it.
    offset: tuple[int, int] = (0, 0)
    #: Frames to have decoded ahead of the playhead, nearest first.
    warm: tuple[int, ...] = ()

    @property
    def width(self) -> int:
        """Composited width, in preview pixels."""
        return self.size[0]

    @property
    def height(self) -> int:
        """Composited height, in preview pixels."""
        return self.size[1]

    @property
    def is_letterboxed(self) -> bool:
        """Whether the fit left bars: the frame's shape is not the panel's."""
        return any(offset > 0 for offset in self.offset)

    @property
    def is_cropped(self) -> bool:
        """Whether the frame is bigger than the panel, as when zoomed in."""
        return any(offset < 0 for offset in self.offset)


def fit_scale(source_width: int, source_height: int, viewport: Viewport) -> float:
    """The largest scale at which the whole source fits the viewport, capped at 1.

    "Contain", not "cover": a preview that crops a corner is a preview that
    hides a mistake the user is looking for.  Capped at native, because pixels
    above 1:1 are not information.
    """
    if source_width <= 0 or source_height <= 0:
        raise NovaInvariantError(
            f"source dimensions must be positive, got {source_width}x{source_height}"
        )
    return min(1.0, viewport.width / source_width, viewport.height / source_height)


def preview_size(
    source_width: int,
    source_height: int,
    viewport: Viewport,
    *,
    zoom: float = 1.0,
) -> tuple[int, int]:
    """The size to composite at: fitted, zoomed, rounded down to even.

    Rounded *down* so a preview never asks for more pixels than the viewport
    can show, and even because 4:2:0 cannot represent an odd dimension.
    """
    if zoom <= 0:
        raise NovaInvariantError(f"zoom must be positive, got {zoom}")
    scale = fit_scale(source_width, source_height, viewport) * zoom
    width = _even(max(2, int(source_width * scale)))
    height = _even(max(2, int(source_height * scale)))
    return (width, height)


def warm_frames(
    playhead: int,
    *,
    count: int = DEFAULT_WARM_COUNT,
    last_frame: int | None = None,
) -> tuple[int, ...]:
    """The frames to prerender ahead of the playhead.

    Forward only, and clipped to the end of the timeline: work behind the
    playhead is the one kind that is certain to be wasted.

    Args:
        playhead: Where the user is.  The frame after it is the first warm one.
        count: How many frames to have ready.
        last_frame: The last frame that exists, when the caller knows it.  A
            project with no clips is asked for nothing.
    """
    if playhead < 0:
        raise NovaInvariantError(f"playhead must not be negative, got {playhead}")
    if count < 0:
        raise NovaInvariantError(f"count must not be negative, got {count}")
    if count == 0 or last_frame == 0:
        return ()
    stop = playhead + 1 + count
    if last_frame is not None:
        stop = min(stop, last_frame + 1)
    return tuple(range(playhead + 1, stop))


def plan_preview(
    source_width: int,
    source_height: int,
    viewport: Viewport,
    *,
    frame: int = 0,
    zoom: float = 1.0,
    warm_count: int = DEFAULT_WARM_COUNT,
    last_frame: int | None = None,
) -> PreviewPlan:
    """Everything the preview panel needs to draw one frame.

    Args:
        source_width, source_height: The project frame, in composition pixels.
        viewport: The pixels available.
        frame: The playhead.
        zoom: A deliberate multiplier on the fitted scale.
        warm_count: How many frames to have decoded ahead of the playhead.
        last_frame: The last frame that exists, for clipping the warm-up.
    """
    size = preview_size(source_width, source_height, viewport, zoom=zoom)
    return PreviewPlan(
        frame=frame,
        size=size,
        scale=fit_scale(source_width, source_height, viewport) * zoom,
        offset=_centred(size, viewport),
        warm=warm_frames(frame, count=warm_count, last_frame=last_frame),
    )


def _centred(size: tuple[int, int], viewport: Viewport) -> tuple[int, int]:
    """Where to blit a fitted frame so the bars are even on both sides."""
    return ((viewport.width - size[0]) // 2, (viewport.height - size[1]) // 2)


def _even(value: int) -> int:
    """The nearest even number not larger than ``value``."""
    return value - (value % 2)


# ---------------------------------------------------------------------------
# Drawing it
# ---------------------------------------------------------------------------


#: One picture, encoded: what the preview panel renders.
#:
#: A `Result`, because a refusal is a value in this codebase and never an
#: exception thrown across a layer (see `api/errors.py`).
FrameEncoder: TypeAlias = "Callable[[FrameBuffer], Result[bytes]]"


@dataclass(frozen=True, slots=True)
class PreviewFrame:
    """One frame, ready for an `<img>`.

    Carries the plan as well as the picture, because the panel cannot draw a
    fitted frame from the image alone: it needs the scale to know how big to
    blit it and the offset to know where the bars go, and a panel that
    recomputes them from its own size will be wrong by a pixel on every
    odd-sized viewport.
    """

    #: The timeline frame this is.
    frame: int
    #: The encoded picture.
    image: bytes
    #: What to declare the bytes as.
    media_type: str
    #: The size of the encoded picture, in pixels. **Not** the plan's: the plan
    #: says how big the panel draws the frame, which at zoom is larger than the
    #: pixels that were sent, and a panel that sized its `<img>` from the plan
    #: would show a picture stretched by exactly the zoom factor.
    size: tuple[int, int]
    #: The geometry the panel draws it with.
    plan: PreviewPlan
    #: Assets that were missing. Empty means the frame is complete.
    gaps: tuple[str, ...] = ()

    @property
    def width(self) -> int:
        """The width of the encoded picture, in pixels."""
        return self.size[0]

    @property
    def height(self) -> int:
        """The height of the encoded picture, in pixels."""
        return self.size[1]

    @property
    def is_complete(self) -> bool:
        """Whether every layer in the frame had its picture."""
        return not self.gaps


class PreviewRenderer:
    """Draw one frame of a project, at a size a panel can show.

    This is the object the preview panel talks to, and it is the reason §7.2's
    promise is worth anything: it composites with the *same*
    :func:`~nova_studio.services.render.composite.composite_frame` the export
    uses, and differs only in what it does afterwards — scale the result down
    to the panel and encode it. A preview that took a shortcut here is a preview
    that eventually disagrees with the file.

    What it owns is **one frame-source pool**, and that is the whole of its
    state. Decoders stay open between requests so a scrub does not reopen a file
    per frame, and decoded pictures stay in the pool's byte-budgeted cache so
    scrubbing back over the same frames costs nothing. The renderer is a context
    manager because a pool holds file handles, and a session that forgets to
    close one leaks an open decoder per asset.

    **Thread safety:** none. One renderer belongs to one project in one
    session; a panel that fires two requests at once must serialise them, which
    in practice it does, because a second frame request means the first one's
    answer is already stale.

    **Invalidation:** :meth:`invalidate` is what an edit calls. The pictures in
    the cache are of a timeline that no longer exists, and the decoders are
    still perfectly good — which is why it clears one and keeps the other.
    """

    __slots__ = (
        "_encode",
        "_kernels",
        "_luts",
        "_media_type",
        "_ops",
        "_pool",
        "_warm_count",
    )

    def __init__(
        self,
        *,
        decoder: MediaDecoder,
        resolve: SourceResolver,
        ops: ImageOps,
        encode: FrameEncoder,
        media_type: str = "image/jpeg",
        capacity: int = DEFAULT_OPEN_SOURCES,
        cache_bytes: int = DEFAULT_CACHE_BYTES,
        warm_count: int = DEFAULT_WARM_COUNT,
    ) -> None:
        """Args:
        decoder: How to open a media file. A port, so a test needs no FFmpeg.
        resolve: ``(asset_id, source) -> path``. Supplied by the media layer;
            see :func:`resolve_asset` for the plain one.
        ops: The pixel primitives the compositor resamples with.
        encode: How to turn a frame into bytes, for the wire.
        media_type: What to call those bytes.
        capacity: How many decoders the pool may hold open.
        cache_bytes: How much decoded picture the pool may hold, in bytes.
        warm_count: How far ahead :meth:`warm` reads by default.
        """
        self._media_type = media_type
        self._encode = encode
        self._ops = ops
        self._warm_count = warm_count
        self._kernels: KernelRegistry | None = None
        self._luts: LutReader | None = None
        self._pool = FrameSourcePool(decoder, resolve, capacity=capacity, cache_bytes=cache_bytes)

    # -- the API ----------------------------------------------------------

    def frame(
        self,
        project: Project,
        number: int,
        *,
        viewport: Viewport,
        zoom: float = 1.0,
        sources: SourcePlan | None = None,
    ) -> Result[PreviewFrame]:
        """Composite one frame and encode it for the panel.

        Args:
            project: What is being previewed.
            number: The timeline frame.
            viewport: The pixels the panel has.
            zoom: A deliberate multiplier on the fitted scale.
            sources: Which copy of each asset to decode.

        Returns:
            The frame, or `Err` if it could not be encoded. A layer whose
            picture is missing is *not* a failure: the frame is drawn without
            it and listed in :attr:`PreviewFrame.gaps`.
        """
        composed, gaps = render_preview_frame(
            project, number, pool=self._pool, ops=self._ops, sources=sources
        )
        plan = plan_preview(
            project.settings.frame_size.width,
            project.settings.frame_size.height,
            viewport,
            frame=number,
            zoom=zoom,
        )
        # Never upscale: pixels above 1:1 are not information, and a zoomed
        # preview is a panel that scales the image it was given, not a request
        # for more of them. The cap is the whole frame, not each axis — halving
        # one axis because the other hit its limit would distort the picture by
        # the rounding.
        if plan.width >= composed.width or plan.height >= composed.height:
            target = (composed.width, composed.height)
        else:
            target = (plan.width, plan.height)
        scaled = composed
        if target != (composed.width, composed.height):
            scaled = FrameBuffer(
                pixels=self._ops.resize(composed.pixels, target), colour=composed.colour
            )
        encoded = self._encode(scaled)
        if encoded.is_err():
            return err(encoded.unwrap_err())
        return ok(
            PreviewFrame(
                frame=number,
                image=encoded.unwrap(),
                media_type=self._media_type,
                size=target,
                plan=plan,
                gaps=gaps,
            )
        )

    def warm(
        self,
        project: Project,
        number: int,
        *,
        count: int | None = None,
        last_frame: int | None = None,
        sources: SourcePlan | None = None,
    ) -> int:
        """Decode ahead of the playhead, and answer how many frames that was.

        Warming is cheap only when it is done in a batch: every stream is
        already open and reading forwards, so the next fifteen frames cost
        fifteen decodes and no seeks. Done one at a time, in the request path,
        it would cost the user the latency of work they have not asked to see —
        which is why :meth:`frame` never warms on its own.

        Args:
            project: What is being previewed.
            number: The playhead. The frame *after* it is the first warm one.
            count: How many frames ahead. Defaults to the renderer's.
            last_frame: The last frame that exists, to stop the read.
            sources: Which copy of each asset to decode.

        Returns:
            How many frames were warmed, which is `0` at the end of a timeline
            — the one place where warming legitimately does nothing.
        """
        frames = warm_frames(
            number,
            count=self._warm_count if count is None else count,
            last_frame=last_frame,
        )
        for frame in frames:
            plan = plan_frame(project, frame, sources=sources)
            self._pool.prefetch(plan.decodes())
        return len(frames)

    def invalidate(self) -> None:
        """Forget the decoded pictures.

        What an edit does. The decoders stay open — they are files, and the
        files did not change — but every picture in the cache is of a timeline
        that no longer exists.
        """
        self._pool.clear_cache()

    @property
    def stats(self) -> PoolStats:
        """What the pool has done: the `seeks` are the number to watch."""
        return self._pool.stats

    @property
    def cached_bytes(self) -> int:
        """How much decoded picture is being held."""
        return self._pool.cached_bytes

    @property
    def open_sources(self) -> int:
        """How many decoders are open."""
        return self._pool.open_sources

    def errors(self) -> tuple[NovaError, ...]:
        """What the pool could not decode, oldest first. Never fatal."""
        return self._pool.errors()

    def close(self) -> None:
        """Release the decoders and the cache. Idempotent."""
        self._pool.close()

    def __enter__(self) -> PreviewRenderer:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()


def resolve_asset(project: Project, asset_id: str, source: str) -> str | None:
    """Which file to decode for one asset and one copy of it.

    The plain answer, for the composition root to hand a
    :class:`~nova_studio.services.render.pool.FrameSourcePool`: the original is
    the path on the asset, and a proxy or a thumbnail is **not there yet**,
    because generating them is the media layer's job and this feature may not
    import it (ADR-0002 rule 4).

    `None` is a complete answer rather than a failure: it is what the pool turns
    into a gap, and what lets a project open, lay out and preview against
    originals that have not been relinked yet (ADR-0015 rule 3).

    Args:
        project: The project whose bin holds the asset.
        asset_id: Which asset.
        source: ``"original"``, ``"proxy"`` or ``"thumbnail"``.
    """
    if source != DECODE_FROM_ORIGINAL:
        return None
    asset = project.asset(asset_id)
    if asset is None:
        return None
    return asset.path
