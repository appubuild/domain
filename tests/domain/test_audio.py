"""The clip audio model (`domain/audio.py`).

Three things a listener notices about an edit are where a clip starts, where it
stops and how loud it is, and all three are this module. What is pinned here is
the part that is easy to get wrong and impossible to hear in a unit test:

* **Decibels are amplitude, not power.** ``20 · log10``, so +6 dB is double the
  amplitude. Getting this the wrong way round is the most common bug in audio
  code, and it is only noticed when a mix is quiet.
* **A fade is a curve with exact ends.** Every shape is 0 at one end and 1 at
  the other, so a clip with a fade is never left a fraction quieter than the
  same clip without one — and a fade never starts with a click.
* **Neutral is zero, everywhere.** Which is what lets the mixer skip a clip the
  user has never touched, and what keeps a project's document small enough to
  diff.

Nothing here touches a sample: this module describes *what to ask for*, and the
mixer in ``services/render/audio.py`` is what turns it into numbers. The test
that the two agree lives with the mixer.
"""

from __future__ import annotations

import json

import pytest

from nova_studio.core import NovaInvariantError
from nova_studio.domain.audio import (
    CLIP_AUDIO_FIELDS,
    ClipAudio,
    FadeShape,
    db_to_linear,
    fade_factor,
    linear_to_db,
)

pytestmark = pytest.mark.unit


# ---------------------------------------------------------------------------
# Decibels
# ---------------------------------------------------------------------------


class TestDecibels:
    """Amplitude, not power: the bug that is only noticed when a mix is quiet."""

    def test_unity_is_exactly_one(self) -> None:
        assert db_to_linear(0.0) == 1.0
        assert linear_to_db(1.0) == 0.0

    def test_six_decibels_is_double_the_amplitude_and_not_four_times_it(self) -> None:
        assert db_to_linear(6.0) == pytest.approx(1.9953, abs=1e-4)
        assert db_to_linear(6.0) == pytest.approx(2.0, abs=0.01)
        assert db_to_linear(6.0) != pytest.approx(4.0, abs=0.1)

    def test_twenty_decibels_is_ten_times(self) -> None:
        assert db_to_linear(20.0) == pytest.approx(10.0, abs=1e-3)

    def test_the_conversions_are_inverses(self) -> None:
        for decibels in (-40.0, -12.0, -0.5, 0.0, 3.0, 11.5):
            assert linear_to_db(db_to_linear(decibels)) == pytest.approx(decibels, abs=1e-9)

    def test_silence_is_the_floor_and_not_infinity(self) -> None:
        """A meter that printed ``-inf`` is a meter nobody trusts."""
        assert linear_to_db(0.0) == -60.0
        assert linear_to_db(-1.0) == -60.0


# ---------------------------------------------------------------------------
# Fade shapes
# ---------------------------------------------------------------------------


class TestFadeShapes:
    """Every curve is a way of getting from silence to full level."""

    def test_every_shape_starts_at_silence_and_ends_at_unity(self) -> None:
        for shape in FadeShape:
            assert fade_factor(shape, 0.0, rising=True) == 0.0
            assert fade_factor(shape, 1.0, rising=True) == 1.0

    def test_a_fade_out_is_the_same_curve_read_backwards(self) -> None:
        for shape in FadeShape:
            assert fade_factor(shape, 0.0, rising=False) == 1.0
            assert fade_factor(shape, 1.0, rising=False) == 0.0

    def test_positions_outside_the_fade_are_clamped(self) -> None:
        """A sample before the fade begins is silent, not negative."""
        for shape in FadeShape:
            assert fade_factor(shape, -3.0, rising=True) == 0.0
            assert fade_factor(shape, 4.0, rising=True) == 1.0

    def test_equal_power_is_half_amplitude_at_two_thirds_of_the_level(self) -> None:
        """Constant power, which is what the ear hears as even.

        A linear fade is at 0.5 here and sounds like it has already given up;
        the raised cosine is at 0.707, which is -3 dB, which is what "halfway
        through a fade" means to a listener.
        """
        assert fade_factor(FadeShape.EQUAL_POWER, 0.5, rising=True) == pytest.approx(
            0.7071067811865476, abs=1e-9
        )
        assert fade_factor(FadeShape.LINEAR, 0.5, rising=True) == 0.5

    def test_the_s_curve_is_flat_at_both_ends(self) -> None:
        """Steepest in the middle, so neither end draws attention to itself."""
        early = fade_factor(FadeShape.S_CURVE, 0.05, rising=True)
        middle = fade_factor(FadeShape.S_CURVE, 0.5, rising=True)
        late = fade_factor(FadeShape.S_CURVE, 0.95, rising=True)
        assert early < 0.02
        assert middle == pytest.approx(0.5, abs=1e-9)
        assert late > 0.98

    def test_every_shape_rises_monotonically(self) -> None:
        """A fade that dipped in the middle would be a fade that ducked."""
        for shape in FadeShape:
            levels = [fade_factor(shape, index / 64, rising=True) for index in range(65)]
            assert levels == sorted(levels), shape
            assert all(0.0 <= level <= 1.0 for level in levels), shape

    def test_the_exponential_shape_never_quite_reaches_silence_or_unity(self) -> None:
        """-60 dB is inaudible, and a fade to exactly zero is a fade that
        clicks when it is rounded at a finite sample rate."""
        assert 0.0 < fade_factor(FadeShape.EXPONENTIAL, 0.001, rising=True) < 0.05
        assert 0.95 < fade_factor(FadeShape.EXPONENTIAL, 0.999, rising=True) < 1.0

    def test_the_equal_power_law_is_symmetric_about_the_middle(self) -> None:
        """A crossfade of two equal-power curves sums to constant power, which
        is the whole reason it is the default."""
        for position in (0.1, 0.25, 0.4, 0.5):
            rising = fade_factor(FadeShape.EQUAL_POWER, position, rising=True)
            falling = fade_factor(FadeShape.EQUAL_POWER, position, rising=False)
            assert rising**2 + falling**2 == pytest.approx(1.0, abs=1e-9)


