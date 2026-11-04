"""L2 — colour grading: the look applied after a picture is composited.

A grade is the last thing that happens to a frame and the first thing a client
comments on, which makes it the part of the model most likely to be rebuilt
badly in a hurry.  Three rules keep it honest.

**Nothing here touches a pixel.**  This module describes *what to ask for* — a
number of stops, a curve, a LUT to sample — and the renderer turns that into a
3D texture or a shader.  It is why this file imports no NumPy, no OpenCV and no
device, and why it is testable in a process that has none of them (ADR-0012).

**Every correction is animatable, and every one is 0-neutral.**  A grade is not
a preset you apply once; it is a set of sliders a user rides across a shot to
follow the sun going behind a cloud.  So each correction is an
:class:`~nova_studio.domain.animation.Animatable`, exactly like an effect
parameter or a transform, and a grade that never moves is simply one with no
keyframes — the same object, the same code path, no second type to keep in sync.
Neutral is **zero for every correction**, with one exception (the LUT mix, which
is a proportion and so is naturally 0-1).  Uniformity matters more here than
familiarity: a model where three sliders are 0-neutral and two are 1-neutral is
a model where a default gets copied into the wrong field at 2 a.m.

**A neutral grade costs nothing.**  :attr:`ColourGrade.is_neutral` and
:attr:`GradeSample.is_neutral` let the compositor skip the pass entirely.  Most
clips in most projects are ungraded, and that is the common case worth
protecting.

Units, and how the renderer turns them into numbers
---------------------------------------------------
===============  =====  ==========================================================
Correction       Width  Renderer's reading
===============  =====  ==========================================================
``exposure``     1      stops: ``2 ** exposure``
``contrast``     1      linear about mid-grey: ``(v - 0.5) * (1 + contrast) + 0.5``
``saturation``   1      stops: ``2 ** saturation`` (0 keeps the shot as graded)
``temperature``  1      -1 is fully cool, +1 fully warm; white balance in the
                        working space (ADR-0012)
``tint``         1      -1 is green, +1 is magenta
``lift``         3      added to the shadows, per channel
``gamma``        3      added to the midtone exponent, per channel
``gain``         3      added to the highlights, per channel
``lut_strength`` 1      0-1 mix between the graded and the ungraded image
===============  =====  ==========================================================

Curves are **monotone cubic** (Fritsch–Carlson), never a plain Catmull-Rom
spline: a spline that overshoots turns a gentle S-curve into a band of inverted
contrast, and a user drags a curve in *shapes*, not in control points, so the
shape they see must be the shape they get.  Monotonicity is also what makes the
evaluation cheap and total: the renderer builds a 1-D table from
:meth:`GradeCurve.at` and never worries about a kink.
"""

from __future__ import annotations

import math
from bisect import bisect_right
from collections.abc import Mapping
from dataclasses import dataclass, field, replace
from enum import StrEnum
from typing import Final

from nova_studio.core.errors import NovaInvariantError
from nova_studio.domain._wire import (
    reject_unknown_fields as _reject_unknown_fields,
    wire_bool as _wire_bool,
    wire_float as _wire_float,
    wire_int as _wire_int,
    wire_mappings as _wire_mappings,
    wire_str as _wire_str,
)
from nova_studio.domain.animation import Animatable

__all__ = [
    "BALANCE_LIMIT",
    "CONTRAST_LIMIT",
    "DEFAULT_LUT_SIZE",
    "EXPOSURE_LIMIT",
    "LUT_SIZES",
    "MAX_CURVE_POINTS",
    "SATURATION_LIMIT",
    "SUPPORTED_LUT_SIZES",
    "WHEEL_LIMIT",
    "ColourGrade",
    "CurveChannel",
    "GradeCurve",
    "GradeSample",
    "Lut",
    "validate_grade",
]

# ---------------------------------------------------------------------------
# Wire field sets
# ---------------------------------------------------------------------------

