"""The render loop: plan a frame, decode it, composite it, hand it on.

This is the seam the whole render architecture is arranged around. §7.2
promises that **preview and export use the same code path**, and this is that
path: one loop, parameterised by a sink. Point it at a JPEG sink and it is the
preview panel; point it at an encoder sink and it is the export job. There is
no second implementation to drift out of step with, which is why "the preview
looked different from the export" is not a bug class here.

```
for frame in frames:
    plan      = plan_frame(project, frame, sources=…)   # what it is made of
    pictures  = pool.pictures(plan.decodes())           # the pixels it needs
    composed  = composite_frame(plan, pictures, ops=…)  # the frame
    sink.write(composed)                                # wherever it goes
```

Four collaborators, all injected, none imported: a `FrameSourcePool` (where
pictures come from), `ImageOps` (how pixels are resampled), an optional effect
kernel registry and LUT reader, and a `FrameSink` (where the frame goes). The
loop adds only what a loop must: ordering, cancellation, and an honest account
of what happened.

**Ordering is the caller's job and the loop keeps it.** The pool reads
sequentially only if it is asked sequentially, so frames are rendered in the
order given and the caller is trusted not to shuffle them. Rendering 0..n
forward costs one seek per clip per run; rendering the same frames in a random
order costs one seek per frame — the difference between an export that takes
minutes and one that takes hours.

**Cancellation is a value, not an exception.** `cancel` is a callable the job
framework supplies; the loop asks it once per frame and stops between frames,
never mid-frame. A half-written frame is worse than a frame that was never
started, and the sink's `abort` is what keeps that promise about the file.

**A gap is not a failure.** An offline asset means a layer is missing; the frame
is still rendered, and the caller decides whether the export tolerates it. An
encode failure or a cancellation *is* a failure: the loop stops, because
continuing to write frames into a stream that has already failed is how a
corrupt file gets produced.

**Nothing here is cached.** The frame cache belongs to the caller — the preview
loop's, keyed by what was decoded — because a cache inside the loop would be a
second opinion about what a frame is.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, TypeAlias

from nova_studio.core.errors import NovaError, NovaInvariantError
from nova_studio.services.render.composite import composite_frame
from nova_studio.services.render.frames import plan_frame
from nova_studio.services.render.kernels import builtin_kernels

if TYPE_CHECKING:
    from collections.abc import Callable, Iterable, Mapping, Sequence

    from nova_studio.core import Result
    from nova_studio.domain.export import RenderStats
    from nova_studio.domain.media import FrameBuffer
    from nova_studio.domain.project import Project
    from nova_studio.ports.imaging import ImageOps
    from nova_studio.ports.render import FrameSink
    from nova_studio.services.render.frames import DecodeRequest
    from nova_studio.services.render.kernels import KernelRegistry
    from nova_studio.services.render.pool import FrameSourcePool

__all__ = ["RenderOutcome", "render_frames", "render_preview_frame"]

#: ``() -> bool``: has this render been cancelled? Asked once per frame. A
#: callable rather than a flag because the job that owns the render is the only
#: thing that knows, and passing the job in would couple this loop to the
#: scheduler (ADR-0010).
Cancellation: TypeAlias = "Callable[[], bool]"

#: What to decode each asset from, keyed by asset id: ``"original"``,
#: ``"proxy"``, ``"thumbnail"``. Decided by the media layer, not here.
SourcePlan: TypeAlias = "Mapping[str, str]"

#: A LUT id or name to a table, for a grade that carries one.
LutReader: TypeAlias = "Callable[[object], object]"


@dataclass(frozen=True, slots=True)
class RenderOutcome:
    """What a render did, and what it could not do.

    A render is not a function that returns a frame; it is a process that
    produces a file, and the difference is that a process can partly fail. So
    the outcome reports three counts rather than one: the frames that were
    written, the frames that were *empty* (nothing on the timeline — normal at
    the head and tail of a project, and the reason an export must not be
    measured by its frame count alone), and the frames that came out **wrong**
    because a picture was missing.

    `gaps` is the number a user needs. An export that reports 3 gaps is telling
    the truth about an offline file; an export that silently rendered black is
    how a professional loses an afternoon.
    """

    #: Frames handed to the sink.
    written: int = 0
    #: Frames with no layers at all: composited to the frame size, still written.
    empty: int = 0
    #: Frames that were missing at least one picture.
    gap_frames: int = 0
    #: The assets that could not be served, first-seen order.

    #: An asset, not a request: a clip that is offline for five thousand frames
    #: is one thing to tell the user about, and a list of five thousand frames
    #: is a list nobody reads. `gap_frames` says how much of the render it cost.
    missing: tuple[str, ...] = ()
    #: The failure that stopped the render, if any.
    error: NovaError | None = None
    #: True when the render stopped because it was cancelled.
    cancelled: bool = False
    #: What the sink counted, once it was finished.
    stats: RenderStats | None = None
    #: What the pool did: the seeks are the number a perf report wants.
    pool_stats: object | None = None
    #: Any other failure the pool saw but did not stop for, oldest first.
    warnings: tuple[NovaError, ...] = field(default_factory=tuple)

    @property
    def ok(self) -> bool:
        """Whether the render finished on its own terms.

        An export with gaps is still `ok`: the file is complete, and the gaps
        are a fact about the project, not about the render. Only a failure or a
        cancellation makes the answer no.
        """
        return self.error is None and not self.cancelled


def render_frames(
    project: Project,
    frames: Iterable[int] | Sequence[int],
    *,
    pool: FrameSourcePool,
    ops: ImageOps,
    sink: FrameSink,
    sources: SourcePlan | None = None,
    kernels: KernelRegistry | None = None,
    luts: LutReader | None = None,
    cancel: Cancellation | None = None,
) -> RenderOutcome:
    """Render a range of frames, in order, into a sink.

    Args:
        project: What is being rendered.
        frames: Which timeline frames, **in presentation order**. An iterable is
            consumed lazily, so a caller can render a range without building it.
        pool: Where pictures come from.
        ops: The pixel primitives the compositor resamples with.
        sink: Where composed frames go. The loop writes and finishes it; on
            failure it aborts, so the caller never has to.
        sources: Which copy of each asset to decode. ``None`` means the
            original for everything.
        kernels: Which effect arithmetic exists. Defaults to the built-ins.
        luts: How to turn a LUT into a table. Needed only by a grade carrying
            one; a grade that does and a reader that does not is an error, not
            a skipped pass.
        cancel: Asked once per frame. ``True`` stops the render between frames.

    Returns:
        A :class:`RenderOutcome`. The loop does not raise for a missing picture,
        a damaged file or a frame past the end of the timeline; it raises only
        for a caller's mistake — no frames at all, or a project with no size.
    """
    registry = kernels if kernels is not None else builtin_kernels()
    written = empty = gap_frames = 0
    missing: list[str] = []
    frame_numbers: Iterable[int] = frames

    for frame in frame_numbers:
        if cancel is not None and cancel():
            sink.abort()
            return RenderOutcome(
                written=written,
                empty=empty,
                gap_frames=gap_frames,
                missing=tuple(missing),
                cancelled=True,
                pool_stats=pool.stats,
                warnings=pool.errors(),
            )

        plan = plan_frame(project, frame, sources=sources)
        if plan.is_empty:
            empty += 1
        requests = plan.decodes()
        pictures = pool.pictures(requests)
        if len(pictures) < len(requests):
            gap_frames += 1
            for request in requests:
                if request.key not in pictures and request.asset_id not in missing:
                    missing.append(request.asset_id)

        composed = composite_frame(
            plan, pictures, ops=ops, kernels=registry, luts=luts, colour=None
        )
        written_result: Result[None] = sink.write(composed)
        if written_result.is_err():
            failure: NovaError = written_result.unwrap_err()
            sink.abort()
            return RenderOutcome(
                written=written,
                empty=empty,
                gap_frames=gap_frames,
                missing=tuple(missing),
                error=failure,
                pool_stats=pool.stats,
                warnings=pool.errors(),
            )
        written += 1

    finished: Result[RenderStats] = sink.finish()
    if finished.is_err():
        return RenderOutcome(
            written=written,
            empty=empty,
            gap_frames=gap_frames,
            missing=tuple(missing),
            error=finished.unwrap_err(),
            pool_stats=pool.stats,
            warnings=pool.errors(),
        )
    return RenderOutcome(
        written=written,
        empty=empty,
        gap_frames=gap_frames,
        missing=tuple(missing),
        stats=finished.unwrap(),
        pool_stats=pool.stats,
        warnings=pool.errors(),
    )


def render_preview_frame(
    project: Project,
    frame: int,
    *,
    pool: FrameSourcePool,
    ops: ImageOps,
    sources: SourcePlan | None = None,
    kernels: KernelRegistry | None = None,
    luts: LutReader | None = None,
) -> tuple[FrameBuffer, tuple[DecodeRequest, ...]]:
    """Composite one frame and hand it back, without a sink.

    The preview panel wants a picture, not a file: it scales it, letterboxes it
    and puts it on screen. It goes through the same compositor as an export —
    that is the whole promise — and skips only the encode.

    Returns:
        The composed frame, and the requests that could not be served: an empty
        tuple means the frame is complete.

    Raises:
        NovaInvariantError: if ``frame`` is negative, which is a bug in the
            caller rather than a state of a project.
    """
    if frame < 0:
        raise NovaInvariantError(f"frame must not be negative, got {frame}")
    registry = kernels if kernels is not None else builtin_kernels()
    plan = plan_frame(project, frame, sources=sources)
    requests = plan.decodes()
    pictures = pool.pictures(requests)
    gaps = tuple(request for request in requests if request.key not in pictures)
    return (
        composite_frame(plan, pictures, ops=ops, kernels=registry, luts=luts),
        gaps,
    )