# ---------------------------------------------------------------------------
# The value
# ---------------------------------------------------------------------------


class TestClipAudio:
    """Neutral is zero, and a neutral clip costs the mixer nothing."""

    def test_the_default_does_nothing(self) -> None:
        audio = ClipAudio()
        assert audio.is_neutral
        assert audio.gain == 1.0
        assert not audio.has_fades

    def test_any_one_field_stops_it_being_neutral(self) -> None:
        assert not ClipAudio(gain_db=1.0).is_neutral
        assert not ClipAudio(pan=0.1).is_neutral
        assert not ClipAudio(fade_in_frames=1).is_neutral
        assert not ClipAudio(fade_out_frames=1).is_neutral

    def test_a_fade_becomes_a_gain_when_you_are_inside_it(self) -> None:
        audio = ClipAudio(fade_in_frames=10, fade_out_frames=10)
        assert audio.fade_in_at(0) == 0.0
        assert audio.fade_in_at(5) == pytest.approx(0.7071, abs=1e-3)
        assert audio.fade_in_at(10) == 1.0
        assert audio.fade_in_at(50) == 1.0

    def test_a_fade_out_is_measured_from_what_is_left(self) -> None:
        audio = ClipAudio(fade_out_frames=10)
        assert audio.fade_out_at(0) == 0.0
        assert audio.fade_out_at(10) == 1.0
        assert audio.fade_out_at(999) == 1.0

    def test_a_clip_with_no_fade_is_at_full_level_wherever_you_ask(self) -> None:
        audio = ClipAudio()
        assert audio.fade_in_at(0) == 1.0
        assert audio.fade_out_at(0) == 1.0

    def test_a_pan_outside_the_stereo_field_is_refused(self) -> None:
        for pan in (-1.0, 0.0, 1.0):
            assert ClipAudio(pan=pan).pan == pan
        for pan in (-1.5, 2.0):
            with pytest.raises(NovaInvariantError, match="between -1 and 1"):
                ClipAudio(pan=pan)

    def test_a_fade_cannot_be_a_negative_length(self) -> None:
        with pytest.raises(NovaInvariantError, match="fade_in_frames"):
            ClipAudio(fade_in_frames=-1)
        with pytest.raises(NovaInvariantError, match="fade_out_frames"):
            ClipAudio(fade_out_frames=-1)

    def test_a_gain_that_is_not_a_number_is_refused(self) -> None:
        """A NaN in a mix is not silence — it is silence that spreads."""
        for value in (float("nan"), float("inf")):
            with pytest.raises(NovaInvariantError, match="finite"):
                ClipAudio(gain_db=value)
            with pytest.raises(NovaInvariantError, match="finite"):
                ClipAudio(pan=value)


# ---------------------------------------------------------------------------
# The document
# ---------------------------------------------------------------------------


class TestWire:
    """What a user set survives being saved."""

    def test_a_round_trip_loses_nothing(self) -> None:
        audio = ClipAudio(
            gain_db=-6.5,
            pan=-0.25,
            fade_in_frames=12,
            fade_out_frames=24,
            fade_shape=FadeShape.EXPONENTIAL,
        )
        assert ClipAudio.from_wire(audio.to_wire()) == audio

    def test_a_neutral_setting_is_written_out_in_full(self) -> None:
        """A document is one diffable thing.

        An optional field omitted when default is a field a reader has to have
        an opinion about, and two projects that sound the same should produce
        the same bytes.
        """
        wire = ClipAudio().to_wire()
        assert set(wire) == CLIP_AUDIO_FIELDS
        assert ClipAudio.from_wire(wire) == ClipAudio()

    def test_it_survives_json(self) -> None:
        audio = ClipAudio(gain_db=3.0, fade_shape=FadeShape.S_CURVE)
        assert ClipAudio.from_wire(json.loads(json.dumps(audio.to_wire()))) == audio

    def test_a_field_from_a_newer_build_is_refused_rather_than_dropped(self) -> None:
        wire = ClipAudio().to_wire()
        wire["loudness_target"] = -23.0
        with pytest.raises(NovaInvariantError, match="loudness_target"):
            ClipAudio.from_wire(wire)

    def test_a_fade_shape_this_build_does_not_know_is_refused(self) -> None:
        wire = ClipAudio().to_wire()
        wire["fade_shape"] = "logarithmic"
        with pytest.raises(ValueError):
            ClipAudio.from_wire(wire)

    def test_a_wrong_type_is_an_error_and_never_a_coercion(self) -> None:
        """``True`` where a frame count was meant is a corrupted document."""
        wire = ClipAudio().to_wire()
        wire["fade_in_frames"] = True
        with pytest.raises(NovaInvariantError, match="must be an int"):
            ClipAudio.from_wire(wire)

    def test_an_integer_is_accepted_where_a_number_was_expected(self) -> None:
        """A document that wrote ``0`` was written by a language with one
        numeric type, and refusing it would be pedantry that loses data."""
        wire = ClipAudio().to_wire()
        wire["gain_db"] = 0
        assert ClipAudio.from_wire(wire).gain_db == 0.0
