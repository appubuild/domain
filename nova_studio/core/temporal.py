"""Frame-accurate time representation (ADR-0006).

The canonical time unit in Nova Studio is the **frame at a project's edit rate**.
Everything stored in a project document — clip positions, in/out points, keyframe
times, markers, caption segment/word/character timings — is an integer frame count.
Seconds appear only at the boundary where humans or DSP need them, and every such
conversion goes through this module with an *explicit* rounding mode.

Why this matters
----------------
Storing timeline positions as ``float`` seconds guarantees drift: after a few
hundred ripple edits, ``0.1 + 0.2 != 0.3`` has shifted a clip by a frame, which
users experience as a black flash or as audio drift that grows along the timeline.
Integer frame arithmetic cannot drift, no matter how many edits are applied.

Broadcast rates
---------------
NTSC rates (23.976, 29.97, 59.94) are *rational*, not decimal: ``30000/1001``.
Timecode for 29.97 and 59.94 may be **drop-frame**, which skips frame numbers 0
and 1 at the start of each minute except every tenth minute so that the timecode
clock tracks real time.  Drop-frame arithmetic is implemented exactly here.

Performance note
----------------
On the hot compositing path, timeline positions are plain ``int`` frames.  The
value objects below are used at boundaries — parsing, validation, API/DTO
conversion, file I/O and display — where clarity and correctness dominate.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_EVEN, Decimal
from enum import Enum
from fractions import Fraction
from typing import Final, NewType

__all__ = [
    "AUDIO_SAMPLE_RATES",
    "DEFAULT_AUDIO_SAMPLE_RATE",
    "DEFAULT_TIMEBASE",
    "STANDARD_TIMEBASES",
    "FrameCount",
    "Rational",
    "Rounding",
    "SampleCount",
    "Timebase",
    "Timecode",
    "TimecodeParseError",
    "frames_to_samples",
    "frames_to_seconds",
    "seconds_to_frames",
    "timebase_from_fps",
]

#: Timeline positions and durations are plain integers measured in frames.
FrameCount = NewType("FrameCount", int)
#: Audio positions are plain integers measured in samples at a fixed sample rate.
SampleCount = NewType("SampleCount", int)

#: Exact rational, used for rates and for speed-ramp control values.
Rational = Fraction


class Rounding(Enum):
    """Named rounding modes.

    Implicit rounding is forbidden: every conversion states which mode it uses so
    that a cut boundary and a display value can never disagree by accident.
    """

    FLOOR = "floor"
    CEIL = "ceil"
    NEAREST = "nearest"
    #: Banker's rounding — the tie-breaking rule used for display values so that
    #: repeated rounding of the same half-way values does not bias upward.
    NEAREST_EVEN = "nearest_even"
    TRUNCATE = "truncate"

    def apply(self, value: Decimal) -> int:
        """Round ``value`` to an integer according to this mode."""
        mode = _DECIMAL_MODES[self]
        return int(value.to_integral_value(rounding=mode))


_DECIMAL_MODES: Final[dict[Rounding, str]] = {
    Rounding.FLOOR: "ROUND_FLOOR",
    Rounding.CEIL: "ROUND_CEILING",
    Rounding.NEAREST: "ROUND_HALF_UP",
    Rounding.NEAREST_EVEN: ROUND_HALF_EVEN,
    Rounding.TRUNCATE: "ROUND_DOWN",
}

#: Default rounding for user-facing display values.
DEFAULT_DISPLAY_ROUNDING: Final[Rounding] = Rounding.NEAREST
#: Default rounding for cut boundaries: a cut includes the whole frame it starts
#: on, so a fractional boundary rounds down.
DEFAULT_CUT_ROUNDING: Final[Rounding] = Rounding.FLOOR


@dataclass(frozen=True, slots=True, kw_only=True)
class Timebase:
    """An exact rational frame rate, e.g. ``30000/1001`` for 29.97 fps.

    Instances are cached and interned so that equality and hashing are cheap and
    the set of timebases in a process stays small.

    Attributes:
        num: Numerator of the rate in frames per second.
        den: Denominator of the rate in frames per second.

    Invariants:
        * ``num > 0`` and ``den > 0``.
        * The fraction is stored in lowest terms.
    """

    num: int
    den: int

    def __post_init__(self) -> None:
        if self.num <= 0 or self.den <= 0:
            raise ValueError(f"timebase must be positive, got {self.num}/{self.den}")
        reduced = Fraction(self.num, self.den)
        # frozen dataclass: mutation must go through object.__setattr__.
        object.__setattr__(self, "num", reduced.numerator)
        object.__setattr__(self, "den", reduced.denominator)

    # -- construction ------------------------------------------------------

    @classmethod
    def of(cls, num: int, den: int = 1) -> Timebase:
        """Return the interned :class:`Timebase` for ``num/den``.

        Values are reduced to lowest terms before interning, so
        ``Timebase.of(60, 2) is Timebase.of(30, 1)``.
        """
        if num <= 0 or den <= 0:
            raise ValueError(f"timebase must be positive, got {num}/{den}")
        reduced = Fraction(num, den)
        key = (reduced.numerator, reduced.denominator)
        cached = _TIMEBASE_CACHE.get(key)
        if cached is not None:
            return cached
        instance = cls(num=key[0], den=key[1])
        _TIMEBASE_CACHE[key] = instance
        return instance

    @classmethod
    def from_decimal(cls, fps: Decimal | str) -> Timebase:
        """Build a timebase from an exact decimal such as ``Decimal("29.97")``.

        Prefer this over :meth:`from_float` whenever the rate is known textually —
        ``Decimal("29.97")`` yields exactly ``2997/100`` while ``29.97`` as a
        binary float does not.
        """
        value = fps if isinstance(fps, Decimal) else Decimal(str(fps))
        if value <= 0:
            raise ValueError(f"frame rate must be positive, got {value}")
        fraction = Fraction(value)
        return cls.of(fraction.numerator, fraction.denominator)

    @classmethod
    def from_float(cls, fps: float, max_denominator: int = 100_000) -> Timebase:
        """Approximate a float rate as a rational, capped by ``max_denominator``.

        Only for values that originate as floats (probed container rates).  The
        result is snapped to a known broadcast rate when it is within
        :data:`_RATE_SNAP_TOLERANCE`, because a probe reporting ``29.970029``
        really means ``30000/1001``.
        """
        if fps <= 0:
            raise ValueError(f"frame rate must be positive, got {fps}")
        snapped = _snap_to_standard_rate(fps)
        if snapped is not None:
            return snapped
        fraction = Fraction(fps).limit_denominator(max_denominator)
        return cls.of(fraction.numerator, fraction.denominator)

    # -- properties --------------------------------------------------------

    @property
    def fraction(self) -> Rational:
        """The rate as an exact :class:`~fractions.Fraction`."""
        return Fraction(self.num, self.den)

    @property
    def fps(self) -> float:
        """The rate as a float.  For display and DSP only — never store this."""
        return self.num / self.den

    @property
    def frame_duration_seconds(self) -> float:
        """Duration of a single frame in seconds."""
        return self.den / self.num

    @property
    def is_drop_frame_rate(self) -> bool:
        """Whether SMPTE drop-frame timecode is meaningful for this rate.

        Drop-frame exists for the ``x000/1001`` family (29.97 and 59.94).  A rate
        such as 23.976 has no standard drop-frame timecode.
        """
        return self.den == 1001 and self.num in (30_000, 60_000)

    @property
    def nominal_fps(self) -> int:
        """The nearest whole-number rate, used for drop-frame decisions."""
        return round(self.fps)

    @property
    def frames_per_minute(self) -> Decimal:
        """Exact frames per minute as a :class:`~decimal.Decimal`."""
        return Decimal(self.num) * Decimal(60) / Decimal(self.den)

    @property
    def drop_frame_count(self) -> int:
        """How many frame *numbers* SMPTE drop-frame skips per dropped minute.

        Drop-frame exists because timecode counts at the nominal integer rate
        while NTSC material actually plays at ``rate * 1000/1001`` — 0.1% slower.
        Over ten minutes the label clock gains ``nominal * 600 * 1/1000`` frames,
        so that many numbers are skipped per ten minutes: 2 per minute for 29.97
        and 4 per minute for 59.94, on each of the nine non-tenth minutes.

        Returns 0 for rates with no drop-frame convention.
        """
        if not self.is_drop_frame_rate:
            return 0
        return 2 * (self.nominal_fps // 30)

    # -- conversion --------------------------------------------------------

    def frames_to_seconds(self, frames: int) -> float:
        """Convert a frame count to seconds."""
        return frames * self.den / self.num

    def frames_to_decimal_seconds(self, frames: int) -> Decimal:
        """Convert a frame count to exact decimal seconds.

        Use this when the value will be written to a document or compared for
        equality, since :meth:`frames_to_seconds` returns a lossy float.
        """
        return Decimal(frames) * Decimal(self.den) / Decimal(self.num)

    def seconds_to_frames(
        self,
        seconds: float | Decimal,
        rounding: Rounding = DEFAULT_CUT_ROUNDING,
    ) -> int:
        """Convert seconds to a frame count with an explicit rounding mode.

        ``Decimal`` input is converted exactly; ``float`` input is first converted
        to the shortest ``Decimal`` that round-trips, so ``0.1`` means the decimal
        ``0.1`` rather than its binary expansion.
        """
        value = seconds if isinstance(seconds, Decimal) else Decimal(str(seconds))
        exact = value * Decimal(self.num) / Decimal(self.den)
        return rounding.apply(exact)

    def duration_of(self, frames: int) -> Decimal:
        """Exact duration in seconds of ``frames`` frames, as a Decimal."""
        return self.frames_to_decimal_seconds(frames)

    def resample_frames(self, frames: int, target: Timebase) -> int:
        """Convert a frame count from this timebase to ``target``, preserving duration.

        Duration is the invariant: ``frames / self`` seconds of material occupies
        ``target_frames / target`` seconds after conversion, so

            target_frames = frames * target.num * self.den / (target.den * self.num)

        1800 frames at 30 fps is 60 s, which is 1440 frames at 24 fps.  Getting
        the ratio inverted is an easy and very visible mistake — a conform would
        silently change programme length — so it is covered by explicit tests.
        """
        exact = Decimal(frames) * Decimal(target.num) * Decimal(self.den)
        exact /= Decimal(target.den) * Decimal(self.num)
        return Rounding.NEAREST.apply(exact)

    # -- dunder ------------------------------------------------------------

    def __str__(self) -> str:
        if self.den == 1:
            return f"{self.num}"
        return f"{self.num}/{self.den}"

    def __repr__(self) -> str:
        return f"Timebase(num={self.num}, den={self.den})"

    def to_dict(self) -> dict[str, int]:
        """Serialise for project documents and DTOs."""
        return {"num": self.num, "den": self.den}

    @classmethod
    def from_dict(cls, data: dict[str, int]) -> Timebase:
        """Inverse of :meth:`to_dict`."""
        return cls.of(int(data["num"]), int(data["den"]))


_TIMEBASE_CACHE: Final[dict[tuple[int, int], Timebase]] = {}
_RATE_SNAP_TOLERANCE: Final[float] = 0.02


# Well-known rates.  Constructed via Timebase.of so they are interned.
FPS_23_976: Final[Timebase] = Timebase.of(24_000, 1_001)
FPS_24: Final[Timebase] = Timebase.of(24, 1)
FPS_25: Final[Timebase] = Timebase.of(25, 1)
FPS_29_97: Final[Timebase] = Timebase.of(30_000, 1_001)
FPS_30: Final[Timebase] = Timebase.of(30, 1)
FPS_48: Final[Timebase] = Timebase.of(48, 1)
FPS_50: Final[Timebase] = Timebase.of(50, 1)
FPS_59_94: Final[Timebase] = Timebase.of(60_000, 1_001)
FPS_60: Final[Timebase] = Timebase.of(60, 1)
FPS_90: Final[Timebase] = Timebase.of(90, 1)
FPS_120: Final[Timebase] = Timebase.of(120, 1)

#: Rates offered in the new-project dialog, in display order.
STANDARD_TIMEBASES: Final[tuple[Timebase, ...]] = (
    FPS_23_976,
    FPS_24,
    FPS_25,
    FPS_29_97,
    FPS_30,
    FPS_48,
    FPS_50,
    FPS_59_94,
    FPS_60,
    FPS_120,
)

#: Default for new projects: 30 fps.  Chosen because it is the most common
#: delivery rate for social video and needs no drop-frame handling.
DEFAULT_TIMEBASE: Final[Timebase] = FPS_30

DEFAULT_AUDIO_SAMPLE_RATE: Final[int] = 48_000
AUDIO_SAMPLE_RATES: Final[tuple[int, ...]] = (32_000, 44_100, 48_000, 96_000)


def _snap_to_standard_rate(fps: float) -> Timebase | None:
    """Return the standard rate matching ``fps`` within tolerance, else ``None``."""
    for candidate in STANDARD_TIMEBASES:
        if abs(candidate.fps - fps) <= _RATE_SNAP_TOLERANCE:
            return candidate
    return None


def timebase_from_fps(fps: Timebase | float | Decimal | str | int) -> Timebase:
    """Coerce any numeric-ish frame rate into an exact :class:`Timebase`.

    Integers and strings are treated as exact; floats are snapped to a standard
    broadcast rate when they are within tolerance of one, and otherwise converted
    with a bounded denominator.
    """
    if isinstance(fps, Timebase):
        return fps
    if isinstance(fps, int):
        return Timebase.of(fps, 1)
    if isinstance(fps, Decimal | str):
        return Timebase.from_decimal(fps)
    if isinstance(fps, float):
        return Timebase.from_float(fps)
    raise TypeError(f"cannot build a Timebase from {type(fps).__name__}")


class TimecodeParseError(ValueError):
    """Raised when a timecode string cannot be parsed.

    Carries the offending text so that the API layer can produce a helpful,
    localised message rather than a bare 422.
    """

    def __init__(self, text: str, reason: str) -> None:
        self.text = text
        self.reason = reason
        super().__init__(f"invalid timecode {text!r}: {reason}")


@dataclass(frozen=True, slots=True)
class Timecode:
    """SMPTE timecode: ``HH:MM:SS:FF`` (non-drop) or ``HH:MM:SS;FF`` (drop-frame).

    The ``;`` separator before frames is the standard drop-frame marker; ``.`` is
    accepted on input as a convenience.  This class is a pure value object with no
    I/O and no float arithmetic: conversions to and from frame counts are exact.

    Attributes:
        hours: 0..23
        minutes: 0..59
        seconds: 0..59
        frames: 0..(nominal frames per second - 1)
        drop_frame: Whether this is drop-frame timecode.
        negative: Whether this represents a position before the timeline origin.
            Negative timecode occurs with pre-roll handles; the magnitude fields
            stay canonical so formatting and comparison remain predictable.
    """

    hours: int
    minutes: int
    seconds: int
    frames: int
    drop_frame: bool = False
    negative: bool = False

    def __post_init__(self) -> None:
        if not 0 <= self.hours <= 23:
            raise ValueError(f"timecode hours out of range: {self.hours}")
        if not 0 <= self.minutes <= 59:
            raise ValueError(f"timecode minutes out of range: {self.minutes}")
        if not 0 <= self.seconds <= 59:
            raise ValueError(f"timecode seconds out of range: {self.seconds}")
        if self.frames < 0:
            raise ValueError(f"timecode frames must be non-negative: {self.frames}")
        if self.drop_frame and self._is_dropped_position():
            raise ValueError(
                "drop-frame timecode does not contain frames 00 and 01 at the start "
                f"of a non-tenth minute: {self!s}"
            )

    def _is_dropped_position(self) -> bool:
        """Whether this label falls in a universally-dropped position.

        Rate-agnostic: every drop-frame rate skips at least the first two frame
        numbers of a non-tenth minute, so such a label is invalid regardless of
        the rate.  Use :meth:`is_dropped_label` for the rate-exact check.
        """
        return self.frames < 2 and self.seconds == 0 and self.minutes % 10 != 0

    def is_dropped_label(self, timebase: Timebase) -> bool:
        """Whether this label does not exist at ``timebase``.

        29.97 skips labels ``;00`` and ``;01`` at each non-tenth minute; 59.94
        skips ``;00`` through ``;03``.  A tenth minute never skips.
        """
        if not self.drop_frame:
            return False
        if self.seconds != 0 or self.minutes % 10 == 0:
            return False
        return self.frames < timebase.drop_frame_count

    # -- construction ------------------------------------------------------

    @classmethod
    def from_frames(
        cls,
        frames: int,
        timebase: Timebase,
        *,
        drop_frame: bool | None = None,
    ) -> Timecode:
        """Convert a frame count to timecode at ``timebase``.

        Args:
            frames: Frame index; may be negative, which yields a negative timecode.
            timebase: The project rate.
            drop_frame: Force drop-frame on/off.  When ``None`` it defaults to
                ``True`` for rates where drop-frame is standard (29.97, 59.94).

        Raises:
            ValueError: If drop-frame is requested for a rate that has no
                drop-frame convention.
        """
        use_drop = timebase.is_drop_frame_rate if drop_frame is None else bool(drop_frame)
        if use_drop and not timebase.is_drop_frame_rate:
            raise ValueError(
                f"{timebase} has no drop-frame timecode convention; "
                "drop-frame applies to 29.97 and 59.94"
            )

        negative = frames < 0
        magnitude = -frames if negative else frames
        whole_fps = timebase.nominal_fps

        if not use_drop:
            total_seconds, frame = divmod(magnitude, whole_fps)
            hours, remainder = divmod(total_seconds, 3_600)
            minutes, seconds = divmod(remainder, 60)
            return cls(hours % 24, minutes, seconds, frame, False, negative)

        # Canonical SMPTE drop-frame labelling.  `drop` frame numbers are skipped
        # at the start of every minute except every tenth minute; adding the
        # skipped numbers back to the frame index yields the displayed label.
        drop = timebase.drop_frame_count
        frames_per_10_minutes = whole_fps * 600 - drop * 9
        frames_per_minute = whole_fps * 60 - drop

        ten_minute_blocks, remainder = divmod(magnitude, frames_per_10_minutes)
        if remainder < drop:
            # Still inside the leading (non-dropping) portion of the block.
            label = magnitude + drop * 9 * ten_minute_blocks
        else:
            label = (
                magnitude
                + drop * 9 * ten_minute_blocks
                + drop * ((remainder - drop) // frames_per_minute)
            )

        hours, hour_remainder = divmod(label, whole_fps * 3_600)
        minutes, minute_remainder = divmod(hour_remainder, whole_fps * 60)
        seconds, frame = divmod(minute_remainder, whole_fps)
        return cls(hours % 24, minutes, seconds, frame, True, negative)

    @classmethod
    def parse(cls, text: str, timebase: Timebase) -> Timecode:
        """Parse ``HH:MM:SS:FF`` / ``HH:MM:SS;FF`` / ``MM:SS:FF`` / ``FF``.

        The separator before the frames field determines drop-frame: ``;`` means
        drop-frame, ``:`` means non-drop.  A missing marker is inferred from the
        timebase, so ``01:00:00`` at 29.97 is treated as drop-frame — matching the
        behaviour of professional NLEs.
        """
        raw = text.strip()
        if not raw:
            raise TimecodeParseError(text, "empty string")

        negative = raw.startswith("-")
        if negative:
            raw = raw[1:].lstrip()

        drop_marker = ";" in raw
        normalised = raw.replace(";", ":").replace(".", ":")
        parts = normalised.split(":")
        if not 1 <= len(parts) <= 4:
            raise TimecodeParseError(text, "expected between 1 and 4 colon-separated fields")
        for part in parts:
            if not part or not part.isdigit():
                raise TimecodeParseError(text, f"non-numeric field {part!r}")

        numbers = [int(part) for part in parts]
        while len(numbers) < 4:
            numbers.insert(0, 0)
        hours, minutes, seconds, frames = numbers

        whole_fps = timebase.nominal_fps
        if frames >= whole_fps:
            raise TimecodeParseError(text, f"frame field must be < {whole_fps} at {timebase} fps")
        if hours > 23 or minutes > 59 or seconds > 59:
            raise TimecodeParseError(text, "field out of range")

        drop = drop_marker or timebase.is_drop_frame_rate
        if drop and not timebase.is_drop_frame_rate:
            raise TimecodeParseError(text, f"{timebase} has no drop-frame convention")
        instance = cls(hours, minutes, seconds, frames, drop, negative)
        if instance.is_dropped_label(timebase):
            raise TimecodeParseError(
                text,
                f"labels ;00-;{timebase.drop_frame_count - 1:02d} do not exist at the "
                "start of a non-tenth minute in drop-frame timecode",
            )
        return instance

    @classmethod
    def zero(cls, *, drop_frame: bool = False) -> Timecode:
        """The origin timecode ``00:00:00:00``."""
        return cls(0, 0, 0, 0, drop_frame, False)

    # -- conversion --------------------------------------------------------

    def to_frames(self, timebase: Timebase) -> int:
        """Convert this timecode to an exact frame count at ``timebase``."""
        whole_fps = timebase.nominal_fps
        if self.frames >= whole_fps:
            raise ValueError(
                f"frame field {self.frames} is invalid at {timebase} (must be < {whole_fps})"
            )
        if self.drop_frame and not timebase.is_drop_frame_rate:
            # Drop-frame labels are only defined for the x000/1001 rate family.
            # Non-drop timecode at a drop-capable rate is legal: the user opted
            # out of dropping.
            raise ValueError(f"drop-frame timecode cannot be interpreted at {timebase}")
        if self.is_dropped_label(timebase):
            raise ValueError(
                f"{self!s} is not a valid drop-frame label at {timebase}: "
                f"frames 00-{timebase.drop_frame_count - 1:02d} are skipped at the "
                "start of every non-tenth minute"
            )

        if not self.drop_frame:
            magnitude = (
                self.hours * 3_600 + self.minutes * 60 + self.seconds
            ) * whole_fps + self.frames
        else:
            # Subtract the frame numbers drop-frame skips: `drop` per minute for
            # every minute that is not a multiple of ten.
            total_minutes = self.hours * 60 + self.minutes
            dropped = timebase.drop_frame_count * (total_minutes - total_minutes // 10)
            magnitude = (
                whole_fps * 3_600 * self.hours
                + whole_fps * 60 * self.minutes
                + whole_fps * self.seconds
                + self.frames
                - dropped
            )
        return -magnitude if self.negative else magnitude

    def with_sign(self, negative: bool) -> Timecode:
        """Return this timecode with the given sign, magnitude unchanged."""
        return Timecode(
            self.hours,
            self.minutes,
            self.seconds,
            self.frames,
            self.drop_frame,
            negative,
        )

    def absolute(self) -> Timecode:
        """Return the non-negative form of this timecode."""
        return self.with_sign(False) if self.negative else self

    def negated(self) -> Timecode:
        """Return this timecode with its sign flipped."""
        return self.with_sign(not self.negative)

    # -- formatting --------------------------------------------------------

    def __str__(self) -> str:
        separator = ";" if self.drop_frame else ":"
        text = f"{self.hours:02d}:{self.minutes:02d}:{self.seconds:02d}{separator}{self.frames:02d}"
        return f"-{text}" if self.negative else text

    def __repr__(self) -> str:
        return (
            f"Timecode(hours={self.hours}, minutes={self.minutes}, "
            f"seconds={self.seconds}, frames={self.frames}, "
            f"drop_frame={self.drop_frame}, negative={self.negative})"
        )

    def to_compact(self) -> str:
        """Format without separators, e.g. ``01020304`` — used in file names."""
        return f"{self.hours:02d}{self.minutes:02d}{self.seconds:02d}{self.frames:02d}"

    def to_seconds_label(self, timebase: Timebase, precision: int = 3) -> str:
        """Format as a decimal-seconds label, e.g. ``12.345s``."""
        seconds = timebase.frames_to_decimal_seconds(self.to_frames(timebase))
        quantised = seconds.quantize(Decimal(1).scaleb(-precision))
        return f"{quantised}s"

    def to_dict(self) -> dict[str, object]:
        """Serialise for documents and DTOs."""
        return {
            "hours": self.hours,
            "minutes": self.minutes,
            "seconds": self.seconds,
            "frames": self.frames,
            "drop_frame": self.drop_frame,
            "negative": self.negative,
        }

    @classmethod
    def from_dict(cls, data: dict[str, object]) -> Timecode:
        """Inverse of :meth:`to_dict`."""
        return cls(
            hours=int(data["hours"]),  # type: ignore[call-overload]
            minutes=int(data["minutes"]),  # type: ignore[call-overload]
            seconds=int(data["seconds"]),  # type: ignore[call-overload]
            frames=int(data["frames"]),  # type: ignore[call-overload]
            drop_frame=bool(data.get("drop_frame", False)),
            negative=bool(data.get("negative", False)),
        )


def frames_to_seconds(frames: int, timebase: Timebase) -> float:
    """Convenience wrapper over :meth:`Timebase.frames_to_seconds`."""
    return timebase.frames_to_seconds(frames)


def seconds_to_frames(
    seconds: float | Decimal,
    timebase: Timebase,
    rounding: Rounding = DEFAULT_CUT_ROUNDING,
) -> int:
    """Convenience wrapper over :meth:`Timebase.seconds_to_frames`."""
    return timebase.seconds_to_frames(seconds, rounding)


def frames_to_samples(
    frames: int,
    timebase: Timebase,
    sample_rate: int = DEFAULT_AUDIO_SAMPLE_RATE,
    rounding: Rounding = Rounding.NEAREST,
) -> int:
    """Convert a video frame position to an audio sample position.

    Audio is deliberately *not* quantised to video frames: converting through the
    exact rational rate keeps lip-sync stable over long programmes.

    Args:
        frames: Frame position on the timeline.
        timebase: Project rate.
        sample_rate: Audio sample rate in Hz.
        rounding: How to resolve a fractional sample boundary.

    Returns:
        Sample index at ``sample_rate``.
    """
    if sample_rate <= 0:
        raise ValueError(f"sample_rate must be positive, got {sample_rate}")
    exact = Decimal(frames) * Decimal(timebase.den) * Decimal(sample_rate)
    exact /= Decimal(timebase.num)
    return rounding.apply(exact)


def samples_to_frames(
    samples: int,
    timebase: Timebase,
    sample_rate: int = DEFAULT_AUDIO_SAMPLE_RATE,
    rounding: Rounding = DEFAULT_CUT_ROUNDING,
) -> int:
    """Inverse of :func:`frames_to_samples`."""
    if sample_rate <= 0:
        raise ValueError(f"sample_rate must be positive, got {sample_rate}")
    exact = Decimal(samples) * Decimal(timebase.num)
    exact /= Decimal(timebase.den) * Decimal(sample_rate)
    return rounding.apply(exact)


def floor_div(numerator: int, denominator: int) -> int:
    """Integer division that floors for negative values.

    Python's ``//`` already floors, so this exists to make the intent explicit at
    call sites where a negative frame position is possible (pre-roll handles).
    """
    if denominator == 0:
        raise ZeroDivisionError("floor_div denominator must be non-zero")
    # Python's // already floors toward negative infinity, which is the behaviour
    # required for pre-roll (negative frame) positions.
    return numerator // denominator
