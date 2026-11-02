"""L2 — effects: parameter values, animation and the effect graph.

An NLE is two machines bolted together: one that decides *when* something is
on screen (``timeline.py``) and one that decides *what it looks like* while it
is there.  This module is the second machine's vocabulary — the authoring model
for everything between a decoded frame and the compositor.

The shape is the one every editor has converged on, from After Effects to
Resolve: **a parameter is a value over time**, an **effect** is a named bag of
parameters plus a mix, and a **chain** is an ordered stack of effects applied
bottom to top.  Plugins add effects by publishing a spec
(:class:`EffectSpec`), not by subclassing anything — which is what lets a
third-party effect be indistinguishable from a built-in one (ADR-0011).

Frames, not seconds — again
---------------------------
Keyframes live on **integer frame numbers**, exactly like clips (ADR-0006).
Interpolation happens between two integer positions, so the value at frame 720
is the same in the preview, in the export and in the test suite, and it is the
same on a 24 fps project as on a 60 fps one because nothing here ever divides
by a frame rate.  Progress within a segment is a float, but it is *derived*
from a frame, never accumulated.

Why the same keyframe model as the captions
-------------------------------------------
ADR-0009 §7 has the animation baker emit "the editor's own keyframes" precisely
so that a caption animation and a clip animation are the same object.  If they
were two models, the preview would use one and the export the other, and they
would disagree on the frame where it matters.

What is deliberately not here
------------------------------
* **Pixels.**  Nothing in this module touches a frame buffer.  An effect
  describes *what to ask for*; ``infra/render`` does the arithmetic, on the CPU
  or the GPU (ADR-0012), and this module stays importable in a test process
  with no NumPy, no OpenCV and no device.
* **The registry.**  Which effects exist is a services-layer catalogue built
  from installed plugins, not a constant in the domain.
* **Ownership.**  A chain does not know whether it decorates a clip, a track or
  the output; that binding belongs to ``project.py``.
"""

from __future__ import annotations

import math
from bisect import bisect_right
from collections.abc import Mapping
from dataclasses import dataclass, field, replace
from enum import StrEnum
from itertools import pairwise
from typing import Final, TypeAlias

from nova_studio.core.errors import NovaInvariantError
from nova_studio.domain._wire import (
    optional_float as _optional_float,
    reject_unknown_fields as _reject_unknown_fields,
    wire_bool as _wire_bool,
    wire_float as _wire_float,
    wire_int as _wire_int,
    wire_mappings as _wire_mappings,
    wire_str as _wire_str,
)

__all__ = [
    "BEZIER_LINEAR_IN_HANDLE",
    "BEZIER_LINEAR_OUT_HANDLE",
    "DEFAULT_CORNER_RADIUS_PX",
    "DEFAULT_FEATHER_PX",
    "PARAM_KIND_WIDTHS",
    "Animatable",
    "BlendMode",
    "Effect",
    "EffectCategory",
    "EffectChain",
    "EffectCost",
    "EffectSpec",
    "EffectTarget",
    "Interpolation",
    "Keyframe",
    "Mask",
    "MaskKind",
    "MaskSample",
    "Param",
    "ParamKind",
    "ParameterSpec",
    "StaticParam",
    "Transform",
    "TransformSample",
    "bezier_progress",
    "ease",
    "interpolate",
    "validate_chain",
    "validate_effect",
    "validate_transform",
]

# ---------------------------------------------------------------------------
# Wire field sets.  A document written by another build must be recognised as
# such, not silently half-read.
# ---------------------------------------------------------------------------

_HANDLE_FIELDS: Final[set[str]] = {"x", "y"}
_KEYFRAME_FIELDS: Final[set[str]] = {
    "frame",
    "value",
    "interpolation",
    "out_handle",
    "in_handle",
}
_ANIMATABLE_FIELDS: Final[set[str]] = {"name", "kind", "value", "keyframes"}
_STATIC_FIELDS: Final[set[str]] = {"name", "value"}
_PARAMETER_SPEC_FIELDS: Final[set[str]] = {
    "name",
    "label",
    "kind",
    "default",
    "minimum",
    "maximum",
    "step",
    "choices",
    "unit",
    "hint",
    "animatable",
}
_EFFECT_SPEC_FIELDS: Final[set[str]] = {
    "type",
    "label",
    "version",
    "category",
    "parameters",
    "targets",
    "cost",
    "supports_gpu",
    "is_generator",
    "is_transition",
    "is_audio",
}
_EFFECT_FIELDS: Final[set[str]] = {"effect_id", "type", "params", "enabled", "mix", "name"}
_PARAM_FIELDS: Final[set[str]] = {"kind", "param"}
_CHAIN_FIELDS: Final[set[str]] = {"effects"}
_TRANSFORM_FIELDS: Final[set[str]] = {
    "position",
    "scale",
    "rotation",
    "anchor",
    "skew",
    "opacity",
    "crop",
    "flip_x",
    "flip_y",
}
_MASK_FIELDS: Final[set[str]] = {
    "mask_id",
    "kind",
    "bounds",
    "feather",
    "corner_radius",
    "opacity",
    "invert",
    "points",
    "name",
}

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

#: Masks are hard-edged and rectangles are square until told otherwise.
DEFAULT_FEATHER_PX: Final[float] = 0.0
DEFAULT_CORNER_RADIUS_PX: Final[float] = 0.0


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


class ParamKind(StrEnum):
    """What a parameter's numbers mean.

    This is what a generated inspector panel reads, and it is why a plugin can
    ship an effect that the UI has never heard of and still get a slider, a
    colour well or a dropdown.
    """

    #: One number, the default.
    SCALAR = "scalar"
    #: Two: position, scale, skew.
    VECTOR2 = "vector2"
    #: Three: RGB, lift/gain/gamma.
    VECTOR3 = "vector3"
    #: Four: crop edges, a rectangle, RGBA.
    VECTOR4 = "vector4"
    #: Degrees, clockwise.  Rendered with a dial, wrapped at 360.
    ANGLE = "angle"
    #: A fraction; the UI shows 0-100, the model keeps 0-1.
    PERCENT = "percent"
    #: Whole numbers only: tap counts, iterations, octaves.
    INTEGER = "integer"
    #: Three or four numbers 0-1, shown as a colour well.
    COLOUR = "colour"
    #: True or false.  Not animatable: a switch cannot be half on.
    BOOL = "bool"
    #: One of :attr:`ParameterSpec.choices`.  Not animatable.
    CHOICE = "choice"
    #: Free text.  Not animatable.
    TEXT = "text"
    #: A font family name.  Not animatable.
    FONT = "font"
    #: A path to a resource (a LUT, an overlay).  Not animatable.
    FILE = "file"

    @property
    def width(self) -> int:
        """How many numbers one value of this kind is made of.

        Zero for the kinds that are not numbers at all.
        """
        return _KIND_WIDTHS[self]

    @property
    def is_numeric(self) -> bool:
        """Whether the kind is made of numbers, and so can be animated."""
        return self in _NUMERIC_KINDS


