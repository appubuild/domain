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
from typing import Final

from nova_studio.core.errors import NovaInvariantError

__all__ = [
    "DEFAULT_WARM_COUNT",
    "PreviewPlan",
    "Viewport",
    "fit_scale",
    "plan_preview",
    "preview_size",
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
