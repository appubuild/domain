"""L2 — animation: a value over time.

The frame pipeline needs to know what a slider is set to *right now*, and
"right now" is a frame number.  This module is that answer: a keyframe, a curve
between two of them, and a parameter that is either a constant or a list of
keyframes.

It exists on its own rather than inside ``effects.py`` because two features
need it and neither owns it.  An effect's radius is animated; so is a caption's
position, and ADR-0009 §7 requires the caption baker to emit *the editor's own
keyframes* precisely so that a caption animation and a clip animation are the
same object.  Two animation models is the classic way for a preview and an
export to disagree about a frame.

Frames, not seconds
-------------------
Keyframes sit on **integer frame numbers** and interpolation is derived from
them, so the value at frame 720 is the same in the preview, in the export and
in a test, at any frame rate (ADR-0006).  Progress within a segment is a float,
but it is *derived* from a frame and never accumulated.

Three rules pin the behaviour users actually notice
---------------------------------------------------
* **The left keyframe owns the segment.**  Its interpolation and its outgoing
  handle decide the shape, so deleting a keyframe changes the easing of the
  segment *before* it, not the one after — the rule every editor follows and
  every from-scratch implementation gets backwards.
* **A Bezier handle may overshoot in y but not in x.**  ``y`` outside 0-1 is
  the bounce a user is asking for; ``x`` outside it would stop the curve being
  a function of time.  ``x`` is inverted by bounded Newton-Raphson with a
  bisection fallback, so the solve is deterministic on every machine.
* **Constant and animated are one type.**  :class:`Animatable` with no
  keyframes *is* a constant, so adding the first keyframe promotes a value
  rather than changing a type, and nothing that reads a parameter needs two
  branches for what the user thinks of as one slider.

Deliberately not here: **pixels, and the meaning of a value.**  Nothing in this
module knows whether the numbers it interpolates are pixels, degrees or a
colour; that is the effect's business (``effects.py``) or the caption
template's (``captions.py``).
"""

from __future__ import annotations

import math
from bisect import bisect_right
from dataclasses import dataclass, replace
from enum import StrEnum
from itertools import pairwise
from typing import TYPE_CHECKING, Final

from nova_studio.core.errors import NovaInvariantError

if TYPE_CHECKING:
    from collections.abc import Mapping

from nova_studio.domain._wire import (
    reject_unknown_fields as _reject_unknown_fields,
    wire_floats as _wire_floats,
    wire_int as _wire_int,
    wire_mappings as _wire_mappings,
    wire_str as _wire_str,
)

__all__ = [
    "BEZIER_LINEAR_IN_HANDLE",
    "BEZIER_LINEAR_OUT_HANDLE",
    "Animatable",
    "Interpolation",
    "Keyframe",
    "bezier_progress",
    "ease",
    "interpolate",
]

_HANDLE_FIELDS: Final[set[str]] = {"x", "y"}
_KEYFRAME_FIELDS: Final[set[str]] = {
    "frame",
    "value",
    "interpolation",
    "out_handle",
    "in_handle",
}
_ANIMATABLE_FIELDS: Final[set[str]] = {"name", "value", "keyframes"}


# ---------------------------------------------------------------------------
# Bezier solving
# ---------------------------------------------------------------------------

#: Newton-Raphson converges in four or five steps for every curve a user can
#: draw; eight leaves room for the near-flat edges where it does not.
_BEZIER_NEWTON_STEPS: Final[int] = 8
#: Bisection is the fallback when the slope is too flat for Newton to trust.
_BEZIER_BISECTION_STEPS: Final[int] = 40
_BEZIER_EPSILON: Final[float] = 1e-6
_BEZIER_MIN_SLOPE: Final[float] = 1e-6