#: The arity of every numeric kind.  Kept as data so ``width`` cannot drift
#: away from the enum by an editing mistake in one branch of an ``if``.
PARAM_KIND_WIDTHS: Final[Mapping[ParamKind, int]] = {
    ParamKind.SCALAR: 1,
    ParamKind.VECTOR2: 2,
    ParamKind.VECTOR3: 3,
    ParamKind.VECTOR4: 4,
    ParamKind.ANGLE: 1,
    ParamKind.PERCENT: 1,
    ParamKind.INTEGER: 1,
    ParamKind.COLOUR: 3,
    ParamKind.BOOL: 0,
    ParamKind.CHOICE: 0,
    ParamKind.TEXT: 0,
    ParamKind.FONT: 0,
    ParamKind.FILE: 0,
}

_KIND_WIDTHS: Final[Mapping[ParamKind, int]] = PARAM_KIND_WIDTHS

_NUMERIC_KINDS: Final[frozenset[ParamKind]] = frozenset(
    {kind for kind, width in PARAM_KIND_WIDTHS.items() if width > 0}
)


class EffectCategory(StrEnum):
    """Where an effect appears in the browser, and what it is grouped with."""

    #: Geometry: position, scale, rotation, crop.
    TRANSFORM = "transform"
    #: Colour correction and grading.
    COLOUR = "colour"
    #: Softening: gaussian, box, motion, lens.
    BLUR = "blur"
    #: Detail recovery, sharpening.
    SHARPEN = "sharpen"
    #: Geometric warps: lens distortion, ripple, corner pin.
    DISTORT = "distort"
    #: Looks: film grain, vignette, chromatic aberration, glow.
    STYLIZE = "stylize"
    #: Makes a picture from nothing: solids, gradients, noise.
    GENERATOR = "generator"
    #: Only meaningful inside a transition window.
    TRANSITION = "transition"
    #: Operates on samples, not pixels.
    AUDIO = "audio"
    #: Anything else, which in practice means "supplied by a plugin".
    CUSTOM = "custom"


class EffectTarget(StrEnum):
    """What an effect may be attached to."""

    #: One clip: the common case.
    CLIP = "clip"
    #: Everything on one track — an adjustment layer's worth of grading.
    TRACK = "track"
    #: The whole frame, after compositing: the output grade.
    OUTPUT = "output"


class EffectCost(StrEnum):
    """How expensive an effect is, which is a *hint* to the scheduler.

    Preview drops expensive effects below a chosen quality before it drops
    frame rate; export never does.  Being a hint is the point: a wrong guess
    costs a slower preview, not a wrong picture.
    """

    #: Per-pixel arithmetic, no neighbourhood: grade, opacity, transform.
    CHEAP = "cheap"
    #: A small kernel or one extra pass: blur, sharpen.
    MODERATE = "moderate"
    #: Multi-pass, optical flow, or a model.  Preview may skip it.
    EXPENSIVE = "expensive"


class BlendMode(StrEnum):
    """How a layer combines with what is underneath it."""

    NORMAL = "normal"
    MULTIPLY = "multiply"
    SCREEN = "screen"
    OVERLAY = "overlay"
    DARKEN = "darken"
    LIGHTEN = "lighten"
    COLOR_DODGE = "color-dodge"
    COLOR_BURN = "color-burn"
    HARD_LIGHT = "hard-light"
    SOFT_LIGHT = "soft-light"
    DIFFERENCE = "difference"
    EXCLUSION = "exclusion"
    #: The four below are **non-separable**: they need the whole colour, not
    #: each channel on its own (see :attr:`is_separable`).
    HUE = "hue"
    SATURATION = "saturation"
    COLOR = "color"
    LUMINOSITY = "luminosity"
    #: Additive, for glows and light leaks.  Clips above white.
    ADD = "add"
    SUBTRACT = "subtract"

    @property
    def is_separable(self) -> bool:
        """Whether the mode can be evaluated one channel at a time.

        A separable mode can be vectorised straight across an RGB plane; the
        four non-separable ones must be converted to a hue-based colour space
        first, which is why they are both slower and easier to get wrong.
        """
        return self not in _NON_SEPARABLE_BLEND_MODES


_NON_SEPARABLE_BLEND_MODES: Final[frozenset[BlendMode]] = frozenset(
    {BlendMode.HUE, BlendMode.SATURATION, BlendMode.COLOR, BlendMode.LUMINOSITY}
)


class MaskKind(StrEnum):
    """What shapes the alpha of a layer."""

    #: A rounded rectangle, the workhorse.
    RECTANGLE = "rectangle"
    #: An ellipse inscribed in the same bounds.
    ELLIPSE = "ellipse"
    #: A closed polygon of normalised points.  Captured at one resolution and
    #: never interpolated here — freehand shape animation belongs to the shape
    #: system, which owns the path topology.
    PATH = "path"
    #: The layer's own alpha channel.
    ALPHA = "alpha"
    #: Brightness: white shows, black hides, which is how a matte video works.
    LUMINANCE = "luminance"

    @property
    def uses_bounds(self) -> bool:
        """Whether :attr:`Mask.bounds` is meaningful for this kind."""
        return self in _BOUNDED_MASK_KINDS


_BOUNDED_MASK_KINDS: Final[frozenset[MaskKind]] = frozenset({MaskKind.RECTANGLE, MaskKind.ELLIPSE})

