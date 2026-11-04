"""L3 — the Position and Resolve stages: where a cue sits, and what moves it.

A caption's *anchor* is what the editor chose — bottom centre, top left, middle.
Its *position* is where it ends up: the anchor, moved out of the way of whatever
is in the frame. ADR-0009 §3 lists those as two stages, `Position` and `Resolve`;
they are one pass here, because a placement that ignores collisions is not a
placement. The pipeline can still insert a stage before or after either name.

Three things push a caption off its anchor:

* **A protected region.** A lower third, a detected face, a broadcaster's logo,
  a game's HUD. Covering one is the mistake a viewer notices before any other,
  and the one the editor cannot fix by re-wording the line.
* **Another caption on screen at the same moment.** Rare inside one layer —
  overlapping cues are invalid — and constant across layers: a translation shown
  beside its original is two boxes that must never touch.
* **The edge of the safe area.** A caption at the very edge of a 16:9 frame is
  cropped by a 4:3 display, by a television's overscan and by a phone's rounded
  corner, so the safe area is a hard wall and not a guideline.

Two rules keep the pass honest.

**Everything is stored in fractions of the safe area**, never in pixels of a
particular preview. A nudge has to mean the same thing in a 480 p proxy and a
4 K export, and that is only true if the number is a fraction (ADR-0009 §5).

**Nothing is measured with a font.** Measuring a string needs a shaper, which is
a port this feature does not have yet, so the placer estimates a box from the
number of lines and the widest line (:data:`DEFAULT_CHAR_ASPECT` characters per
line height). That estimate is why this stage produces an *estimate* and the
renderer has the last word — and why the number is a field on :class:`CuePlacer`
rather than a constant: when the shaper lands, one field changes and no call
site does.

Two rules about the user's work. **A locked cue is never moved** — locking is
how an editor says "I have put this line here". And **a locked cue is an
obstacle**: if it does not move, everything else has to go around it.

One consequence worth knowing: a nudge becomes the cue's position, and the
placer cannot afterwards tell a nudge from an offset the user typed. A cue that
was moved out of the way therefore *stays* moved when the obstacle goes away —
which is what an editor who then fine-tunes the offset by hand wants, and the
reason "re-run the pipeline" is not "reset the layout".
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import TYPE_CHECKING, Final

from nova_studio.core.errors import NovaInvariantError
from nova_studio.core.result import Result, ok
from nova_studio.domain.captions import (
    CaptionAnchor,
    CaptionPosition,
    CaptionRect,
    CaptionSegment,
    SafeArea,
)

if TYPE_CHECKING:
    from collections.abc import Sequence

    from nova_studio.domain.captions import CaptionDocument
    from nova_studio.services.captions.pipeline import StageContext

__all__ = [
    "DEFAULT_CHAR_ASPECT",
    "DEFAULT_MAX_SHIFT_LINES",
    "DEFAULT_PADDING_FRACTION",
    "CueBox",
    "CuePlacer",
    "cue_box",
]

#: How wide a character is, measured in line heights.  An estimate — see the
#: module docstring — and deliberately a field rather than a constant, so that
#: the day a shaper lands, one value changes and no call site does.
DEFAULT_CHAR_ASPECT: Final[float] = 0.5
#: Gap between two stacked cues, also in line heights.
DEFAULT_PADDING_FRACTION: Final[float] = 0.25
#: How far a cue may travel before the placer gives up and leaves it put.  Four
#: lines is as far as a caption can move and still read as belonging to the
#: bottom of the frame.
DEFAULT_MAX_SHIFT_LINES: Final[int] = 4

#: Which way a cue prefers to move, by the vertical half of its anchor.  A cue
#: anchored at the bottom moves *up*, away from the edge it is sitting on:
#: moving it down would take it off the frame first.
_PREFERRED_DIRECTION: Final[dict[str, int]] = {"top": 1, "middle": -1, "bottom": -1}


@dataclass(frozen=True, slots=True)
class CueBox:
    """One cue's box, in pixels of the frame it will be drawn on.

    Carries the cue's time and anchor, because the two questions every
    collision rule asks are *when* the box is on screen and *which way it would
    rather move*.
    """

    rect: CaptionRect
    start_ms: int
    end_ms: int
    index: int
    anchor: CaptionAnchor = CaptionAnchor.BOTTOM_CENTER

    def on_screen_with(self, other: CueBox) -> bool:
        """Whether the two share any moment.  Touching edges do not count."""
        return self.start_ms < other.end_ms and other.start_ms < self.end_ms


@dataclass(frozen=True, slots=True, kw_only=True)
class CuePlacer:
    """The Position and Resolve stages: place every cue, then move what clashes."""

    #: The stage's name in the pipeline.
    name: str = "position"
    #: Estimated width of one character, in line heights.
    char_aspect: float = DEFAULT_CHAR_ASPECT
    #: Gap between two cues, in line heights.
    padding_fraction: float = DEFAULT_PADDING_FRACTION
    #: How many line heights a cue may travel before it is left alone.
    max_shift_lines: int = DEFAULT_MAX_SHIFT_LINES

    def __post_init__(self) -> None:
        if self.char_aspect <= 0:
            raise NovaInvariantError(f"char_aspect must be positive, got {self.char_aspect}")
        if self.padding_fraction < 0:
            raise NovaInvariantError(
                f"padding_fraction must not be negative, got {self.padding_fraction}"
            )
        if self.max_shift_lines < 0:
            raise NovaInvariantError(
                f"max_shift_lines must not be negative, got {self.max_shift_lines}"
            )

    def apply(self, document: CaptionDocument, ctx: StageContext) -> Result[CaptionDocument]:
        """Place every unlocked cue, leaving locked ones exactly where they are."""
        placed: list[CueBox] = []
        cues: list[CaptionSegment] = []
        for cue in sorted(document.segments, key=lambda each: (each.start_ms, each.end_ms)):
            box = cue_box(cue, ctx, aspect=self.char_aspect)
            if cue.locked:
                # Fixed, and therefore an obstacle for everything that follows.
                placed.append(box)
                cues.append(cue)
                continue
            obstacles = tuple(
                obstacle for obstacle in (b.rect for b in placed if b.on_screen_with(box))
            )
            moved = _resolved(
                box,
                obstacles=(*ctx.protected, *obstacles),
                inset=_safe_area_of(cue).inset(*ctx.frame_size),
                padding=self.padding_fraction,
                max_shift_lines=self.max_shift_lines,
            )
            placed.append(replace(box, rect=moved))
            cues.append(_repositioned(cue, box.rect, moved, ctx))
        return ok(replace(document, segments=tuple(cues)).reindexed())


def cue_box(
    cue: CaptionSegment,
    ctx: StageContext,
    *,
    aspect: float = DEFAULT_CHAR_ASPECT,
) -> CueBox:
    """The box a cue's own anchor and offsets imply, before any resolving.

    Exposed because the renderer needs the same answer: it draws from a
    :class:`~nova_studio.domain.captions.CaptionPosition`, and a geometry rule
    that lives twice is a rule that drifts between preview and export.
    """
    safe = _safe_area_of(cue).inset(*ctx.frame_size)
    return CueBox(
        rect=_anchored_rect(cue, safe, ctx, aspect=aspect),
        start_ms=cue.start_ms,
        end_ms=cue.end_ms,
        index=cue.index,
        anchor=_anchor_of(cue),
    )


# -- geometry ----------------------------------------------------------------


def _anchored_rect(
    cue: CaptionSegment,
    safe: CaptionRect,
    ctx: StageContext,
    *,
    aspect: float,
) -> CaptionRect:
    """Where the cue's anchor and offsets put it, clamped to the safe area."""
    anchor = _anchor_of(cue)
    lines = cue.lines()
    line_height = max(1, round(ctx.line_height_fraction * safe.height))
    height = line_height * max(1, len(lines))
    widest = max((len(line) for line in lines), default=1)
    width = round(widest * aspect * line_height)
    position = cue.position or CaptionPosition()
    return _clamped(
        CaptionRect(
            x=_horizontal(safe, _horizontal_half(anchor), width) + round(position.x * safe.width),
            y=_vertical(safe, _vertical_half(anchor), height) + round(position.y * safe.height),
            width=width,
            height=height,
        ),
        safe,
    )


