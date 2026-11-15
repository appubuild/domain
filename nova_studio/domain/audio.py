"""L2 — audio: what a clip sounds like, and how it stops sounding like it.

A picture editor can be judged on a still frame. Audio cannot: the two things a
listener notices about an edit are **where a clip starts** and **where it
stops**, and both of those are this module. It is small on purpose — three
numbers and a choice of curve — because the alternative is a mixer that takes
twelve arguments nobody has ever set.

Three rules run through it, and each one is the answer to a bug that audio
plugins ship with:

**Neutral is zero, everywhere.** :attr:`ClipAudio.is_neutral` lets the mixer
skip a clip entirely — no gain multiply, no fade ramp — so the common case (a
clip the user has never touched) costs nothing. A model where some defaults are
0 and others are 1 is a model where a default gets copied into the wrong field
at two in the morning.

**A fade is a shape, not a slope.** :class:`FadeShape` exists because a linear
amplitude fade on audio is *wrong*, and wrong in a way users describe as a bug
rather than as a taste: it drops most of its level in the first third and then
crawls. :attr:`FadeShape.EQUAL_POWER` is the default for that reason, and it is
the raised-cosine law a hardware console has used since the 1970s.

**Frames, not seconds.** Fade lengths are counted in project frames, exactly
like a clip's position, so a fade that is twelve frames long at 24 fps is half a
second today and half a second after the rate is changed — which is what "the
fade I set" means. Seconds would make a fade drift every time the project's
rate did, and the sample-domain conversion is the mixer's job, not the
document's.

Nothing here touches a sample. This module describes *what to ask for*; the
mixer in ``services/render/audio.py`` turns it into numbers, and it is why this
file imports no NumPy and why it is testable in a process that has none.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from enum import StrEnum
from typing import TYPE_CHECKING, Final

from nova_studio.core.errors import NovaInvariantError

if TYPE_CHECKING:
    from collections.abc import Mapping

from nova_studio.domain._wire import (
    reject_unknown_fields as _reject_unknown_fields,
    wire_float as _wire_float,
    wire_int as _wire_int,
    wire_str as _wire_str,
)

__all__ = [
    "CLIP_AUDIO_FIELDS",
    "ClipAudio",
    "FadeShape",
    "db_to_linear",
    "fade_factor",
    "linear_to_db",
]

#: The wire fields of :class:`ClipAudio`, for the strict reader the project
#: document uses. Unknown keys are refused rather than ignored: a document
#: written by a newer Nova Studio names things this build has not heard of, and
#: silently dropping them is how a fade quietly stops existing.
CLIP_AUDIO_FIELDS: Final[set[str]] = {
    "gain_db",
    "pan",
    "fade_in_frames",
    "fade_out_frames",
    "fade_shape",
}


class FadeShape(StrEnum):
    """How a fade gets from silence to full level.

    Every shape is a function of ``t`` in 0–1 with ``f(0) = 0`` and
    ``f(1) = 1``, so swapping one for another can never change where the fade
    starts or ends — only how it gets there.
    """

    #: Amplitude proportional to ``t``. Cheap, and wrong for audio: it spends
    #: most of its level early and then crawls. Kept because a crossfade
    #: between two clips *needs* it (two equal-power curves sum to a dip in the
    #: middle; two linear ones do not), and because it is the shape a video
    #: dissolve uses, so a user matching sound to picture wants it.
    LINEAR = "linear"
    #: Raised cosine — ``sin(t · π/2)`` for a fade in. Constant *power* across
    #: the fade, which is what the ear hears as even. The default.
    EQUAL_POWER = "equal-power"
    #: Smoothstep: flat at both ends, steepest in the middle. The shape to use
    #: when a fade must not draw attention to either of its ends.
    S_CURVE = "s-curve"
    #: Exponential, in the dB domain: perceptually the most even of the four,
    #: and the only one that never stops abruptly. Approached with a floor of
    #: -60 dB rather than true silence, because a fade to exactly zero at a
    #: finite sample rate is a fade that clicks when it is rounded.
    EXPONENTIAL = "exponential"


#: Where :attr:`FadeShape.EXPONENTIAL` stops. -60 dB is inaudible on any
#: playback system and is a millionth of the amplitude, which is far below
#: where float32 stops being able to represent the difference.
_FLOOR_DB: Final[float] = -60.0

_FLOOR_LINEAR: Final[float] = 0.001


def db_to_linear(decibels: float) -> float:
    """Decibels to a linear amplitude ratio. ``0 dB`` is exactly ``1.0``.

    Amplitude, not power: audio uses ``20 · log10``, so ``+6 dB`` is double the
    amplitude. Getting this the wrong way round is the single most common bug in
    audio code, and it is the kind that is only noticed when a mix is quiet.
    """
    return math.pow(10.0, decibels / 20.0)


def linear_to_db(amplitude: float) -> float:
    """The inverse of :func:`db_to_linear`. Silence is :data:`_FLOOR_DB`.

    ``log10(0)`` is undefined, and a meter that printed ``-inf`` is a meter
    nobody trusts, so zero maps to the floor rather than to infinity.
    """
    if amplitude <= 0.0:
        return _FLOOR_DB
    return max(_FLOOR_DB, 20.0 * math.log10(amplitude))


def fade_factor(shape: FadeShape, t: float, *, rising: bool) -> float:
    """The gain of one end of a fade at ``t``, in 0–1.

    Args:
        shape: Which curve.
        t: Position along the fade, 0 at silence and 1 at full level, clamped.
        rising: ``True`` for a fade in, ``False`` for a fade out. Every shape
            here is symmetric — a fade out is the same curve read backwards —
            so this only decides which end ``t`` is measured from.

    Returns:
        A gain in 0–1. The ends are exact: ``0.0`` at ``t = 0`` and ``1.0`` at
        ``t = 1`` for every shape, so a fade never leaves a clip a fraction
        quieter than it was before it had one.
    """
    position = min(1.0, max(0.0, t if rising else 1.0 - t))
    if position <= 0.0:
        return 0.0
    if position >= 1.0:
        return 1.0
    if shape is FadeShape.LINEAR:
        return position
    if shape is FadeShape.EQUAL_POWER:
        return math.sin(position * math.pi / 2.0)
    if shape is FadeShape.S_CURVE:
        return position * position * (3.0 - 2.0 * position)
    # Exponential: even in the dB domain, so the *level* moves at a constant
    # rate. Scaled so the ends land exactly on 0 and 1 rather than on the floor.
    floor = _FLOOR_LINEAR
    return (math.pow(floor, 1.0 - position) - floor) / (1.0 - floor)


@dataclass(frozen=True, slots=True, kw_only=True)
class ClipAudio:
    """What one clip sounds like. All of it is optional.

    The fields are the four things a user reaches for on a clip they can hear,
    and nothing else: how loud it is, where it sits, and how it comes in and
    goes out. EQ and dynamics are deliberately **not** here — they are a
    channel strip, they belong to the mixer's master chain, and putting them
    here would mean every clip in every project carried a compressor it never
    used.
    """

    #: Level in decibels. ``0.0`` is unity.
    gain_db: float = 0.0
    #: Stereo position, -1 (hard left) to +1 (hard right). ``0.0`` is centre.
    #: Equal-power, so a pan does not change a clip's apparent loudness. A
    #: no-op on more than two channels, which is documented rather than
    #: refused: a 5.1 bed is not panned, it is placed, and that is a different
    #: control this build does not have.
    pan: float = 0.0
    #: Length of the fade in, in project frames. ``0`` means no fade.
    fade_in_frames: int = 0
    #: Length of the fade out, in project frames. ``0`` means no fade.
    fade_out_frames: int = 0
    #: Which curve both fades follow.
    fade_shape: FadeShape = FadeShape.EQUAL_POWER

    def __post_init__(self) -> None:
        if not math.isfinite(self.gain_db):
            raise NovaInvariantError(f"gain_db must be a finite number, got {self.gain_db}")
        if not math.isfinite(self.pan):
            raise NovaInvariantError(f"pan must be a finite number, got {self.pan}")
        if not -1.0 <= self.pan <= 1.0:
            raise NovaInvariantError(f"pan must be between -1 and 1, got {self.pan}")
        if self.fade_in_frames < 0:
            raise NovaInvariantError(
                f"fade_in_frames must not be negative, got {self.fade_in_frames}"
            )
        if self.fade_out_frames < 0:
            raise NovaInvariantError(
                f"fade_out_frames must not be negative, got {self.fade_out_frames}"
            )

    # -- derived -----------------------------------------------------------

    @property
    def gain(self) -> float:
        """The gain as a linear amplitude ratio. Unity is exactly ``1.0``."""
        return db_to_linear(self.gain_db)

    @property
    def is_neutral(self) -> bool:
        """Whether this clip needs any work done to it at all.

        A neutral clip is the common case, and it is the one the mixer skips:
        no multiply, no ramp, no allocation.
        """
        return (
            self.gain_db == 0.0
            and self.pan == 0.0
            and self.fade_in_frames == 0
            and self.fade_out_frames == 0
        )

    @property
    def has_fades(self) -> bool:
        """Whether either end fades."""
        return self.fade_in_frames > 0 or self.fade_out_frames > 0

    def fade_in_at(self, position_frames: int) -> float:
        """The gain of the fade in at ``position_frames`` into the clip."""
        if self.fade_in_frames <= 0:
            return 1.0
        return fade_factor(self.fade_shape, position_frames / self.fade_in_frames, rising=True)

    def fade_out_at(self, remaining_frames: int) -> float:
        """The gain of the fade out with ``remaining_frames`` still to play.

        Measured from what is *left*, because that is what a mixer knows
        halfway through a block: how many frames of this clip it has not
        reached yet. Nothing left is silence, and a full fade's worth left is
        full level.
        """
        if self.fade_out_frames <= 0:
            return 1.0
        into_the_fade = 1.0 - (remaining_frames / self.fade_out_frames)
        return fade_factor(self.fade_shape, into_the_fade, rising=False)

    # -- persistence -------------------------------------------------------

    def to_wire(self) -> dict[str, object]:
        """The canonical document form. Every field, always.

        An optional field that is omitted when it is default is a field a
        reader has to have an opinion about; the project document's rule is
        that a document is one diffable thing, so a neutral clip audio is
        written out in full and two projects that sound the same produce the
        same bytes.
        """
        return {
            "gain_db": self.gain_db,
            "pan": self.pan,
            "fade_in_frames": self.fade_in_frames,
            "fade_out_frames": self.fade_out_frames,
            "fade_shape": self.fade_shape.value,
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> ClipAudio:
        """Rebuild from the canonical form.

        :raises NovaInvariantError: if a field is missing, of the wrong type, or
            names a fade shape this build does not know.
        """
        _reject_unknown_fields(data, CLIP_AUDIO_FIELDS)
        return cls(
            gain_db=_wire_float(data, "gain_db"),
            pan=_wire_float(data, "pan"),
            fade_in_frames=_wire_int(data, "fade_in_frames"),
            fade_out_frames=_wire_int(data, "fade_out_frames"),
            fade_shape=FadeShape(_wire_str(data, "fade_shape")),
        )