# ---------------------------------------------------------------------------
# Easing
# ---------------------------------------------------------------------------


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
    kind: ParamKind = ParamKind.SCALAR
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
    def constant(cls, name: str, *values: float, kind: ParamKind = ParamKind.SCALAR) -> Animatable:
        """A parameter that never changes over time."""
        return cls(name=name, value=values, kind=kind)

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
            "kind": str(self.kind),
            "value": list(self.value),
            "keyframes": [keyframe.to_wire() for keyframe in self.keyframes],
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> Animatable:
        _reject_unknown_fields(data, _ANIMATABLE_FIELDS)
        return cls(
            name=_wire_str(data, "name"),
            kind=ParamKind(_wire_str(data, "kind")),
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
# Parameters
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True, kw_only=True)
class StaticParam:
    """A parameter that is not numbers, and so cannot be animated.

    A blur *mode*, a font, a LUT path, a checkbox.  It answers the same
    question an :class:`Animatable` does — its value at a frame — and simply
    ignores the frame, so the renderer can treat every parameter alike.
    """

    name: str
    value: str | bool | int | float

    def __post_init__(self) -> None:
        if not self.name:
            raise NovaInvariantError("name must not be empty")
        if isinstance(self.value, float) and not math.isfinite(self.value):
            raise NovaInvariantError(f"value must be finite, got {self.value}")

    def at(self, _frame: int) -> str | bool | int | float:
        """The value, whatever the frame: a constant is a constant."""
        return self.value

    def to_wire(self) -> dict[str, object]:
        return {"name": self.name, "value": self.value}

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> StaticParam:
        _reject_unknown_fields(data, _STATIC_FIELDS)
        raw = data["value"]
        if isinstance(raw, bool | str | int | float):
            return cls(name=_wire_str(data, "name"), value=raw)
        raise NovaInvariantError(
            f"'value' must be a string, number or bool, got {type(raw).__name__}"
        )


#: A parameter of either kind: the thing an effect is made of.
Param: TypeAlias = Animatable | StaticParam