def _anchor_of(cue: CaptionSegment) -> CaptionAnchor:
    """The anchor a cue was placed by, or the one every caption starts on."""
    return (cue.position or CaptionPosition()).anchor


def _vertical_half(anchor: CaptionAnchor) -> str:
    """``"bottom-center"`` → ``"bottom"``."""
    return _half(anchor, 0, fallback="bottom")


def _horizontal_half(anchor: CaptionAnchor) -> str:
    """``"bottom-center"`` → ``"center"``."""
    return _half(anchor, 1, fallback="center")


def _half(anchor: CaptionAnchor, part: int, *, fallback: str) -> str:
    """An anchor's name is vertical first: ``"bottom-center"``, ``"top-left"``."""
    name = anchor.value if isinstance(anchor, CaptionAnchor) else str(anchor)
    halves = name.split("-", 1)
    return halves[part] if len(halves) == 2 else fallback


def _horizontal(safe: CaptionRect, half: str, width: int) -> int:
    if half == "left":
        return safe.x
    if half == "right":
        return safe.right - width
    return safe.x + (safe.width - width) // 2


def _vertical(safe: CaptionRect, half: str, height: int) -> int:
    if half == "top":
        return safe.y
    if half == "bottom":
        return safe.bottom - height
    return safe.y + (safe.height - height) // 2