_CURVE_FIELDS: Final[set[str]] = {"channel", "points"}
_LUT_FIELDS: Final[set[str]] = {"lut_id", "name", "path", "size"}
_GRADE_FIELDS: Final[set[str]] = {
    "exposure",
    "contrast",
    "saturation",
    "temperature",
    "tint",
    "lift",
    "gamma",
    "gain",
    "lut_strength",
    "curves",
    "lut",
    "enabled",
}

# ---------------------------------------------------------------------------
# Limits
# ---------------------------------------------------------------------------

#: Stops of exposure either way.  Four is more than any sensor recovers and less
#: than what turns a shot into mud, so it is where the slider stops.
EXPOSURE_LIMIT: Final[float] = 4.0
#: Contrast is linear about mid-grey; -1 flattens the picture to grey.
CONTRAST_LIMIT: Final[float] = 1.0
#: Saturation is measured in stops too, so it is symmetric: -1 halves it.
SATURATION_LIMIT: Final[float] = 2.0
#: White balance, -1 to +1: the ends of what a camera's own control offers.
BALANCE_LIMIT: Final[float] = 1.0
#: How far one colour wheel may be pushed, per channel.
WHEEL_LIMIT: Final[float] = 0.5

#: A control point count beyond this is a mistake, not a curve.  A renderer
#: builds a table from these; a hundred points is a hundred decisions a user did
#: not make.
MAX_CURVE_POINTS: Final[int] = 32

#: Cube edge lengths a LUT file is allowed to declare.  These are the sizes the
#: industry actually ships; anything else is a file we cannot sample sanely.
SUPPORTED_LUT_SIZES: Final[frozenset[int]] = frozenset({17, 33, 65})
DEFAULT_LUT_SIZE: Final[int] = 33
LUT_SIZES: Final[frozenset[int]] = SUPPORTED_LUT_SIZES


# ---------------------------------------------------------------------------
# Curves
# ---------------------------------------------------------------------------


class CurveChannel(StrEnum):
    """Which channel a :class:`GradeCurve` bends."""

    #: Applied to red, green and blue together — the everyday S-curve.
    MASTER = "master"
    RED = "red"
    GREEN = "green"
    BLUE = "blue"