@dataclass(frozen=True, slots=True, kw_only=True)
class ParameterSpec:
    """What one parameter of an effect *is*.

    This is the contract between an effect and everything that is not the
    effect: the inspector panel that renders a control, the validator that
    refuses nonsense, and the UI that decides whether a stopwatch is offered.
    """

    name: str
    label: str
    kind: ParamKind = ParamKind.SCALAR
    #: The value a freshly-added effect gets.  A tuple for numeric kinds, a
    #: string for text, file, font and choice, a bool for a switch.
    default: tuple[float, ...] | str | bool = (0.0,)
    #: Per-component floor, or ``None`` for unbounded.
    minimum: tuple[float, ...] | None = None
    #: Per-component ceiling, or ``None`` for unbounded.
    maximum: tuple[float, ...] | None = None
    #: Granularity for a slider; ``None`` means continuous.
    step: float | None = None
    #: The allowed values when ``kind`` is ``CHOICE``.
    choices: tuple[str, ...] = ()
    #: "px", "deg", "%", "dB" — appended to the number in the UI.
    unit: str = ""
    #: One line of help for the inspector.
    hint: str = ""
    #: Whether a stopwatch is offered.  False pins the value for the life of
    #: the effect, which is what most plugins want for a mode switch.
    animatable: bool = True

    def __post_init__(self) -> None:
        if not self.name:
            raise NovaInvariantError("name must not be empty")
        if not self.label:
            raise NovaInvariantError("label must not be empty")
        # The bounds are checked first: the default is validated against them,
        # and a bound of the wrong arity would otherwise surface as an unrelated
        # arithmetic error deep inside the comparison.
        _check_bounds(self.minimum, self.width, "minimum")
        _check_bounds(self.maximum, self.width, "maximum")
        if self.step is not None and self.step <= 0.0:
            raise NovaInvariantError(f"step must be positive, got {self.step}")
        if self.kind.is_numeric:
            self._check_numeric_default()
        elif self.kind is ParamKind.BOOL:
            if not isinstance(self.default, bool):
                raise NovaInvariantError(
                    f"default for a bool parameter must be a bool, got {self.default!r}"
                )
        elif not isinstance(self.default, str):
            raise NovaInvariantError(
                f"default for a {self.kind} parameter must be a str, got {self.default!r}"
            )
        if self.kind is ParamKind.CHOICE and not self.choices:
            raise NovaInvariantError("a choice parameter must offer at least one choice")
        if (
            self.kind is ParamKind.CHOICE
            and isinstance(self.default, str)
            and self.default not in self.choices
        ):
            raise NovaInvariantError(f"default {self.default!r} is not one of {list(self.choices)}")

    def _check_numeric_default(self) -> None:
        if not isinstance(self.default, tuple):
            raise NovaInvariantError(
                f"default for a {self.kind} parameter must be a tuple, got {self.default!r}"
            )
        _check_bounds(self.default, self.width, "default")
        # An absent bound is an infinite one, so the comparison is simply never
        # hit rather than needing a separate branch per side.
        floors = self.minimum or (-math.inf,) * self.width
        ceilings = self.maximum or (math.inf,) * self.width
        for component, low, high in zip(self.default, floors, ceilings, strict=True):
            if not math.isfinite(component):
                raise NovaInvariantError(f"default components must be finite, got {self.default}")
            if component < low or component > high:
                raise NovaInvariantError(
                    f"default component {component} is outside [{low}, {high}] for '{self.name}'"
                )

    @property
    def width(self) -> int:
        """How many numbers one value of this parameter is made of."""
        return self.kind.width

    @property
    def numeric_default(self) -> tuple[float, ...]:
        """The default, as numbers.

        :raises NovaInvariantError: if the kind is not numeric.
        """
        if not isinstance(self.default, tuple):
            raise NovaInvariantError(f"'{self.name}' is a {self.kind}, its default is not numbers")
        return self.default

    @property
    def static_default(self) -> str | bool:
        """The default, as a value that cannot be animated.

        :raises NovaInvariantError: if the kind is numeric.
        """
        if isinstance(self.default, tuple):
            raise NovaInvariantError(f"'{self.name}' is a {self.kind}, its default is numbers")
        return self.default

    def to_wire(self) -> dict[str, object]:
        return {
            "name": self.name,
            "label": self.label,
            "kind": str(self.kind),
            "default": _wire_value(self.default),
            "minimum": None if self.minimum is None else list(self.minimum),
            "maximum": None if self.maximum is None else list(self.maximum),
            "step": self.step,
            "choices": list(self.choices),
            "unit": self.unit,
            "hint": self.hint,
            "animatable": self.animatable,
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> ParameterSpec:
        _reject_unknown_fields(data, _PARAMETER_SPEC_FIELDS)
        return cls(
            name=_wire_str(data, "name"),
            label=_wire_str(data, "label"),
            kind=ParamKind(_wire_str(data, "kind")),
            default=_wire_default(data, "default"),
            minimum=_wire_bounds(data, "minimum"),
            maximum=_wire_bounds(data, "maximum"),
            step=_optional_float(data, "step"),
            choices=tuple(_wire_strings(data, "choices")),
            unit=_wire_str(data, "unit"),
            hint=_wire_str(data, "hint"),
            animatable=_wire_bool(data, "animatable"),
        )


@dataclass(frozen=True, slots=True, kw_only=True)
class EffectSpec:
    """The published description of an effect: what it is and what it takes.

    A built-in and a plugin ship the same thing.  Nothing in the domain knows
    or cares which one it came from, which is the whole point of ADR-0011.
    """

    type: str
    label: str
    #: Bumped when a parameter changes meaning.  A document that names an older
    #: version is migrated by the services layer, not silently reinterpreted.
    version: int = 1
    category: EffectCategory = EffectCategory.CUSTOM
    parameters: tuple[ParameterSpec, ...] = ()
    targets: frozenset[EffectTarget] = frozenset({EffectTarget.CLIP})
    cost: EffectCost = EffectCost.MODERATE
    supports_gpu: bool = False
    #: Generates a picture from nothing, so it needs no input frame.
    is_generator: bool = False
    #: Only meaningful inside a transition window.
    is_transition: bool = False
    #: Operates on samples rather than pixels.
    is_audio: bool = False

    def __post_init__(self) -> None:
        if not self.type:
            raise NovaInvariantError("type must not be empty")
        if not self.label:
            raise NovaInvariantError("label must not be empty")
        if self.version < 1:
            raise NovaInvariantError(f"version must be at least 1, got {self.version}")
        if not self.targets:
            raise NovaInvariantError("an effect must support at least one target")
        seen: set[str] = set()
        for parameter in self.parameters:
            if parameter.name in seen:
                raise NovaInvariantError(f"two parameters share the name '{parameter.name}'")
            seen.add(parameter.name)

    @property
    def parameter_names(self) -> tuple[str, ...]:
        """The parameter names, in the order the inspector shows them."""
        return tuple(parameter.name for parameter in self.parameters)

    def parameter(self, name: str) -> ParameterSpec | None:
        """The spec for one parameter, or ``None`` if there is no such parameter."""
        for parameter in self.parameters:
            if parameter.name == name:
                return parameter
        return None

    def supports(self, target: EffectTarget) -> bool:
        """Whether the effect can be attached to ``target``."""
        return target in self.targets

    def default_params(self) -> tuple[Param, ...]:
        """A fresh set of parameters at their default values."""
        params: list[Param] = []
        for parameter in self.parameters:
            if parameter.kind.is_numeric:
                # Still an ``Animatable`` when it cannot be animated: the value
                # is numbers either way, and only the stopwatch is withheld.
                params.append(
                    Animatable.constant(
                        parameter.name,
                        *parameter.numeric_default,
                        kind=parameter.kind,
                    )
                )
            else:
                params.append(StaticParam(name=parameter.name, value=parameter.static_default))
        return tuple(params)

    def to_wire(self) -> dict[str, object]:
        return {
            "type": self.type,
            "label": self.label,
            "version": self.version,
            "category": str(self.category),
            "parameters": [parameter.to_wire() for parameter in self.parameters],
            "targets": sorted(str(target) for target in self.targets),
            "cost": str(self.cost),
            "supports_gpu": self.supports_gpu,
            "is_generator": self.is_generator,
            "is_transition": self.is_transition,
            "is_audio": self.is_audio,
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> EffectSpec:
        _reject_unknown_fields(data, _EFFECT_SPEC_FIELDS)
        return cls(
            type=_wire_str(data, "type"),
            label=_wire_str(data, "label"),
            version=_wire_int(data, "version"),
            category=EffectCategory(_wire_str(data, "category")),
            parameters=tuple(
                ParameterSpec.from_wire(entry) for entry in _wire_mappings(data, "parameters")
            ),
            targets=frozenset(EffectTarget(entry) for entry in _wire_strings(data, "targets")),
            cost=EffectCost(_wire_str(data, "cost")),
            supports_gpu=_wire_bool(data, "supports_gpu"),
            is_generator=_wire_bool(data, "is_generator"),
            is_transition=_wire_bool(data, "is_transition"),
            is_audio=_wire_bool(data, "is_audio"),
        )


@dataclass(frozen=True, slots=True, kw_only=True)
class Effect:
    """One effect as applied to something: a type, its parameters, and a mix.

    The parameters are *instances*, not a dictionary of raw JSON, so a typo in
    a plugin payload is caught at load time by :func:`validate_effect` rather
    than surfacing as a black frame an hour into a render.
    """

    effect_id: str
    #: The key into the effect catalogue: ``"nova.gaussian-blur"``, or a
    #: plugin's own reversed-domain name.
    type: str
    params: tuple[Param, ...] = ()
    #: A disabled effect stays in the stack, in order, so the user can put it
    #: back where it was.
    enabled: bool = True
    #: Wet/dry mix, 0-1: how much of the effect's result is blended over its
    #: input.  Zero bypasses it without removing it from the stack.
    mix: float = 1.0
    #: The user's own name for this instance, which is what they look for when
    #: a clip carries six of them.
    name: str = ""

    def __post_init__(self) -> None:
        if not self.effect_id:
            raise NovaInvariantError("effect_id must not be empty")
        if not self.type:
            raise NovaInvariantError("type must not be empty")
        if not 0.0 <= self.mix <= 1.0:
            raise NovaInvariantError(f"mix must be between 0 and 1, got {self.mix}")
        seen: set[str] = set()
        for param in self.params:
            if not param.name:
                raise NovaInvariantError("a parameter must have a name")
            if param.name in seen:
                raise NovaInvariantError(f"two parameters share the name '{param.name}'")
            seen.add(param.name)

    @classmethod
    def for_spec(cls, effect_id: str, spec: EffectSpec, name: str = "") -> Effect:
        """A fresh effect of ``spec``'s type, at its default parameters."""
        return cls(
            effect_id=effect_id,
            type=spec.type,
            params=spec.default_params(),
            name=name,
        )

    @property
    def is_bypassed(self) -> bool:
        """Whether the effect does nothing: switched off, or mixed to zero."""
        return not self.enabled or self.mix == 0.0

    def param(self, name: str) -> Param | None:
        """One parameter by name, or ``None`` if the effect has no such parameter."""
        for param in self.params:
            if param.name == name:
                return param
        return None

    def animatable(self, name: str) -> Animatable | None:
        """One animated parameter by name, or ``None`` if it is absent or static."""
        param = self.param(name)
        return param if isinstance(param, Animatable) else None

    def param_at(self, name: str, frame: int) -> object | None:
        """The value of one parameter at ``frame``, or ``None`` if there is none."""
        param = self.param(name)
        return None if param is None else param.at(frame)

    def with_param(self, param: Param) -> Effect:
        """The effect with ``param`` set, replacing one of that name if there is one."""
        kept = tuple(item for item in self.params if item.name != param.name)
        return replace(self, params=(*kept, param))

    def without_param(self, name: str) -> Effect:
        """The effect with one parameter removed.

        :raises NovaInvariantError: if there is no such parameter.
        """
        kept = tuple(item for item in self.params if item.name != name)
        if len(kept) == len(self.params):
            raise NovaInvariantError(f"no parameter named '{name}' to remove")
        return replace(self, params=kept)

    def with_enabled(self, enabled: bool) -> Effect:
        """The effect, switched on or off."""
        return replace(self, enabled=enabled)

    def with_mix(self, mix: float) -> Effect:
        """The effect at a new wet/dry mix."""
        return replace(self, mix=mix)

    def to_wire(self) -> dict[str, object]:
        return {
            "effect_id": self.effect_id,
            "type": self.type,
            "params": [_param_to_wire(param) for param in self.params],
            "enabled": self.enabled,
            "mix": self.mix,
            "name": self.name,
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> Effect:
        _reject_unknown_fields(data, _EFFECT_FIELDS)
        return cls(
            effect_id=_wire_str(data, "effect_id"),
            type=_wire_str(data, "type"),
            params=tuple(_param_from_wire(entry) for entry in _wire_mappings(data, "params")),
            enabled=_wire_bool(data, "enabled"),
            mix=_wire_float(data, "mix"),
            name=_wire_str(data, "name"),
        )


@dataclass(frozen=True, slots=True, kw_only=True)
class EffectChain:
    """An ordered stack of effects.

    Order is the whole point: blur then sharpen is not sharpen then blur.  The
    first entry is applied first — bottom of the stack, in editor terms.
    """

    effects: tuple[Effect, ...] = ()

    def __post_init__(self) -> None:
        seen: set[str] = set()
        for effect in self.effects:
            if effect.effect_id in seen:
                raise NovaInvariantError(f"two effects share the id '{effect.effect_id}'")
            seen.add(effect.effect_id)

    @property
    def is_empty(self) -> bool:
        """Whether the chain holds nothing at all."""
        return not self.effects

    @property
    def count(self) -> int:
        """How many effects are in the stack, bypassed ones included."""
        return len(self.effects)

    @property
    def active(self) -> tuple[Effect, ...]:
        """The effects that actually do something, in order."""
        return tuple(effect for effect in self.effects if not effect.is_bypassed)

    def effect(self, effect_id: str) -> Effect | None:
        """One effect by id, or ``None`` if the chain has no such effect."""
        for effect in self.effects:
            if effect.effect_id == effect_id:
                return effect
        return None

    def index_of(self, effect_id: str) -> int:
        """Where an effect sits in the stack.

        :raises NovaInvariantError: if it is not in the chain.
        """
        for index, effect in enumerate(self.effects):
            if effect.effect_id == effect_id:
                return index
        raise NovaInvariantError(f"no effect with id '{effect_id}' in this chain")

    def with_effect(self, effect: Effect) -> EffectChain:
        """The chain with ``effect`` appended, putting it last in the stack.

        :raises NovaInvariantError: if its id is already in the chain.
        """
        if self.effect(effect.effect_id) is not None:
            raise NovaInvariantError(f"effect '{effect.effect_id}' is already in this chain")
        return replace(self, effects=(*self.effects, effect))

    def without_effect(self, effect_id: str) -> EffectChain:
        """The chain with one effect removed.

        :raises NovaInvariantError: if it is not in the chain.
        """
        kept = tuple(effect for effect in self.effects if effect.effect_id != effect_id)
        if len(kept) == len(self.effects):
            raise NovaInvariantError(f"no effect with id '{effect_id}' in this chain")
        return replace(self, effects=kept)

    def replaced(self, effect: Effect) -> EffectChain:
        """The chain with one effect replaced in place, keeping the stack order.

        :raises NovaInvariantError: if it is not in the chain.
        """
        index = self.index_of(effect.effect_id)
        effects = list(self.effects)
        effects[index] = effect
        return replace(self, effects=tuple(effects))

    def moved(self, effect_id: str, delta: int) -> EffectChain:
        """The chain with one effect moved ``delta`` places, clamped at the ends.

        Reordering is the most common edit in an effect stack, and clamping
        rather than refusing is what makes dragging feel right: pushing the top
        effect further up simply leaves it at the top.
        """
        index = self.index_of(effect_id)
        target = min(max(index + delta, 0), len(self.effects) - 1)
        effects = list(self.effects)
        moved = effects.pop(index)
        effects.insert(target, moved)
        return replace(self, effects=tuple(effects))

    def shifted(self, delta_frames: int) -> EffectChain:
        """The chain with every animated parameter's keyframes moved."""
        return replace(
            self,
            effects=tuple(
                replace(
                    effect,
                    params=tuple(_shifted_param(param, delta_frames) for param in effect.params),
                )
                for effect in self.effects
            ),
        )

    def to_wire(self) -> dict[str, object]:
        return {"effects": [effect.to_wire() for effect in self.effects]}

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> EffectChain:
        _reject_unknown_fields(data, _CHAIN_FIELDS)
        return cls(
            effects=tuple(Effect.from_wire(entry) for entry in _wire_mappings(data, "effects"))
        )


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def validate_effect(effect: Effect, spec: EffectSpec) -> str:
    """Check an effect instance against the spec that describes it.

    Returns ``""`` when it is well formed, otherwise the first problem found,
    phrased for a support engineer reading a project that will not open.
    """
    if effect.type != spec.type:
        return (
            f"effect '{effect.effect_id}' is of type '{effect.type}' "
            f"but is being checked against '{spec.type}'"
        )
    known = {parameter.name: parameter for parameter in spec.parameters}
    for param in effect.params:
        parameter = known.get(param.name)
        if parameter is None:
            return (
                f"effect '{effect.effect_id}' has a parameter '{param.name}' "
                f"that '{spec.type}' does not declare"
            )
        problem = _validate_param(param, parameter)
        if problem:
            return f"parameter '{param.name}' of effect '{effect.effect_id}': {problem}"
    for parameter in spec.parameters:
        if effect.param(parameter.name) is None:
            return f"parameter '{parameter.name}' of effect '{effect.effect_id}' is missing"
    return ""


def validate_chain(chain: EffectChain, specs: Mapping[str, EffectSpec]) -> str:
    """Check every effect in a chain that has a spec installed.

    An effect whose spec is missing — a plugin that is not installed on this
    machine — is skipped rather than reported.  A project that opens with one
    effect greyed out is a project that opens; refusing to open it would make
    an optional plugin mandatory.
    """
    for effect in chain.effects:
        spec = specs.get(effect.type)
        if spec is None:
            continue
        problem = validate_effect(effect, spec)
        if problem:
            return problem
    return ""


def _validate_param(param: Param, spec: ParameterSpec) -> str:
    """The first thing wrong with one parameter, or ``""``."""
    if spec.kind.is_numeric:
        if not isinstance(param, Animatable):
            return f"must be animatable numbers, got the static value {param.value!r}"
        if param.width != spec.width:
            return f"must hold {spec.width} components, got {param.width}"
        if not spec.animatable and param.is_animated:
            return "is declared not animatable, but carries keyframes"
        for value in param.all_values():
            for index, component in enumerate(value):
                if spec.minimum is not None and component < spec.minimum[index]:
                    return (
                        f"component {index} is {component}, below the minimum {spec.minimum[index]}"
                    )
                if spec.maximum is not None and component > spec.maximum[index]:
                    return (
                        f"component {index} is {component}, above the maximum {spec.maximum[index]}"
                    )
        return ""
    if not isinstance(param, StaticParam):
        return f"must be a static {spec.kind} value, but it carries keyframes"
    if spec.kind is ParamKind.CHOICE and param.value not in spec.choices:
        return f"must be one of {list(spec.choices)}, got {param.value!r}"
    if spec.kind is ParamKind.BOOL and not isinstance(param.value, bool):
        return f"must be a bool, got {param.value!r}"
    if spec.kind in _TEXTUAL_KINDS and not isinstance(param.value, str):
        return f"must be a string, got {param.value!r}"
    return ""


_TEXTUAL_KINDS: Final[frozenset[ParamKind]] = frozenset(
    {ParamKind.TEXT, ParamKind.FONT, ParamKind.FILE}
)


# ---------------------------------------------------------------------------
# Transform: the geometry every picture gets
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True, kw_only=True)
class Transform:
    """Where a picture sits on the frame and how much of it shows.

    Every clip has one, whether the user has touched it or not, which is why it
    is a value object with defaults rather than an effect in a chain.

    Coordinates are **composition pixels with the origin at the centre**, +x
    right and +y down.  They are deliberately not preview pixels: a layer 100 px
    right of centre means the same thing in the 960x540 preview and in the
    3840x2160 export, which is the only way the two can match.
    """

    #: Offset from the composition centre, in composition pixels.
    position: Animatable = field(
        default_factory=lambda: Animatable.constant("position", 0.0, 0.0, kind=ParamKind.VECTOR2)
    )
    #: 1.0 is the source's own size; the pair allows non-uniform stretch.
    scale: Animatable = field(
        default_factory=lambda: Animatable.constant("scale", 1.0, 1.0, kind=ParamKind.VECTOR2)
    )
    #: Degrees clockwise about the anchor.
    rotation: Animatable = field(
        default_factory=lambda: Animatable.constant("rotation", 0.0, kind=ParamKind.ANGLE)
    )
    #: Centre of rotation and scaling, normalised to the clip: (0, 0) is its
    #: middle, (-1, -1) its top-left corner.
    anchor: Animatable = field(
        default_factory=lambda: Animatable.constant("anchor", 0.0, 0.0, kind=ParamKind.VECTOR2)
    )
    #: Degrees of shear, x then y.
    skew: Animatable = field(
        default_factory=lambda: Animatable.constant("skew", 0.0, 0.0, kind=ParamKind.ANGLE)
    )
    #: 0-1.  Zero is invisible but still costs a decode, which is why the
    #: renderer is allowed to skip it on that basis alone.
    opacity: Animatable = field(
        default_factory=lambda: Animatable.constant("opacity", 1.0, kind=ParamKind.PERCENT)
    )
    #: Fraction removed from each edge, left, top, right, bottom.
    crop: Animatable = field(
        default_factory=lambda: Animatable.constant(
            "crop", 0.0, 0.0, 0.0, 0.0, kind=ParamKind.VECTOR4
        )
    )
    flip_x: bool = False
    flip_y: bool = False

    def __post_init__(self) -> None:
        _require_width("position", self.position, 2)
        _require_width("scale", self.scale, 2)
        _require_width("rotation", self.rotation, 1)
        _require_width("anchor", self.anchor, 2)
        _require_width("skew", self.skew, 2)
        _require_width("opacity", self.opacity, 1)
        _require_width("crop", self.crop, 4)

    @property
    def is_static(self) -> bool:
        """Whether no part of the transform changes over time.

        A static transform can be turned into one matrix once and reused for
        every frame of the clip, which is the most valuable fast path in the
        compositor.  A single keyframe counts: it pins a constant.
        """
        return not any(
            _changes_over_time(parameter)
            for parameter in (
                self.position,
                self.scale,
                self.rotation,
                self.anchor,
                self.skew,
                self.opacity,
                self.crop,
            )
        )

    def at(self, frame: int) -> TransformSample:
        """The geometry at one frame: what the compositor actually evaluates."""
        crop = self.crop.at(frame)
        return TransformSample(
            position=_pair(self.position, frame),
            scale=_pair(self.scale, frame),
            rotation=self.rotation.scalar_at(frame),
            anchor=_pair(self.anchor, frame),
            skew=_pair(self.skew, frame),
            opacity=self.opacity.scalar_at(frame),
            crop=(crop[0], crop[1], crop[2], crop[3]),
            flip_x=self.flip_x,
            flip_y=self.flip_y,
        )

    def shifted(self, delta_frames: int) -> Transform:
        """The transform with every keyframe moved."""
        return replace(
            self,
            position=self.position.shifted(delta_frames),
            scale=self.scale.shifted(delta_frames),
            rotation=self.rotation.shifted(delta_frames),
            anchor=self.anchor.shifted(delta_frames),
            skew=self.skew.shifted(delta_frames),
            opacity=self.opacity.shifted(delta_frames),
            crop=self.crop.shifted(delta_frames),
        )

    def to_wire(self) -> dict[str, object]:
        return {
            "position": self.position.to_wire(),
            "scale": self.scale.to_wire(),
            "rotation": self.rotation.to_wire(),
            "anchor": self.anchor.to_wire(),
            "skew": self.skew.to_wire(),
            "opacity": self.opacity.to_wire(),
            "crop": self.crop.to_wire(),
            "flip_x": self.flip_x,
            "flip_y": self.flip_y,
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> Transform:
        _reject_unknown_fields(data, _TRANSFORM_FIELDS)
        return cls(
            position=Animatable.from_wire(_mapping(data, "position")),
            scale=Animatable.from_wire(_mapping(data, "scale")),
            rotation=Animatable.from_wire(_mapping(data, "rotation")),
            anchor=Animatable.from_wire(_mapping(data, "anchor")),
            skew=Animatable.from_wire(_mapping(data, "skew")),
            opacity=Animatable.from_wire(_mapping(data, "opacity")),
            crop=Animatable.from_wire(_mapping(data, "crop")),
            flip_x=_wire_bool(data, "flip_x"),
            flip_y=_wire_bool(data, "flip_y"),
        )


@dataclass(frozen=True, slots=True, kw_only=True)
class TransformSample:
    """A :class:`Transform` resolved at one frame.

    Plain floats, no keyframes: this is the last stop before the compositor
    turns it into a matrix.
    """

    position: tuple[float, float]
    scale: tuple[float, float]
    rotation: float
    anchor: tuple[float, float]
    skew: tuple[float, float]
    opacity: float
    #: Left, top, right, bottom, as fractions removed.
    crop: tuple[float, float, float, float]
    flip_x: bool
    flip_y: bool

    @property
    def is_opaque(self) -> bool:
        """Whether the layer hides everything below it."""
        return self.opacity >= 1.0

    @property
    def is_identity(self) -> bool:
        """Whether this geometry is a no-op: centred, unscaled, uncropped."""
        return (
            self.position == (0.0, 0.0)
            and self.scale == (1.0, 1.0)
            and self.rotation == 0.0
            and self.anchor == (0.0, 0.0)
            and self.skew == (0.0, 0.0)
            and self.opacity == 1.0
            and self.crop == (0.0, 0.0, 0.0, 0.0)
            and not self.flip_x
            and not self.flip_y
        )

    def source_size(self, width: int, height: int) -> tuple[float, float]:
        """How many source pixels survive the crop, before scaling.

        This is what answers "which proxy do I need" — a clip cropped to a
        quarter of its width needs a quarter of the resolution for the same
        quality on screen.
        """
        left, top, right, bottom = self.crop
        return (width * (1.0 - left - right), height * (1.0 - top - bottom))

    def rendered_size(self, width: int, height: int) -> tuple[float, float]:
        """How big the layer ends up on the frame, in composition pixels."""
        source_width, source_height = self.source_size(width, height)
        scale_x, scale_y = self.scale
        return (abs(source_width * scale_x), abs(source_height * scale_y))

    def is_visible(self, width: int, height: int) -> bool:
        """Whether there is anything to draw.

        A layer scaled to nothing, cropped away entirely or faded out costs a
        decode and a composite for no pixels, so the resolver asks first.
        """
        if self.opacity <= 0.0:
            return False
        if self.scale[0] == 0.0 or self.scale[1] == 0.0:
            return False
        source_width, source_height = self.source_size(width, height)
        return source_width > 0.0 and source_height > 0.0


def validate_transform(transform: Transform) -> str:
    """Check a transform's geometry, keyframes included.

    ``Transform`` validates the parts that are cheap to check at construction;
    this walks every keyframe as well, because a project can arrive with an
    opacity of 1.4 pinned to frame 900 and nothing else wrong with it.
    """
    for value in transform.opacity.all_values():
        if not 0.0 <= value[0] <= 1.0:
            return f"opacity must be between 0 and 1, got {value[0]}"
    for value in transform.crop.all_values():
        left, top, right, bottom = value
        for side, name in zip(value, ("left", "top", "right", "bottom"), strict=True):
            if not 0.0 <= side <= 1.0:
                return f"crop {name} must be between 0 and 1, got {side}"
        if left + right >= 1.0:
            return f"crop left+right must leave something, got {left} + {right}"
        if top + bottom >= 1.0:
            return f"crop top+bottom must leave something, got {top} + {bottom}"
    return ""


# ---------------------------------------------------------------------------
# Masks
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True, kw_only=True)
class Mask:
    """A shape that decides which part of a layer is allowed to show.

    Bounds are **fractions of the layer with the origin at its top-left**, so a
    rectangle covering the whole layer is ``(0.5, 0.5, 1.0, 1.0)``: centre-x,
    centre-y, width, height.  Fractions rather than pixels, so a mask survives
    a change of resolution and a proxy swap.
    """

    mask_id: str
    kind: MaskKind = MaskKind.RECTANGLE
    #: Centre and size as fractions of the layer.  Ignored by PATH, ALPHA and
    #: LUMINANCE, which take their shape from the layer itself.
    bounds: Animatable = field(
        default_factory=lambda: Animatable.constant(
            "bounds", 0.5, 0.5, 1.0, 1.0, kind=ParamKind.VECTOR4
        )
    )
    #: Softness of the edge, in composition pixels.
    feather: Animatable = field(
        default_factory=lambda: Animatable.constant("feather", DEFAULT_FEATHER_PX)
    )
    #: Rounded corner radius for a rectangle, in composition pixels.
    corner_radius: Animatable = field(
        default_factory=lambda: Animatable.constant("corner_radius", DEFAULT_CORNER_RADIUS_PX)
    )
    #: How strongly the mask applies, 0-1.
    opacity: Animatable = field(
        default_factory=lambda: Animatable.constant("opacity", 1.0, kind=ParamKind.PERCENT)
    )
    #: Show the outside instead of the inside.
    invert: bool = False
    #: A closed polygon in normalised layer coordinates, -1 to 1, origin at the
    #: layer centre.  Only for PATH, and never interpolated.
    points: tuple[tuple[float, float], ...] = ()
    name: str = ""

    def __post_init__(self) -> None:
        if not self.mask_id:
            raise NovaInvariantError("mask_id must not be empty")
        _require_width("bounds", self.bounds, 4)
        _require_width("feather", self.feather, 1)
        _require_width("corner_radius", self.corner_radius, 1)
        _require_width("opacity", self.opacity, 1)
        if self.kind is MaskKind.PATH and len(self.points) < 3:
            raise NovaInvariantError(
                f"a path mask needs at least three points, got {len(self.points)}"
            )
        if self.points and self.kind is not MaskKind.PATH:
            raise NovaInvariantError(
                f"a {self.kind} mask takes its shape from its bounds, not from points"
            )
        for point in self.points:
            if len(point) != 2:
                raise NovaInvariantError(f"each path point must be a pair, got {point}")

    @property
    def is_full_frame(self) -> bool:
        """Whether a bounded mask covers the whole layer at its static value."""
        return self.kind.uses_bounds and self.bounds.value == (0.5, 0.5, 1.0, 1.0)

    def at(self, frame: int) -> MaskSample:
        """The mask resolved at one frame."""
        bounds = self.bounds.at(frame)
        return MaskSample(
            bounds=(bounds[0], bounds[1], bounds[2], bounds[3]),
            feather=self.feather.scalar_at(frame),
            corner_radius=self.corner_radius.scalar_at(frame),
            opacity=self.opacity.scalar_at(frame),
            invert=self.invert,
            points=self.points,
        )

    def shifted(self, delta_frames: int) -> Mask:
        """The mask with every keyframe moved."""
        return replace(
            self,
            bounds=self.bounds.shifted(delta_frames),
            feather=self.feather.shifted(delta_frames),
            corner_radius=self.corner_radius.shifted(delta_frames),
            opacity=self.opacity.shifted(delta_frames),
        )

    def to_wire(self) -> dict[str, object]:
        return {
            "mask_id": self.mask_id,
            "kind": str(self.kind),
            "bounds": self.bounds.to_wire(),
            "feather": self.feather.to_wire(),
            "corner_radius": self.corner_radius.to_wire(),
            "opacity": self.opacity.to_wire(),
            "invert": self.invert,
            "points": [[x, y] for x, y in self.points],
            "name": self.name,
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> Mask:
        _reject_unknown_fields(data, _MASK_FIELDS)
        return cls(
            mask_id=_wire_str(data, "mask_id"),
            kind=MaskKind(_wire_str(data, "kind")),
            bounds=Animatable.from_wire(_mapping(data, "bounds")),
            feather=Animatable.from_wire(_mapping(data, "feather")),
            corner_radius=Animatable.from_wire(_mapping(data, "corner_radius")),
            opacity=Animatable.from_wire(_mapping(data, "opacity")),
            invert=_wire_bool(data, "invert"),
            points=tuple(_wire_points(data, "points")),
            name=_wire_str(data, "name"),
        )


@dataclass(frozen=True, slots=True, kw_only=True)
class MaskSample:
    """A :class:`Mask` resolved at one frame."""

    bounds: tuple[float, float, float, float]
    feather: float
    corner_radius: float
    opacity: float
    invert: bool
    points: tuple[tuple[float, float], ...]

    @property
    def is_effective(self) -> bool:
        """Whether the mask changes anything: it applies and it is not a no-op."""
        return self.opacity > 0.0


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------


def _frame_of(keyframe: Keyframe) -> int:
    return keyframe.frame


def _changes_over_time(parameter: Animatable) -> bool:
    """Whether a parameter needs evaluating per frame.

    One keyframe pins a value, so it does not: only two or more make a curve.
    """
    return len(parameter.keyframes) > 1


def _pair(parameter: Animatable, frame: int) -> tuple[float, float]:
    value = parameter.at(frame)
    return (value[0], value[1])


def _require_width(name: str, parameter: Animatable, width: int) -> None:
    if parameter.width != width:
        raise NovaInvariantError(f"'{name}' must hold {width} components, got {parameter.width}")


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


def _check_bounds(bounds: tuple[float, ...] | None, width: int, label: str) -> None:
    if bounds is None:
        return
    if len(bounds) != width:
        raise NovaInvariantError(
            f"{label} must hold {width} components to match the kind, got {len(bounds)}"
        )
    for component in bounds:
        if not math.isfinite(component):
            raise NovaInvariantError(f"{label} components must be finite, got {bounds}")


def _shifted_param(param: Param, delta_frames: int) -> Param:
    return param.shifted(delta_frames) if isinstance(param, Animatable) else param


def _param_to_wire(param: Param) -> dict[str, object]:
    # A tag, not a guess: a reader must not have to inspect the shape of a
    # payload to know which of the two parameter kinds it holds.  The parameter
    # is nested so the tag cannot collide with the ``kind`` field an
    # ``Animatable`` already carries.
    return {
        "kind": "animatable" if isinstance(param, Animatable) else "static",
        "param": param.to_wire(),
    }


def _param_from_wire(data: Mapping[str, object]) -> Param:
    _reject_unknown_fields(data, _PARAM_FIELDS)
    kind = _wire_str(data, "kind")
    payload = _mapping(data, "param")
    if kind == "animatable":
        return Animatable.from_wire(payload)
    if kind == "static":
        return StaticParam.from_wire(payload)
    raise NovaInvariantError(f"parameter kind must be 'animatable' or 'static', got {kind!r}")


def _mapping(data: Mapping[str, object], key: str) -> Mapping[str, object]:
    raw = data[key]
    if not isinstance(raw, Mapping):
        raise NovaInvariantError(f"'{key}' must be a mapping, got {type(raw).__name__}")
    return raw


def _wire_value(value: tuple[float, ...] | str | bool) -> object:
    return list(value) if isinstance(value, tuple) else value


def _wire_floats(data: Mapping[str, object], key: str) -> tuple[float, ...]:
    raw = data[key]
    if not isinstance(raw, list):
        raise NovaInvariantError(f"'{key}' must be a list, got {type(raw).__name__}")
    values: list[float] = []
    for entry in raw:
        if isinstance(entry, bool) or not isinstance(entry, int | float):
            raise NovaInvariantError(
                f"every entry of '{key}' must be a number, got {type(entry).__name__}"
            )
        values.append(float(entry))
    return tuple(values)


def _wire_strings(data: Mapping[str, object], key: str) -> list[str]:
    raw = data[key]
    if not isinstance(raw, list):
        raise NovaInvariantError(f"'{key}' must be a list, got {type(raw).__name__}")
    values: list[str] = []
    for entry in raw:
        if not isinstance(entry, str):
            raise NovaInvariantError(
                f"every entry of '{key}' must be a str, got {type(entry).__name__}"
            )
        values.append(entry)
    return values


def _wire_bounds(data: Mapping[str, object], key: str) -> tuple[float, ...] | None:
    raw = data[key]
    return None if raw is None else _wire_floats(data, key)


def _wire_default(data: Mapping[str, object], key: str) -> tuple[float, ...] | str | bool:
    raw = data[key]
    if isinstance(raw, bool | str):
        return raw
    return _wire_floats(data, key)


def _wire_handle(data: Mapping[str, object], key: str) -> tuple[float, float] | None:
    raw = data[key]
    if raw is None:
        return None
    values = _wire_floats(data, key)
    if len(values) != 2:
        raise NovaInvariantError(f"'{key}' must hold two numbers, got {len(values)}")
    return (values[0], values[1])


def _wire_points(data: Mapping[str, object], key: str) -> list[tuple[float, float]]:
    raw = data[key]
    if not isinstance(raw, list):
        raise NovaInvariantError(f"'{key}' must be a list, got {type(raw).__name__}")
    points: list[tuple[float, float]] = []
    for entry in raw:
        if not isinstance(entry, list) or len(entry) != 2:
            raise NovaInvariantError(f"every entry of '{key}' must be a pair, got {entry!r}")
        first, second = entry
        if isinstance(first, bool) or not isinstance(first, int | float):
            raise NovaInvariantError(f"point coordinates must be numbers, got {first!r}")
        if isinstance(second, bool) or not isinstance(second, int | float):
            raise NovaInvariantError(f"point coordinates must be numbers, got {second!r}")
        points.append((float(first), float(second)))
    return points