#: The control points that make a cubic Bezier exactly linear: with
#: P1 = (1/3, 1/3) and P2 = (2/3, 2/3), both x(t) and y(t) reduce to t.  A
#: Bezier keyframe with no handles set therefore behaves like a linear one
#: instead of jumping.
BEZIER_LINEAR_OUT_HANDLE: Final[tuple[float, float]] = (1.0 / 3.0, 1.0 / 3.0)
BEZIER_LINEAR_IN_HANDLE: Final[tuple[float, float]] = (2.0 / 3.0, 2.0 / 3.0)


class Interpolation(StrEnum):
    """How a value travels between two keyframes.

    ``HOLD`` is a step: the value jumps at the *second* keyframe, which is what
    a user means by "stay like this until then".
    """

    #: No interpolation: the value stays at the left keyframe and jumps.
    HOLD = "hold"
    #: Straight line between the two values.
    LINEAR = "linear"
    #: Slow start, full-speed finish (t²).
    EASE_IN = "ease-in"
    #: Full-speed start, slow finish (1-(1-t)²).
    EASE_OUT = "ease-out"
    #: Symmetric smoothstep, t²(3-2t): zero velocity at both ends.
    EASE_IN_OUT = "ease-in-out"
    #: A cubic Bezier through two control points, which can overshoot.
    BEZIER = "bezier"


def ease(progress: float, interpolation: Interpolation) -> float:
    """Shape a segment progress (0-1) through a curve.

    :raises NovaInvariantError: for ``BEZIER``, which cannot be evaluated
        without its two control points — use :func:`bezier_progress`.
    """
    clamped = min(max(progress, 0.0), 1.0)
    if interpolation is Interpolation.HOLD:
        return 0.0
    if interpolation is Interpolation.LINEAR:
        return clamped
    if interpolation is Interpolation.EASE_IN:
        return clamped * clamped
    if interpolation is Interpolation.EASE_OUT:
        return 1.0 - (1.0 - clamped) ** 2
    if interpolation is Interpolation.EASE_IN_OUT:
        return clamped * clamped * (3.0 - 2.0 * clamped)
    raise NovaInvariantError(
        "BEZIER interpolation needs control points; call bezier_progress instead"
    )


def bezier_progress(
    progress: float,
    out_handle: tuple[float, float],
    in_handle: tuple[float, float],
) -> float:
    """Value-progress for a time-progress through a cubic Bezier.

    The curve is the CSS one: P0 = (0, 0), P1 = ``out_handle``,
    P2 = ``in_handle``, P3 = (1, 1), all in normalised segment space.  ``x`` is
    a fraction of the segment's duration and must land inside 0-1; ``y`` is a
    fraction of its value change and may go outside, which is what makes an
    overshoot possible — a bounce that never leaves the range is not a bounce.

    Solving for ``y`` at a given ``x`` has no closed form, so ``x`` is inverted
    by Newton-Raphson with a bisection fallback for the flat parts of the
    curve.  Both are bounded, so this is deterministic on every machine.
    """
    target = min(max(progress, 0.0), 1.0)
    _, out_y = out_handle
    _, in_y = in_handle
    return _bezier_y(_solve_bezier_t(target, out_handle, in_handle), out_y, in_y)


def _solve_bezier_t(
    target: float,
    out_handle: tuple[float, float],
    in_handle: tuple[float, float],
) -> float:
    """The curve parameter ``t`` at which the Bezier reaches ``target`` in x."""
    out_x, _ = out_handle
    in_x, _ = in_handle
    t = target
    for _ in range(_BEZIER_NEWTON_STEPS):
        error = _bezier_x(t, out_x, in_x) - target
        if abs(error) < _BEZIER_EPSILON:
            return t
        slope = _bezier_derivative_x(t, out_x, in_x)
        if slope < _BEZIER_MIN_SLOPE:
            break
        t -= error / slope
    low, high = 0.0, 1.0
    for _ in range(_BEZIER_BISECTION_STEPS):
        middle = (low + high) / 2.0
        if _bezier_x(middle, out_x, in_x) < target:
            low = middle
        else:
            high = middle
    return (low + high) / 2.0