def _clamped(rect: CaptionRect, safe: CaptionRect) -> CaptionRect:
    """Keep a box inside the safe area, even when it is bigger than the gap."""
    width = min(rect.width, safe.width)
    height = min(rect.height, safe.height)
    return CaptionRect(
        x=min(max(rect.x, safe.x), safe.right - width),
        y=min(max(rect.y, safe.y), safe.bottom - height),
        width=width,
        height=height,
    )


# -- resolving ---------------------------------------------------------------


def _resolved(
    box: CueBox,
    *,
    obstacles: Sequence[CaptionRect],
    inset: CaptionRect,
    padding: float,
    max_shift_lines: int,
) -> CaptionRect:
    """Move a box until it touches nothing, or leave it where it started.

    A caption is moved, never hidden: a caption over a logo is a mistake a
    viewer can still read past, and a caption the engine decided to drop is
    information gone. So when no clear spot exists within reach, the cue keeps
    its anchor — and the editor's attention goes to it instead.
    """
    if not any(box.rect.overlaps(obstacle) for obstacle in obstacles):
        return box.rect
    step = max(1, round(box.rect.height * (1 + padding)))
    preferred = _PREFERRED_DIRECTION.get(_vertical_half(box.anchor), -1)
    for distance in range(1, max_shift_lines + 1):
        for direction in (preferred, -preferred):
            moved = box.rect.shifted(0, direction * distance * step)
            if not _inside(moved, inset):
                continue
            if not any(moved.overlaps(obstacle) for obstacle in obstacles):
                return moved
    return box.rect


def _inside(rect: CaptionRect, safe: CaptionRect) -> bool:
    return (
        rect.x >= safe.x
        and rect.y >= safe.y
        and rect.right <= safe.right
        and rect.bottom <= safe.bottom
    )


def _safe_area_of(cue: CaptionSegment) -> SafeArea:
    """The safe area this cue is placed in: its own, or the pipeline's."""
    return cue.position.safe_area if cue.position else SafeArea()


def _repositioned(
    cue: CaptionSegment,
    before: CaptionRect,
    after: CaptionRect,
    ctx: StageContext,
) -> CaptionSegment:
    """The cue, carrying the nudge as an offset of the safe area.

    The offset is stored and not the pixel box: a fraction is what survives a
    change of frame size, which is the whole reason preview and export can
    agree.
    """
    safe = _safe_area_of(cue).inset(*ctx.frame_size)
    if safe.width <= 0 or safe.height <= 0:
        return cue
    base = cue.position or CaptionPosition()
    return replace(
        cue,
        position=replace(
            base,
            x=_unit(base.x + (after.x - before.x) / safe.width),
            y=_unit(base.y + (after.y - before.y) / safe.height),
        ),
    )


def _unit(value: float) -> float:
    """Keep an offset inside the ``[-1, 1]`` the domain allows."""
    return min(1.0, max(-1.0, value))