@dataclass(frozen=True, slots=True, kw_only=True)
class GradeCurve:
    """One tone curve: control points, and the shape between them.

    Points are ``(x, y)`` pairs in 0-1 with ``x`` **strictly increasing**, the
    first at ``x == 0`` and the last at ``x == 1``: a curve is a function over
    the whole range, and a curve with a hole in it is a curve with undefined
    behaviour at the ends where the black point and the white point live.

    ``y`` is clamped to 0-1 as well.  A tone curve that pushes a pixel outside
    the range is a clip, and clipping belongs to the renderer's output
    transform, not to the authoring model.
    """

    channel: CurveChannel = CurveChannel.MASTER
    points: tuple[tuple[float, float], ...] = ((0.0, 0.0), (1.0, 1.0))

    def __post_init__(self) -> None:
        if len(self.points) < 2:
            raise NovaInvariantError(f"a curve needs at least two points, got {len(self.points)}")
        if len(self.points) > MAX_CURVE_POINTS:
            raise NovaInvariantError(
                f"a curve holds at most {MAX_CURVE_POINTS} points, got {len(self.points)}"
            )
        if self.points[0][0] != 0.0 or self.points[-1][0] != 1.0:
            raise NovaInvariantError(
                "a curve must start at x=0 and end at x=1, "
                f"got {self.points[0][0]} and {self.points[-1][0]}"
            )
        for index, (x, y) in enumerate(self.points):
            if not 0.0 <= x <= 1.0 or not 0.0 <= y <= 1.0:
                raise NovaInvariantError(
                    f"curve point {index} must lie within [0, 1], got ({x}, {y})"
                )
            if index and x <= self.points[index - 1][0]:
                raise NovaInvariantError(
                    f"curve point {index} must be to the right of the one before it"
                )

    @property
    def is_identity(self) -> bool:
        """Whether the curve does nothing.

        A straight line from corner to corner is the curve a user has not
        touched, and knowing that is how a grade with four untouched curves
        still costs nothing.
        """
        return self.points == ((0.0, 0.0), (1.0, 1.0))

    def at(self, x: float) -> float:
        """The curve's value at ``x``, monotone cubic between the points.

        Outside 0-1 the end values are held: a curve is a function on the whole
        range, so asking about a value outside it is a question with an obvious
        answer rather than an error.
        """
        if not math.isfinite(x):
            raise NovaInvariantError(f"x must be finite, got {x}")
        if x <= self.points[0][0]:
            return self.points[0][1]
        if x >= self.points[-1][0]:
            return self.points[-1][1]
        index = bisect_right([point[0] for point in self.points], x) - 1
        slopes = _monotone_slopes(self.points)
        x0, y0 = self.points[index]
        x1, y1 = self.points[index + 1]
        span = x1 - x0
        t = (x - x0) / span
        return _hermite(y0, y1, slopes[index], slopes[index + 1], span, t)

    def to_wire(self) -> dict[str, object]:
        return {
            "channel": str(self.channel),
            "points": [{"x": x, "y": y} for x, y in self.points],
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> GradeCurve:
        _reject_unknown_fields(data, _CURVE_FIELDS)
        return cls(
            channel=CurveChannel(_wire_str(data, "channel")),
            points=tuple(
                (_wire_float(entry, "x"), _wire_float(entry, "y"))
                for entry in _wire_mappings(data, "points")
            ),
        )


@dataclass(frozen=True, slots=True, kw_only=True)
class Lut:
    """A look-up table the grade samples.

    A *reference*, not a file handle: the id names a LUT the plugin or the
    install provides, the path is where it was last found, and neither is opened
    here.  A project whose LUT is missing opens with the rest of its grade
    intact, because a missing LUT is missing media and missing media is a state
    (ADR-0015 rule 3).
    """

    lut_id: str
    name: str = ""
    #: Where the file was last seen.  Empty for a LUT the app ships.
    path: str = ""
    #: Cube edge length — how many samples per axis the file holds.
    size: int = DEFAULT_LUT_SIZE

    def __post_init__(self) -> None:
        if not self.lut_id:
            raise NovaInvariantError("a LUT must carry an id")
        if self.size not in SUPPORTED_LUT_SIZES:
            raise NovaInvariantError(
                f"a LUT must be one of {sorted(SUPPORTED_LUT_SIZES)} samples per axis, "
                f"got {self.size}"
            )

    def to_wire(self) -> dict[str, object]:
        return {
            "lut_id": self.lut_id,
            "name": self.name,
            "path": self.path,
            "size": self.size,
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> Lut:
        _reject_unknown_fields(data, _LUT_FIELDS)
        return cls(
            lut_id=_wire_str(data, "lut_id"),
            name=_wire_str(data, "name"),
            path=_wire_str(data, "path"),
            size=_wire_int(data, "size"),
        )


# ---------------------------------------------------------------------------
# The grade
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True, kw_only=True)
class ColourGrade:
    """The look applied to one clip, one track or the whole output.

    Every correction is an :class:`~nova_studio.domain.animation.Animatable`, so
    the same object serves a grade that never changes and one that is being
    ridden across a shot.  Every correction is **0-neutral** except
    ``lut_strength``, which is a proportion; see the module docstring for the
    table of units.
    """

    #: Stops.  ``2 ** exposure`` is what the renderer multiplies by.
    exposure: Animatable = field(default_factory=lambda: Animatable.constant("exposure", 0.0))
    #: Linear about mid-grey; see the module docstring.
    contrast: Animatable = field(default_factory=lambda: Animatable.constant("contrast", 0.0))
    #: Stops, so it is symmetric: ``-1`` halves the saturation.
    saturation: Animatable = field(default_factory=lambda: Animatable.constant("saturation", 0.0))
    #: -1 fully cool, +1 fully warm.
    temperature: Animatable = field(default_factory=lambda: Animatable.constant("temperature", 0.0))
    #: -1 green, +1 magenta.
    tint: Animatable = field(default_factory=lambda: Animatable.constant("tint", 0.0))
    #: Added to the shadows, per channel.
    lift: Animatable = field(default_factory=lambda: Animatable.constant("lift", 0.0, 0.0, 0.0))
    #: Added to the midtone exponent, per channel.
    gamma: Animatable = field(default_factory=lambda: Animatable.constant("gamma", 0.0, 0.0, 0.0))
    #: Added to the highlights, per channel.
    gain: Animatable = field(default_factory=lambda: Animatable.constant("gain", 0.0, 0.0, 0.0))
    #: How much of the LUT is mixed in, 0-1.  Zero with a LUT attached is a
    #: bypass, which is a thing a user does constantly while dialling a look in.
    lut_strength: Animatable = field(
        default_factory=lambda: Animatable.constant("lut_strength", 1.0)
    )
    #: Tone curves, applied in order: master first, then the channels.
    curves: tuple[GradeCurve, ...] = ()
    lut: Lut | None = None
    #: Off means the grade is present but not applied, which is not the same as
    #: absent: a user turns it off to compare, and expects it back.
    enabled: bool = True

    def __post_init__(self) -> None:
        _require_width("exposure", self.exposure, 1)
        _require_width("contrast", self.contrast, 1)
        _require_width("saturation", self.saturation, 1)
        _require_width("temperature", self.temperature, 1)
        _require_width("tint", self.tint, 1)
        _require_width("lift", self.lift, 3)
        _require_width("gamma", self.gamma, 3)
        _require_width("gain", self.gain, 3)
        _require_width("lut_strength", self.lut_strength, 1)
        seen: set[CurveChannel] = set()
        for curve in self.curves:
            if curve.channel in seen:
                raise NovaInvariantError(f"a grade carries one {curve.channel} curve, not two")
            seen.add(curve.channel)

    @property
    def is_static(self) -> bool:
        """Whether no correction moves.

        A static grade is one set of numbers for the whole clip, which the
        renderer can compile into a single 3-D texture instead of rebuilding it
        per frame.
        """
        return not any(
            _changes_over_time(parameter)
            for parameter in (
                self.exposure,
                self.contrast,
                self.saturation,
                self.temperature,
                self.tint,
                self.lift,
                self.gamma,
                self.gain,
                self.lut_strength,
            )
        )

    @property
    def is_neutral(self) -> bool:
        """Whether the grade does nothing at all.

        Most clips in most projects are ungraded.  Being able to ask — and to
        skip the whole pass when the answer is yes — is worth more here than any
        optimisation inside the pass.
        """
        if not self.enabled:
            return True
        if any(not curve.is_identity for curve in self.curves):
            return False
        if self.lut is not None and self.lut_strength.value[0] != 0.0:
            return False
        return all(
            value == 0.0
            for parameter in (
                self.exposure,
                self.contrast,
                self.saturation,
                self.temperature,
                self.tint,
                self.lift,
                self.gamma,
                self.gain,
            )
            for value in parameter.value
        )

    def at(self, frame: int) -> GradeSample:
        """The grade resolved at one frame: what the renderer evaluates."""
        return GradeSample(
            exposure=self.exposure.scalar_at(frame),
            contrast=self.contrast.scalar_at(frame),
            saturation=self.saturation.scalar_at(frame),
            temperature=self.temperature.scalar_at(frame),
            tint=self.tint.scalar_at(frame),
            lift=_triple(self.lift, frame),
            gamma=_triple(self.gamma, frame),
            gain=_triple(self.gain, frame),
            curves=self.curves,
            lut=self.lut,
            lut_strength=self.lut_strength.scalar_at(frame),
        )

    def shifted(self, delta_frames: int) -> ColourGrade:
        """The grade with every keyframe moved."""
        return replace(
            self,
            exposure=self.exposure.shifted(delta_frames),
            contrast=self.contrast.shifted(delta_frames),
            saturation=self.saturation.shifted(delta_frames),
            temperature=self.temperature.shifted(delta_frames),
            tint=self.tint.shifted(delta_frames),
            lift=self.lift.shifted(delta_frames),
            gamma=self.gamma.shifted(delta_frames),
            gain=self.gain.shifted(delta_frames),
            lut_strength=self.lut_strength.shifted(delta_frames),
        )

    def to_wire(self) -> dict[str, object]:
        return {
            "exposure": self.exposure.to_wire(),
            "contrast": self.contrast.to_wire(),
            "saturation": self.saturation.to_wire(),
            "temperature": self.temperature.to_wire(),
            "tint": self.tint.to_wire(),
            "lift": self.lift.to_wire(),
            "gamma": self.gamma.to_wire(),
            "gain": self.gain.to_wire(),
            "lut_strength": self.lut_strength.to_wire(),
            "curves": [curve.to_wire() for curve in self.curves],
            "lut": self.lut.to_wire() if self.lut else None,
            "enabled": self.enabled,
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> ColourGrade:
        _reject_unknown_fields(data, _GRADE_FIELDS)
        raw_lut = data["lut"]
        return cls(
            exposure=Animatable.from_wire(_mapping(data, "exposure")),
            contrast=Animatable.from_wire(_mapping(data, "contrast")),
            saturation=Animatable.from_wire(_mapping(data, "saturation")),
            temperature=Animatable.from_wire(_mapping(data, "temperature")),
            tint=Animatable.from_wire(_mapping(data, "tint")),
            lift=Animatable.from_wire(_mapping(data, "lift")),
            gamma=Animatable.from_wire(_mapping(data, "gamma")),
            gain=Animatable.from_wire(_mapping(data, "gain")),
            lut_strength=Animatable.from_wire(_mapping(data, "lut_strength")),
            curves=tuple(GradeCurve.from_wire(entry) for entry in _wire_mappings(data, "curves")),
            lut=Lut.from_wire(_mapping(data, "lut")) if raw_lut is not None else None,
            enabled=_wire_bool(data, "enabled"),
        )


@dataclass(frozen=True, slots=True, kw_only=True)
class GradeSample:
    """A :class:`ColourGrade` resolved at one frame.

    Plain floats and tuples, no keyframes: this is the last stop before the
    renderer turns the numbers into a texture.
    """

    exposure: float = 0.0
    contrast: float = 0.0
    saturation: float = 0.0
    temperature: float = 0.0
    tint: float = 0.0
    lift: tuple[float, float, float] = (0.0, 0.0, 0.0)
    gamma: tuple[float, float, float] = (0.0, 0.0, 0.0)
    gain: tuple[float, float, float] = (0.0, 0.0, 0.0)
    curves: tuple[GradeCurve, ...] = ()
    lut: Lut | None = None
    lut_strength: float = 1.0

    @property
    def is_neutral(self) -> bool:
        """Whether there is nothing for the renderer to do at this frame."""
        if any(not curve.is_identity for curve in self.curves):
            return False
        if self.lut is not None and self.lut_strength != 0.0:
            return False
        return (
            self.exposure == 0.0
            and self.contrast == 0.0
            and self.saturation == 0.0
            and self.temperature == 0.0
            and self.tint == 0.0
            and self.lift == (0.0, 0.0, 0.0)
            and self.gamma == (0.0, 0.0, 0.0)
            and self.gain == (0.0, 0.0, 0.0)
        )


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def validate_grade(grade: ColourGrade) -> str:
    """Return ``\"\"`` or a sentence saying the first correction that is out of
    range.

    Construction cannot police taste — a keyframe added later can be anything —
    so this is the check a loader and an inspector run.  It reports rather than
    raises, for the same reason :func:`~nova_studio.domain.project.validate_project`
    does: a grade with a slider pushed too far is still the user's look, and the
    fix is to clamp it, not to lose it.
    """
    scalars = (
        ("exposure", grade.exposure, EXPOSURE_LIMIT),
        ("contrast", grade.contrast, CONTRAST_LIMIT),
        ("saturation", grade.saturation, SATURATION_LIMIT),
        ("temperature", grade.temperature, BALANCE_LIMIT),
        ("tint", grade.tint, BALANCE_LIMIT),
    )
    for name, parameter, limit in scalars:
        for value in _flat(parameter):
            if not -limit <= value <= limit:
                return f"{name} must be within [-{limit}, {limit}], got {value}"
    for name, parameter in (
        ("lift", grade.lift),
        ("gamma", grade.gamma),
        ("gain", grade.gain),
    ):
        for value in _flat(parameter):
            if not -WHEEL_LIMIT <= value <= WHEEL_LIMIT:
                return f"{name} must be within [-{WHEEL_LIMIT}, {WHEEL_LIMIT}], got {value}"
    for value in _flat(grade.lut_strength):
        if not 0.0 <= value <= 1.0:
            return f"lut_strength must be within [0, 1], got {value}"
    return ""


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------


def _changes_over_time(parameter: Animatable) -> bool:
    """Whether a parameter needs evaluating per frame.

    One keyframe pins a value, so it does not: only two or more make a curve.
    """
    return len(parameter.keyframes) > 1


def _require_width(name: str, parameter: Animatable, width: int) -> None:
    if parameter.width != width:
        raise NovaInvariantError(f"'{name}' must hold {width} components, got {parameter.width}")


def _flat(parameter: Animatable) -> tuple[float, ...]:
    """Every component of every value a parameter can take, flattened."""
    return tuple(component for value in parameter.all_values() for component in value)


def _triple(parameter: Animatable, frame: int) -> tuple[float, float, float]:
    value = parameter.at(frame)
    return (value[0], value[1], value[2])


def _mapping(data: Mapping[str, object], key: str) -> Mapping[str, object]:
    raw = data[key]
    if not isinstance(raw, Mapping):
        raise NovaInvariantError(f"'{key}' must be a mapping, got {type(raw).__name__}")
    return raw


def _monotone_slopes(points: tuple[tuple[float, float], ...]) -> tuple[float, ...]:
    """Fritsch–Carlson tangents: a curve that never overshoots its points.

    A plain Catmull-Rom spline is prettier in a maths text and worse in an
    editor: it can bend past a control point, which on a tone curve reads as a
    band of inverted contrast exactly where the user was being careful.
    """
    count = len(points)
    deltas = [
        (points[i + 1][1] - points[i][1]) / (points[i + 1][0] - points[i][0])
        for i in range(count - 1)
    ]
    slopes = [0.0] * count
    slopes[0] = deltas[0]
    slopes[-1] = deltas[-1]
    for i in range(1, count - 1):
        if deltas[i - 1] * deltas[i] <= 0.0:
            # A local extremum: a flat tangent is the only choice that cannot
            # overshoot.
            slopes[i] = 0.0
            continue
        mean = (deltas[i - 1] + deltas[i]) / 2.0
        bound = 3.0 * min(abs(deltas[i - 1]), abs(deltas[i]))
        slopes[i] = math.copysign(min(abs(mean), bound), mean)
    return tuple(slopes)


def _hermite(
    y0: float,
    y1: float,
    m0: float,
    m1: float,
    span: float,
    t: float,
) -> float:
    """Cubic Hermite between two points, ``t`` in 0-1 over ``span``."""
    t2 = t * t
    t3 = t2 * t
    h00 = 2.0 * t3 - 3.0 * t2 + 1.0
    h10 = t3 - 2.0 * t2 + t
    h01 = -2.0 * t3 + 3.0 * t2
    h11 = t3 - t2
    value = h00 * y0 + h10 * span * m0 + h01 * y1 + h11 * span * m1
    return min(1.0, max(0.0, value))