def _bezier_x(t: float, out_x: float, in_x: float) -> float:
    inverse = 1.0 - t
    return 3.0 * inverse * inverse * t * out_x + 3.0 * inverse * t * t * in_x + t * t * t


def _bezier_y(t: float, out_y: float, in_y: float) -> float:
    inverse = 1.0 - t
    return 3.0 * inverse * inverse * t * out_y + 3.0 * inverse * t * t * in_y + t * t * t


def _bezier_derivative_x(t: float, out_x: float, in_x: float) -> float:
    inverse = 1.0 - t
    return (
        3.0 * inverse * inverse * out_x
        + 6.0 * inverse * t * (in_x - out_x)
        + 3.0 * t * t * (1.0 - in_x)
    )


# ---------------------------------------------------------------------------
# Animation
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True, kw_only=True)
class Keyframe:
    """A value pinned to one frame, plus how to travel to the next one.

    ``value`` is a tuple because a parameter is not always one number: position
    is two, a colour is three or four, crop is four.  One keyframe pins *all*
    of them, which is why a user moving a layer along a path gets one keyframe
    per point and not two that can drift apart.
    """

    frame: int
    #: The pinned value.  Arity is fixed by the :class:`Animatable` it belongs
    #: to, and every component shares one interpolation curve.
    value: tuple[float, ...]
    #: How to travel from here to the *next* keyframe.
    interpolation: Interpolation = Interpolation.LINEAR
    #: Normalised (x, y) control point leaving this keyframe.  Read only when
    #: ``interpolation`` is ``BEZIER``; ``None`` means "linear".
    out_handle: tuple[float, float] | None = None
    #: Normalised control point arriving at the next keyframe, stored here for
    #: the same reason a user finds it here: it is the handle next to this dot.
    in_handle: tuple[float, float] | None = None

    def __post_init__(self) -> None:
        if self.frame < 0:
            raise NovaInvariantError(f"frame must not be negative, got {self.frame}")
        if not isinstance(self.value, tuple):
            raise NovaInvariantError(f"value must be a tuple, got {type(self.value).__name__}")
        if not self.value:
            raise NovaInvariantError("value must hold at least one component")
        for component in self.value:
            if not math.isfinite(component):
                raise NovaInvariantError(f"value components must be finite, got {self.value}")
        _check_handle(self.out_handle, "out_handle")
        _check_handle(self.in_handle, "in_handle")

    @classmethod
    def at(
        cls,
        frame: int,
        *values: float,
        interpolation: Interpolation = Interpolation.LINEAR,
        out_handle: tuple[float, float] | None = None,
        in_handle: tuple[float, float] | None = None,
    ) -> Keyframe:
        """A keyframe at ``frame`` holding ``values``."""
        return cls(
            frame=frame,
            value=values,
            interpolation=interpolation,
            out_handle=out_handle,
            in_handle=in_handle,
        )

    @classmethod
    def hold(cls, frame: int, *values: float) -> Keyframe:
        """A keyframe that jumps at the next one instead of easing into it."""
        return cls(frame=frame, value=values, interpolation=Interpolation.HOLD)

    @property
    def is_bezier(self) -> bool:
        """Whether this keyframe carries a Bezier curve."""
        return self.interpolation is Interpolation.BEZIER

    def to_wire(self) -> dict[str, object]:
        return {
            "frame": self.frame,
            "value": list(self.value),
            "interpolation": str(self.interpolation),
            "out_handle": None if self.out_handle is None else list(self.out_handle),
            "in_handle": None if self.in_handle is None else list(self.in_handle),
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> Keyframe:
        _reject_unknown_fields(data, _KEYFRAME_FIELDS)
        return cls(
            frame=_wire_int(data, "frame"),
            value=_wire_floats(data, "value"),
            interpolation=Interpolation(_wire_str(data, "interpolation")),
            out_handle=_wire_handle(data, "out_handle"),
            in_handle=_wire_handle(data, "in_handle"),
        )


@dataclass(frozen=True, slots=True, kw_only=True)
class Animatable:
    """One parameter: either a constant, or a value over time.

    Both cases are one type on purpose.  A static parameter is an
    :class:`Animatable` with no keyframes, so promoting it to animated — the
    moment a user touches the stopwatch — replaces a value rather than changing
    a type, and no code that reads it has to learn anything.
    """

    name: str
    #: The value when nothing is animated, and the arity of every keyframe.
    value: tuple[float, ...]
    #: Ordered by frame, with no two keyframes on one frame.
    keyframes: tuple[Keyframe, ...] = ()

    def __post_init__(self) -> None:
        if not self.name:
            raise NovaInvariantError("name must not be empty")
        if not isinstance(self.value, tuple):
            raise NovaInvariantError(f"value must be a tuple, got {type(self.value).__name__}")
        if not self.value:
            raise NovaInvariantError("value must hold at least one component")
        for component in self.value:
            if not math.isfinite(component):
                raise NovaInvariantError(f"value components must be finite, got {self.value}")
        # ``keyframes`` is normalised here — sorted, with duplicate frames
        # refused — so that lookups can binary-search and two parameter values
        # that mean the same thing compare equal.  A frozen dataclass cannot
        # assign, so the normalised tuple is written directly; this is the only
        # write this type ever performs.
        ordered = tuple(sorted(self.keyframes, key=_frame_of))
        for left, right in pairwise(ordered):
            if left.frame == right.frame:
                raise NovaInvariantError(
                    f"two keyframes share frame {left.frame}; one frame holds one value"
                )
        object.__setattr__(self, "keyframes", ordered)
        for keyframe in ordered:
            if len(keyframe.value) != self.width:
                raise NovaInvariantError(
                    f"keyframe at frame {keyframe.frame} has {len(keyframe.value)} "
                    f"components but '{self.name}' holds {self.width}"
                )

    @classmethod
    def constant(cls, name: str, *values: float) -> Animatable:
        """A parameter that never changes over time."""
        return cls(name=name, value=values)

    @property
    def width(self) -> int:
        """How many numbers one value of this parameter is made of."""
        return len(self.value)

    @property
    def is_animated(self) -> bool:
        """Whether the parameter changes over time."""
        return bool(self.keyframes)

    @property
    def frames(self) -> tuple[int, ...]:
        """Every frame that carries a keyframe, in order."""
        return tuple(keyframe.frame for keyframe in self.keyframes)

    def all_values(self) -> tuple[tuple[float, ...], ...]:
        """Every value this parameter can take: the static one and every keyframe."""
        return (self.value, *(keyframe.value for keyframe in self.keyframes))

    def at(self, frame: int) -> tuple[float, ...]:
        """The value at ``frame``.

        Before the first keyframe and after the last one the value is held,
        which is what "I only animated the middle" means.
        """
        if not self.keyframes:
            return self.value
        first = self.keyframes[0]
        if frame <= first.frame:
            return first.value
        last = self.keyframes[-1]
        if frame >= last.frame:
            return last.value
        index = bisect_right(self.keyframes, frame, key=_frame_of) - 1
        return interpolate(self.keyframes[index], self.keyframes[index + 1], frame)

    def scalar_at(self, frame: int) -> float:
        """:meth:`at` for a one-component parameter.

        :raises NovaInvariantError: if the parameter is not a scalar.
        """
        if self.width != 1:
            raise NovaInvariantError(f"'{self.name}' has {self.width} components, not one")
        return self.at(frame)[0]

    def keyframe_at(self, frame: int) -> Keyframe | None:
        """The keyframe pinned exactly at ``frame``, if there is one."""
        for keyframe in self.keyframes:
            if keyframe.frame == frame:
                return keyframe
        return None

    def with_keyframe(self, keyframe: Keyframe) -> Animatable:
        """The parameter with ``keyframe`` added, or replacing one on that frame.

        This is the stopwatch: adding a keyframe to a constant parameter makes
        it animated without changing its type.
        """
        kept = tuple(item for item in self.keyframes if item.frame != keyframe.frame)
        return replace(self, keyframes=tuple(sorted((*kept, keyframe), key=_frame_of)))

    def without_keyframe(self, frame: int) -> Animatable:
        """The parameter with the keyframe at ``frame`` removed.

        :raises NovaInvariantError: if there is no keyframe there.
        """
        kept = tuple(item for item in self.keyframes if item.frame != frame)
        if len(kept) == len(self.keyframes):
            raise NovaInvariantError(f"'{self.name}' has no keyframe at frame {frame}")
        return replace(self, keyframes=kept)

    def shifted(self, delta_frames: int) -> Animatable:
        """The parameter with every keyframe moved, clamped at frame zero.

        Clamping rather than refusing is what a ripple edit needs: when a clip
        slides left past the start of the timeline, its animation slides with it
        instead of being refused.  Keyframes that would land before frame zero
        all pile up on it, and the last of them wins — that is the value which
        would have been current when playback began.
        """
        moved: list[Keyframe] = []
        for keyframe in self.keyframes:
            frame = max(0, keyframe.frame + delta_frames)
            if moved and moved[-1].frame == frame:
                moved[-1] = replace(keyframe, frame=frame)
            else:
                moved.append(replace(keyframe, frame=frame))
        return replace(self, keyframes=tuple(moved))

    def to_wire(self) -> dict[str, object]:
        return {
            "name": self.name,
            "value": list(self.value),
            "keyframes": [keyframe.to_wire() for keyframe in self.keyframes],
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> Animatable:
        _reject_unknown_fields(data, _ANIMATABLE_FIELDS)
        return cls(
            name=_wire_str(data, "name"),
            value=_wire_floats(data, "value"),
            keyframes=tuple(
                Keyframe.from_wire(entry) for entry in _wire_mappings(data, "keyframes")
            ),
        )


def interpolate(left: Keyframe, right: Keyframe, frame: int) -> tuple[float, ...]:
    """The value at ``frame``, travelling from ``left`` to ``right``.

    ``left`` owns the curve: its interpolation and its outgoing handle decide
    the shape, which is why deleting a keyframe changes the easing of the
    segment that preceded it and not the one that follows.
    """
    span = right.frame - left.frame
    if span <= 0:
        raise NovaInvariantError(
            f"keyframes must be in frame order, got {left.frame} then {right.frame}"
        )
    if frame <= left.frame:
        return left.value
    if frame >= right.frame:
        return right.value
    progress = (frame - left.frame) / span
    if left.interpolation is Interpolation.HOLD:
        return left.value
    if left.interpolation is Interpolation.BEZIER:
        shaped = bezier_progress(
            progress,
            left.out_handle or BEZIER_LINEAR_OUT_HANDLE,
            right.in_handle or BEZIER_LINEAR_IN_HANDLE,
        )
    else:
        shaped = ease(progress, left.interpolation)
    return tuple(
        start + (end - start) * shaped for start, end in zip(left.value, right.value, strict=True)
    )


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------


def _frame_of(keyframe: Keyframe) -> int:
    return keyframe.frame


def _check_handle(handle: tuple[float, float] | None, label: str) -> None:
    if handle is None:
        return
    if len(handle) != 2:
        raise NovaInvariantError(f"{label} must hold two numbers, got {len(handle)}")
    position, value = handle
    if not 0.0 <= position <= 1.0:
        raise NovaInvariantError(
            f"{label} x must be between 0 and 1 so the curve stays a function, got {position}"
        )
    if not math.isfinite(value):
        raise NovaInvariantError(f"{label} y must be finite, got {value}")


def _wire_handle(data: Mapping[str, object], key: str) -> tuple[float, float] | None:
    raw = data[key]
    if raw is None:
        return None
    values = _wire_floats(data, key)
    if len(values) != 2:
        raise NovaInvariantError(f"'{key}' must hold two numbers, got {len(values)}")
    return (values[0], values[1])
